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

function providerButton(document) {
    return document.getElementById('imdb-rs-page-control')?.shadowRoot?.querySelector('button');
}

test('core evaluated by an existing loader does nothing on X or Twitter', t => {
    for (const hostname of ['x.com', 'www.x.com', 'twitter.com', 'mobile.twitter.com']) {
        const dom = new JSDOM('<article><a href="https://imdb.com/title/tt123">Film</a></article>', {
            url: `https://${hostname}/example/status/123`, runScripts: 'outside-only'
        });
        t.after(() => dom.window.close());
        const w = dom.window;
        const before = w.document.documentElement.outerHTML;
        const pushState = w.history.pushState, replaceState = w.history.replaceState;
        const unexpected = () => assert.fail('Excluded sites must not initialize page work');
        w.MutationObserver = unexpected;
        w.setTimeout = unexpected;
        w.requestAnimationFrame = unexpected;
        w.addEventListener = unexpected;
        w.IMDB_RS_CONFIG = { readLibrary: unexpected };
        w.eval(source);
        assert.equal(w.document.documentElement.outerHTML, before);
        assert.equal(w.history.pushState, pushState);
        assert.equal(w.history.replaceState, replaceState);
        const instance = w[Symbol.for('shared.imdb.radarr.sonarr.instance')];
        assert.equal(instance.disabled, true, 'Legacy loaders must accept the intentional no-op');
        assert.equal(instance.version, '5.6.8');
    }
});

test('X exclusion does not match unrelated hostnames', async t => {
    for (const hostname of ['examplex.com', 'x.com.example.org', 'twitter.com.example.org']) {
        const h = setup(t, '<article><a href="https://imdb.com/title/tt123">Film</a></article>', `https://${hostname}/`);
        await h.settle();
        assert.ok(h.w.document.querySelector('.mdblist-link-wrap'));
    }
});

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

test('Google hover siblings do not replace an existing control', async t => {
    const h = setup(t, '<article><a href="https://imdb.com/title/tt123"><h3>Film</h3></a></article>', 'https://www.google.com/search?q=film');
    await h.settle();
    const link = h.w.document.querySelector('article a');
    const original = h.w.document.querySelector('.mdblist-link-wrap');
    link.insertAdjacentHTML('afterend', '<span class="google-hover-layer"></span>');
    await h.settle();
    assert.equal(h.w.document.querySelector('.mdblist-link-wrap'), original);
    assert.equal(h.w.document.querySelectorAll('.mdblist-link-wrap').length, 1);
});

test('duplicate Google cards keep one stable owner outside flipped headers', async t => {
    const card = id => `<section id="${id}"><div style="transform: scaleY(-1)"><a href="https://imdb.com/title/tt123"><h3>Film</h3></a></div></section>`;
    const h = setup(t, card('first') + card('second'), 'https://www.google.com/search?q=film');
    await h.settle();
    let controls = h.w.document.querySelectorAll('.mdblist-link-wrap');
    assert.equal(controls.length, 1);
    assert.equal(controls[0].previousElementSibling.id, 'first');

    h.w.document.getElementById('first').remove();
    await h.settle();
    controls = h.w.document.querySelectorAll('.mdblist-link-wrap');
    assert.equal(controls.length, 1);
    assert.equal(controls[0].previousElementSibling.id, 'second');
});

test('provider metadata is cached, ignores nested recommendations, and follows navigation', async t => {
    const h = setup(t, '<h1>Film</h1><script type="application/ld+json">{"@type":"Movie","url":"https://www.imdb.com/title/tt123/","subjectOf":{"@type":"TVSeries"}}</script><div id="clock">0</div>', 'https://www.imdb.com/title/tt123/');
    await h.settle();
    assert.equal(providerButton(h.w.document).textContent, 'Add to Radarr');
    const before = h.scans();
    h.w.document.getElementById('clock').firstChild.data = '1';
    await h.settle();
    assert.equal(h.scans(), before);
    h.w.history.pushState({}, '', '/title/tt456/');
    h.w.document.querySelector('script').textContent = '{"@type":"TVSeries","url":"https://www.imdb.com/title/tt456/"}';
    await h.settle();
    assert.equal(providerButton(h.w.document).textContent, 'Add to Sonarr');
});

test('library matches exact IDs and opens the existing title instead of the add screen', async t => {
    let calls = 0, opened;
    const h = setup(t, '<h1>Film</h1>', 'https://www.themoviedb.org/movie/77-film', {
        readLibrary: async () => { calls++; return { state: 'ready', rows: [{ id: 3, tmdbId: 77, titleSlug: 'film-77', monitored: true, hasFile: true }] }; }
    });
    h.w.open = url => { opened = url; };
    await h.settle();
    const button = providerButton(h.w.document);
    assert.equal(button.textContent, '✓ In Radarr');
    assert.match(button.title, /Files available/);
    button.click();
    assert.equal(opened, 'https://radarr.example.com/movie/film-77');
    h.w.dispatchEvent(new h.w.Event('focus'));
    await h.settle();
    assert.equal(calls, 1);
});

test('many Google titles use a single ownership scan per batch without cloning cards', async t => {
    const h = setup(t, '', 'https://www.google.com/search?q=films');
    await h.settle();
    let ownerScans = 0, clones = 0;
    const query = h.w.document.querySelectorAll.bind(h.w.document);
    h.w.document.querySelectorAll = selector => {
        if (selector === '.mdblist-link-wrap[data-imdb-rs-control="true"]') ownerScans++;
        return query(selector);
    };
    const clone = h.w.Node.prototype.cloneNode;
    h.w.Node.prototype.cloneNode = function (...args) { clones++; return clone.apply(this, args); };
    h.w.document.body.innerHTML = Array.from({length: 40}, (_, i) =>
        `<article><a href="https://themoviedb.org/movie/${i + 1}"><h3>Film ${i}</h3></a></article>`).join('');
    await h.settle();
    assert.equal(query('.mdblist-link-wrap').length, 40);
    assert.equal(ownerScans, 1);
    assert.equal(clones, 0);
});

test('staged results are decorated and control text cannot become TV evidence', async t => {
    const h = setup(t, '<article><a href="https://imdb.com/title/tt123"></a></article>', 'https://www.google.com/search?q=film');
    await h.settle();
    h.w.document.querySelector('a').innerHTML = '<h3><span>Film</span> title</h3>';
    await h.settle();
    assert.equal(h.w.document.querySelectorAll('article button').length, 2);
    h.w.document.querySelector('button').textContent = 'TV Series';
    h.w.dispatchEvent(new h.w.Event('focus'));
    await h.settle();
    assert.equal(h.w.document.querySelectorAll('article button').length, 2);
    h.w.document.querySelector('a').append(' TV Series');
    await h.settle();
    assert.equal(h.w.document.querySelectorAll('article button').length, 1);
    assert.equal(h.w.document.querySelector('button').textContent, 'Sonarr');
});

test('library IDs are indexed once and missing IDs and slugs never produce false matches', async t => {
    let idReads = 0, calls = 0;
    const rows = Array.from({length:1000}, (_, i) => ({
        id:i + 1, get tmdbId() { idReads++; return i + 1; }, imdbId:'', tvdbId:0, titleSlug:`film-${i + 1}`
    }));
    const h = setup(t, Array.from({length:20}, (_, i) =>
        `<article><a href="https://themoviedb.org/movie/${1000 - i}">Film ${i}</a></article>`).join('')
        + '<article><a href="https://thetvdb.com/series/a-show">A Show</a></article>', 'https://example.org/', {
        readLibrary: async type => { calls++; return {state:'ready', rows:type === 'movie' ? rows : [{id:9,tvdbId:0}]}; }
    });
    await h.settle();
    assert.equal(idReads, 1000);
    assert.equal(h.w.document.querySelectorAll('button').length, 21);
    assert.equal([...h.w.document.querySelectorAll('button')].filter(b => b.textContent === '✓ In Radarr').length, 20);
    assert.match(h.w.document.querySelector('article:last-child button').title, /needs an exact ID/);
    h.w.dispatchEvent(new h.w.Event('focus'));
    await h.settle();
    assert.equal(calls, 2);
    assert.equal(idReads, 1000);
});
