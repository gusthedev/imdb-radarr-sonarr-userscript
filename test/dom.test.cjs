const { JSDOM } = require('jsdom');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'imdb-radarr-sonarr.user.js'), 'utf8');

function setup(t, html, url, extra = {}) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => { dom.window[Symbol.for('shared.imdb.radarr.sonarr.instance')]?.observer?.disconnect(); dom.window.close(); });
    const w = dom.window, frames = [];
    w.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
    w.IMDB_RS_CONFIG = { radarrBaseUrl: 'https://radarr.example.com', sonarrBaseUrl: 'https://sonarr.example.com', ...extra };
    let scans = 0;
    const query = w.document.querySelectorAll.bind(w.document);
    w.document.querySelectorAll = selector => { scans++; return query(selector); };
    w.eval(source);
    return { w, frames, scans: () => scans, async settle() {
        for (let i = 0; i < 12; i++) {
            await Promise.resolve();
            const current = frames.splice(0);
            current.forEach(fn => fn());
            if (!current.length && i > 5) break;
        }
        assert.equal(frames.length, 0, 'mutation processing must settle');
    } };
}

test('irrelevant mutations and script-owned button text cause no document rescans', async t => {
    const h = setup(t, '<article><a href="https://imdb.com/title/tt123"><h3>Film</h3></a></article><div id="clock">0</div>', 'https://www.google.com/search?q=film');
    await h.settle();
    const before = h.scans();
    h.w.document.getElementById('clock').textContent = '1';
    h.w.document.querySelector('.mdblist-btn').textContent = 'Custom status';
    await h.settle();
    assert.equal(h.scans(), before);
});

test('new explicit peers reclassify existing ambiguous results', async t => {
    const h = setup(t, '<article><a href="https://imdb.com/title/tt123"><h3>Film</h3></a></article>', 'https://www.google.com/search?q=film');
    await h.settle();
    assert.equal(h.w.document.querySelectorAll('article button').length, 2);
    h.w.document.body.insertAdjacentHTML('beforeend', '<article><a href="https://themoviedb.org/movie/77"><h3>Film</h3></a></article>');
    await h.settle();
    assert.equal(h.w.document.querySelector('article').querySelectorAll('button').length, 1);
    assert.equal(h.w.document.querySelector('article button').textContent, 'Radarr');
});

test('provider metadata is cached, ignores nested recommendations, and follows navigation', async t => {
    const h = setup(t, '<h1>Film</h1><script type="application/ld+json">{"@type":"Movie","url":"https://www.imdb.com/title/tt123/","subjectOf":{"@type":"TVSeries"}}</script><div id="clock">0</div>', 'https://www.imdb.com/title/tt123/');
    await h.settle();
    assert.equal(h.w.document.querySelector('#imdb-rs-page-control').textContent, 'Add to Radarr');
    const before = h.scans();
    h.w.document.getElementById('clock').firstChild.data = '1';
    await h.settle();
    assert.equal(h.scans(), before);
    h.w.history.pushState({}, '', '/title/tt456/');
    h.w.document.querySelector('script').textContent = '{"@type":"TVSeries","url":"https://www.imdb.com/title/tt456/"}';
    await h.settle();
    assert.equal(h.w.document.querySelector('#imdb-rs-page-control').textContent, 'Add to Sonarr');
});

test('library matches exact IDs and opens the existing title instead of the add screen', async t => {
    let calls = 0, opened;
    const h = setup(t, '<h1>Film</h1>', 'https://www.themoviedb.org/movie/77-film', {
        readLibrary: async () => { calls++; return { state: 'ready', rows: [{ id: 3, tmdbId: 77, titleSlug: 'film-77', monitored: true, hasFile: true }] }; }
    });
    h.w.open = url => { opened = url; };
    await h.settle();
    const button = h.w.document.querySelector('#imdb-rs-page-control button');
    assert.equal(button.textContent, '✓ In Radarr');
    assert.match(button.title, /Files available/);
    button.click();
    assert.equal(opened, 'https://radarr.example.com/movie/film-77');
    h.w.dispatchEvent(new h.w.Event('focus'));
    await h.settle();
    assert.equal(calls, 1);
});
