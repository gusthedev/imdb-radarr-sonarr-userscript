const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const loaderSource = fs.readFileSync(
    path.join(__dirname, '..', 'imdb-radarr-sonarr-loader.example.user.js'),
    'utf8'
);

const STORAGE = {
    source: 'imdbRsLoader.sharedCore.source.v2',
    fallback: 'imdbRsLoader.sharedCore.fallbackSource.v2',
    etag: 'imdbRsLoader.sharedCore.etag.v2',
    lastAttempt: 'imdbRsLoader.sharedCore.lastAttempt.v2',
    rejected: 'imdbRsLoader.sharedCore.rejectedSignature.v2',
    ambiguous: 'imdbRsLoader.ambiguousBehavior.v1'
};

function core(version, body = '', initialize = true) {
    return `// ==UserScript==
// @name         IMDb to Radarr/Sonarr (Shared Core)
// @namespace    shared.imdb.radarr.sonarr
// @version      ${version}
// @description  Loader fixture
// ${'validated fixture '.repeat(70)}
// ==/UserScript==
void globalThis.IMDB_RS_CONFIG;
globalThis.__coreRuns = [...(globalThis.__coreRuns || []), '${version}'];
${body}
${initialize ? `globalThis[Symbol.for('shared.imdb.radarr.sonarr.instance')] = { version: '${version}' };` : ''}`;
}

function runLoader({ storageValues = {}, response = null, requestFailure = '' } = {}) {
    const storage = new Map(Object.entries(storageValues));
    const requests = [];
    const menus = new Map();
    const alerts = [];
    const context = {
        Date,
        URL,
        console: { error() {}, info() {}, warn() {} },
        window: { alert: message => alerts.push(String(message)) },
        GM_getValue: (key, fallback) => storage.has(key) ? storage.get(key) : fallback,
        GM_setValue: (key, value) => storage.set(key, value),
        GM_deleteValue: key => storage.delete(key),
        GM_registerMenuCommand: (label, callback) => menus.set(label, callback),
        GM_xmlhttpRequest(request) {
            requests.push(request);
            if (requestFailure === 'network') request.onerror(new Error('offline'));
            else if (requestFailure === 'timeout') request.ontimeout();
            else if (response) request.onload(response);
        }
    };
    context.globalThis = context;
    vm.runInNewContext(loaderSource, context, { filename: 'loader.user.js' });
    return { alerts, context, menus, requests, storage };
}

test('loader metadata allows IMDb title pages', () => {
    assert.doesNotMatch(loaderSource, /^\/\/\s*@exclude\s+\*:\/\/\*?\.?imdb\.com\//m);
});

test('cold install validates, caches, and starts the core', () => {
    const next = core('5.4.0');
    const harness = runLoader({
        response: { status: 200, responseText: next, responseHeaders: 'etag: "540"\r\n' }
    });
    assert.deepEqual(Array.from(harness.context.__coreRuns), ['5.4.0']);
    assert.equal(harness.storage.get(STORAGE.source), next);
    assert.equal(harness.storage.get(STORAGE.etag), '"540"');
});

test('fresh cache starts synchronously without a request', () => {
    const current = core('5.3.5');
    const harness = runLoader({
        storageValues: { [STORAGE.source]: current, [STORAGE.lastAttempt]: Date.now() }
    });
    assert.deepEqual(Array.from(harness.context.__coreRuns), ['5.3.5']);
    assert.equal(harness.requests.length, 0);
});

test('missing core retries immediately despite a recent failed attempt', () => {
    const next = core('5.4.1');
    const harness = runLoader({
        storageValues: { [STORAGE.lastAttempt]: Date.now() },
        response: { status: 200, responseText: next, responseHeaders: 'etag: "541"\r\n' }
    });
    assert.equal(harness.requests.length, 1);
    assert.deepEqual(Array.from(harness.context.__coreRuns), ['5.4.1']);
    assert.equal(harness.storage.get(STORAGE.source), next);
});

test('loader 1.4 migrates past the legacy core cache immediately', () => {
    const legacy = core('5.4.1');
    const next = core('5.5.0');
    const harness = runLoader({
        storageValues: {
            'imdbRsLoader.sharedCore.source.v1': legacy,
            'imdbRsLoader.sharedCore.lastAttempt.v1': Date.now()
        },
        response: { status: 200, responseText: next, responseHeaders: 'etag: "550"\r\n' }
    });
    assert.equal(harness.requests.length, 1);
    assert.deepEqual(Array.from(harness.context.__coreRuns), ['5.5.0']);
    assert.equal(harness.storage.get(STORAGE.source), next);
});

test('warm update is saved with rollback without double execution', () => {
    const current = core('5.3.5');
    const next = core('5.4.0');
    const harness = runLoader({
        storageValues: { [STORAGE.source]: current, [STORAGE.etag]: '"535"', [STORAGE.lastAttempt]: 0 },
        response: { status: 200, responseText: next, responseHeaders: 'etag: "540"\r\n' }
    });
    assert.deepEqual(Array.from(harness.context.__coreRuns), ['5.3.5']);
    assert.equal(harness.storage.get(STORAGE.source), next);
    assert.equal(harness.storage.get(STORAGE.fallback), current);
});

test('runtime failure restores the rollback core', () => {
    const broken = core('5.4.0', "throw new Error('broken');");
    const fallback = core('5.3.5');
    const harness = runLoader({
        storageValues: {
            [STORAGE.source]: broken,
            [STORAGE.fallback]: fallback,
            [STORAGE.lastAttempt]: Date.now()
        }
    });
    assert.deepEqual(Array.from(harness.context.__coreRuns), ['5.4.0', '5.3.5']);
    assert.equal(harness.storage.get(STORAGE.source), fallback);
    assert.equal(harness.storage.has(STORAGE.fallback), false);
    assert.equal(harness.storage.has(STORAGE.rejected), true);
});

test('manual update bypasses caches and status reports all slots', () => {
    const current = core('5.3.5');
    const harness = runLoader({
        storageValues: { [STORAGE.source]: current, [STORAGE.etag]: '"535"', [STORAGE.lastAttempt]: Date.now() }
    });
    harness.menus.get('Check for shared-core updates now')();
    const request = harness.requests.at(-1);
    assert.match(request.url, /\?tm_refresh=\d+$/);
    assert.equal(request.headers['Cache-Control'], 'no-cache');
    request.onload({ status: 304, responseHeaders: '' });
    harness.menus.get('Show shared-core status')();
    assert.match(harness.alerts.at(-1), /Active: 5\.3\.5/);
    assert.match(harness.alerts.at(-1), /Cached: 5\.3\.5/);
});

test('ambiguous IMDb preference cycles and persists', () => {
    const current = core('5.3.5');
    const harness = runLoader({
        storageValues: { [STORAGE.source]: current, [STORAGE.lastAttempt]: Date.now() }
    });
    harness.menus.get('Cycle ambiguous IMDb action')();
    assert.equal(harness.storage.get(STORAGE.ambiguous), 'radarr');
    assert.match(harness.alerts.at(-1), /radarr/);
});

test('network failure retains the cached core', () => {
    const current = core('5.3.5');
    const harness = runLoader({
        storageValues: { [STORAGE.source]: current, [STORAGE.lastAttempt]: 0 },
        requestFailure: 'network'
    });
    assert.deepEqual(Array.from(harness.context.__coreRuns), ['5.3.5']);
    assert.equal(harness.storage.get(STORAGE.source), current);
});

test('a silent non-initializing core is rejected', () => {
    const broken = core('5.4.0', '', false);
    const harness = runLoader({
        storageValues: { [STORAGE.source]: broken, [STORAGE.lastAttempt]: Date.now() }
    });
    assert.deepEqual(Array.from(harness.context.__coreRuns), ['5.4.0']);
    assert.equal(harness.storage.has(STORAGE.source), false);
});
