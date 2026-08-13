const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadTestHook() {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'imdb-radarr-sonarr.user.js'),
        'utf8'
    );
    const hook = {};
    const context = {
        URL,
        console,
        location: {
            href: 'https://www.google.com/search?q=title',
            hostname: 'www.google.com'
        },
        IMDB_RS_CONFIG: {
            sonarrBaseUrl: 'https://sonarr.example.com',
            radarrBaseUrl: 'https://radarr.example.com',
            excludedDomains: [],
            testMode: true
        },
        __IMDB_RS_TEST_HOOK__: hook
    };
    context.globalThis = context;
    vm.runInNewContext(source, context, { filename: 'imdb-radarr-sonarr.user.js' });
    return hook;
}

function link(href, textContent = '') {
    return {
        href,
        textContent,
        innerText: textContent,
        title: '',
        dataset: {},
        getAttribute: () => '',
        querySelector: () => null
    };
}

function plain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

const hook = loadTestHook();

test('accepts only canonical IMDb title paths', () => {
    assert.deepEqual(
        plain(hook.extractMediaReference(link('https://www.imdb.com/title/tt1234567/?ref_=fn_all_ttl_1'))),
        { source: 'imdb', id: 'tt1234567', type: null, term: 'imdb:tt1234567' }
    );
    assert.equal(hook.extractMediaReference(link('https://www.imdb.com/title/tt1234567/episodes/')), null);
    assert.equal(hook.extractMediaReference(link('https://www.imdb.com/title/tt1234567/fullcredits/')), null);
    assert.equal(hook.extractMediaReference(link('https://www.imdb.com/name/nm1234567/')), null);
});

test('accepts canonical TMDB movie and TV paths with localized prefixes and same-segment slugs', () => {
    assert.deepEqual(
        plain(hook.extractMediaReference(link('https://www.themoviedb.org/movie/550-fight-club'))),
        { source: 'tmdb', id: '550', type: 'movie', term: 'tmdb:550' }
    );
    assert.deepEqual(
        plain(hook.extractMediaReference(link('https://www.themoviedb.org/pt-BR/tv/1396-breaking-bad/'))),
        { source: 'tmdb', id: '1396', type: 'tv', term: 'tmdb:1396' }
    );
    assert.equal(hook.extractMediaReference(link('https://www.themoviedb.org/movie/550/cast')), null);
    assert.equal(hook.extractMediaReference(link('https://www.themoviedb.org/tv/1396/season/1')), null);
    assert.equal(hook.extractMediaReference(link('https://www.themoviedb.org/person/287')), null);
});

test('uses exact IDs from canonical and legacy TVDB series links', () => {
    assert.deepEqual(
        plain(hook.extractMediaReference(link('https://thetvdb.com/series/450085'))),
        { source: 'tvdb', id: '450085', type: 'tv', term: 'tvdb:450085' }
    );
    assert.deepEqual(
        plain(hook.extractMediaReference(link('https://thetvdb.com/?tab=series&id=450085'))),
        { source: 'tvdb', id: '450085', type: 'tv', term: 'tvdb:450085' }
    );
    assert.deepEqual(
        plain(hook.extractMediaReference(link('https://thetvdb.com/index.php?TAB=SERIES&seriesid=81189'))),
        { source: 'tvdb', id: '81189', type: 'tv', term: 'tvdb:81189' }
    );
});

test('uses a title fallback for slug-only TVDB series pages and ignores descendants', () => {
    assert.deepEqual(
        plain(hook.extractMediaReference(link('https://thetvdb.com/series/the-lowdown', 'The Lowdown'))),
        { source: 'tvdb', id: 'the-lowdown', type: 'tv', term: 'The Lowdown' }
    );
    assert.equal(hook.extractMediaReference(link('https://thetvdb.com/series/the-lowdown/episodes/123')), null);
    assert.equal(hook.extractMediaReference(link('https://thetvdb.com/series/the-lowdown/people/456')), null);
    assert.equal(hook.extractMediaReference(link('https://thetvdb.com/?tab=episode&id=123')), null);
    assert.equal(hook.extractMediaReference(link('https://thetvdb.com/?tab=series')), null);
});

test('relative TMDB and TVDB selectors are limited to their own sites', () => {
    const generic = hook.buildLinkSelector('www.google.com');
    assert.equal(generic.includes('a[href*="/movie/"]'), false);
    assert.equal(generic.includes('a[href*="/series/"]'), false);
    assert.equal(hook.buildLinkSelector('www.themoviedb.org').includes('a[href*="/movie/"]'), true);
    assert.equal(hook.buildLinkSelector('thetvdb.com').includes('a[href*="/series/"]'), true);
});

test('ambiguous IMDb links offer both services while explicit TV evidence selects Sonarr', () => {
    const imdbReference = { source: 'imdb', id: 'tt1234567', type: null, term: 'imdb:tt1234567' };
    assert.deepEqual(plain(hook.serviceTypes(imdbReference, false)), ['movie', 'tv']);
    assert.deepEqual(plain(hook.serviceTypes(imdbReference, true)), ['tv']);
    assert.deepEqual(
        plain(hook.serviceTypes({ source: 'tmdb', id: '550', type: 'movie', term: 'tmdb:550' }, true)),
        ['movie']
    );
});
