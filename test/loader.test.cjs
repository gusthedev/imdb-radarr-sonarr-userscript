const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const loaderSource = fs.readFileSync(
    path.join(__dirname, '..', 'imdb-radarr-sonarr-loader.example.user.js'),
    'utf8'
);

function sharedCoreSource({ initialize }) {
    return `// ==UserScript==
// @name         IMDb to Radarr/Sonarr (Shared Core)
// @namespace    shared.imdb.radarr.sonarr
// @version      99.0.0
// ==/UserScript==
void globalThis.IMDB_RS_CONFIG;
globalThis.__coreRuns = (globalThis.__coreRuns || 0) + 1;
${initialize ? "globalThis[Symbol.for('shared.imdb.radarr.sonarr.instance')] = {};" : ''}
/* ${'x'.repeat(1_100)} */`;
}

function runLoader(cachedSource) {
    const storage = new Map([
        ['imdbRsLoader.sharedCore.source.v1', cachedSource],
        ['imdbRsLoader.sharedCore.etag.v1', 'etag'],
        ['imdbRsLoader.sharedCore.lastAttempt.v1', Date.now()]
    ]);
    let menuCommand;
    let request;
    const alerts = [];
    const context = {
        URL,
        Symbol,
        console,
        GM_getValue: (key, fallback) => storage.has(key) ? storage.get(key) : fallback,
        GM_setValue: (key, value) => storage.set(key, value),
        GM_deleteValue: key => storage.delete(key),
        GM_registerMenuCommand: (_name, callback) => { menuCommand = callback; },
        GM_xmlhttpRequest: details => { request = details; },
        window: { alert: message => alerts.push(message) }
    };
    context.globalThis = context;
    vm.runInNewContext(loaderSource, context, { filename: 'loader.user.js' });
    return {
        alerts,
        context,
        manualUpdate() {
            menuCommand();
            request.onload({ status: 304, responseHeaders: '' });
        }
    };
}

test('manual update retries a cached core that returned without initializing', () => {
    const loader = runLoader(sharedCoreSource({ initialize: false }));
    assert.equal(loader.context.__coreRuns, 1);
    loader.manualUpdate();
    assert.equal(loader.context.__coreRuns, 2);
    assert.match(loader.alerts.at(-1), /current \(99\.0\.0\)/);
});

test('manual update does not execute an already running core twice', () => {
    const loader = runLoader(sharedCoreSource({ initialize: true }));
    assert.equal(loader.context.__coreRuns, 1);
    loader.manualUpdate();
    assert.equal(loader.context.__coreRuns, 1);
});
