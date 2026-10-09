const { JSDOM } = require('jsdom');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = fs.readFileSync(path.join(__dirname, '..', 'imdb-radarr-sonarr.user.js'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, '..', 'imdb-radarr-sonarr-loader.example.user.js'), 'utf8');
const services = { movie: 'Radarr', tv: 'Sonarr' };
const cacheKey = type => `imdbRs.library.${type}.cache.v1`;
const rows = (type, id) => [{ id, tmdbId: type === 'movie' ? 77 : 88, titleSlug: `${type}-${id}` }];

// Exercise the real menu, loader, core, and DOM with an explicit response order
// and clock. No API server, private credentials, or wall-clock sleeps are needed.
function setup(t, types = ['movie', 'tv']) {
    const html = types.map(type => `<article id="${type}"><a href="https://www.themoviedb.org/${type}/${type === 'movie' ? 77 : 88}">${type}</a></article>`).join('');
    const dom = new JSDOM(html, { url: 'https://catalog.example.org/', runScripts: 'outside-only' });
    const w = dom.window;
    t.after(() => { w[Symbol.for('shared.imdb.radarr.sonarr.instance')]?.observer?.disconnect(); w.close(); });
    let now = 1_800_000_000_000;
    const frames = [], requests = [], opened = [], menus = new Map();
    const storage = new Map([
        ['imdbRsLoader.sharedCore.source.v2', core],
        ['imdbRsLoader.sharedCore.lastAttempt.v2', now]
    ]);
    for (const [type, service] of Object.entries(services)) {
        storage.set(`imdbRs.library.${type}.url`, `https://${service.toLowerCase()}.example.com`);
        storage.set(`imdbRs.library.${type}.key`, 'local-test-key');
    }
    w.Date.now = () => now;
    w.setTimeout = () => 0;
    w.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
    w.open = url => opened.push(url);
    w.GM_getValue = (key, fallback) => storage.has(key) ? storage.get(key) : fallback;
    w.GM_setValue = (key, value) => storage.set(key, value);
    w.GM_deleteValue = key => storage.delete(key);
    w.GM_registerMenuCommand = (name, callback) => menus.set(name, callback);
    w.GM_xmlhttpRequest = request => requests.push(request);
    w.eval(loader);
    return {
        w, requests, storage, opened,
        button: type => w.document.querySelector(`#${type} button`),
        pending: type => requests.filter(request => request.url.endsWith(type === 'tv' ? '/series' : '/movie')),
        refresh: () => menus.get('Refresh library status')(),
        focus: () => w.dispatchEvent(new w.Event('focus')),
        advance: ms => { now += ms; },
        async settle() {
            for (let i = 0; i < 20; i++) {
                await Promise.resolve();
                frames.splice(0).forEach(fn => fn());
            }
            assert.equal(frames.length, 0, 'DOM work must settle');
        }
    };
}

function respond(request, data) {
    request.onload({ status: 200, responseText: JSON.stringify(data) });
}

for (const [type, service] of Object.entries(services)) {
    for (const oldFirst of [true, false]) {
        test(`${service}: refresh ignores an old response arriving ${oldFirst ? 'before' : 'after'} the fresh response`, async t => {
            const h = setup(t, [type]);
            await h.settle();
            const old = h.pending(type)[0];
            h.refresh();
            await h.settle();
            assert.equal(h.pending(type).length, 2);
            const fresh = h.pending(type)[1];
            if (oldFirst) {
                respond(old, rows(type, 1));
                await h.settle();
                assert.equal(h.storage.has(cacheKey(type)), false);
                assert.equal(h.button(type).textContent, service);
                assert.doesNotMatch(h.button(type).title, /Not in library|Already in/);
                h.focus();
                await h.settle();
                assert.equal(h.pending(type).length, 2, 'old cleanup must not detach the fresh request');
            }
            respond(fresh, rows(type, 2));
            await h.settle();
            if (!oldFirst) {
                respond(old, rows(type, 1));
                await h.settle();
            }
            assert.equal(h.storage.get(cacheKey(type)).rows[0].id, 2);
            assert.equal(h.button(type).textContent, `✓ In ${service}`);
            h.button(type).click();
            assert.equal(h.opened.at(-1), `https://${service.toLowerCase()}.example.com/${type === 'tv' ? 'series' : 'movie'}/${type}-2`);
            h.advance(5 * 60_000 - 1);
            h.focus();
            await h.settle();
            assert.equal(h.pending(type).length, 2, 'successful results retain the five-minute cache');
            h.advance(1);
            h.focus();
            await h.settle();
            assert.equal(h.pending(type).length, 3, 'automatic refresh resumes when the cache expires');
        });
    }

    test(`${service}: consecutive refreshes keep only the latest generation and coalesce normal reads`, async t => {
        const h = setup(t, [type]);
        // The initial read is queued but has not reached the loader yet.
        h.refresh();
        h.refresh();
        await h.settle();
        assert.equal(h.pending(type).length, 1, 'superseded queued reads must not start API calls');
        h.refresh();
        await h.settle();
        h.refresh();
        await h.settle();
        assert.equal(h.pending(type).length, 3);
        respond(h.pending(type)[1], rows(type, 2));
        h.pending(type)[0].ontimeout();
        await h.settle();
        assert.equal(h.storage.has(cacheKey(type)), false);
        h.focus();
        const read = h.w.IMDB_RS_CONFIG.readLibrary(type);
        assert.equal(h.w.IMDB_RS_CONFIG.readLibrary(type), read);
        await h.settle();
        assert.equal(h.pending(type).length, 3);
        respond(h.pending(type)[2], rows(type, 3));
        await read;
        await h.settle();
        assert.equal(h.storage.get(cacheKey(type)).rows[0].id, 3);
        assert.equal(h.button(type).textContent, `✓ In ${service}`);
    });

    test(`${service}: a failed refresh stays unknown, backs off for one minute, and recovers`, async t => {
        const h = setup(t, [type]);
        await h.settle();
        h.refresh();
        await h.settle();
        h.pending(type)[1].onerror();
        await h.settle();
        respond(h.pending(type)[0], rows(type, 1));
        await h.settle();
        assert.equal(h.storage.has(cacheKey(type)), false, 'stale success cannot undo a current failure');
        assert.equal(h.button(type).textContent, service);
        assert.match(h.button(type).title, /Library status unavailable/);
        assert.doesNotMatch(h.button(type).title, /Not in library/);
        h.advance(59_999);
        h.focus();
        assert.equal((await h.w.IMDB_RS_CONFIG.readLibrary(type)).state, 'unavailable');
        await h.settle();
        assert.equal(h.pending(type).length, 2, 'stale success must not clear the loader failure backoff');
        h.advance(1);
        h.focus();
        await h.settle();
        assert.equal(h.pending(type).length, 3);
        respond(h.pending(type)[2], rows(type, 3));
        await h.settle();
        assert.equal(h.button(type).textContent, `✓ In ${service}`);
        assert.equal(h.storage.get(cacheKey(type)).rows[0].id, 3);
    });

    test(`${service}: late failures cannot extend backoff and manual refresh can retry immediately`, async t => {
        const h = setup(t, [type]);
        await h.settle();
        h.refresh();
        await h.settle();
        h.pending(type)[1].ontimeout();
        await h.settle();
        h.advance(30_000);
        h.pending(type)[0].onabort();
        await h.settle();
        h.advance(30_000);
        h.focus();
        await h.settle();
        assert.equal(h.pending(type).length, 3, 'a stale failure cannot restart the current backoff');
        h.pending(type)[2].onload({ status: 503, responseText: 'temporarily unavailable' });
        await h.settle();
        h.refresh();
        await h.settle();
        assert.equal(h.pending(type).length, 4, 'explicit refresh bypasses both failure backoffs');
        respond(h.pending(type)[3], rows(type, 4));
        await h.settle();
        assert.equal(h.button(type).textContent, `✓ In ${service}`);
        assert.equal(h.storage.get(cacheKey(type)).rows[0].id, 4);
    });
}

test('one menu refresh updates both services and clears successful cached status', async t => {
    const h = setup(t);
    await h.settle();
    for (const type of Object.keys(services)) respond(h.pending(type)[0], rows(type, 1));
    await h.settle();
    h.refresh();
    for (const [type, service] of Object.entries(services)) {
        assert.equal(h.storage.has(cacheKey(type)), false);
        assert.equal(h.button(type).textContent, service);
    }
    await h.settle();
    assert.equal(h.requests.length, 4, 'exactly one new request per displayed service');
    for (const type of Object.keys(services)) respond(h.pending(type)[1], []);
    await h.settle();
    for (const type of Object.keys(services)) assert.match(h.button(type).title, /Not in library/);
});
