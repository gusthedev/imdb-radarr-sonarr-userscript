const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadTestHook(documentOverride) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'imdb-radarr-sonarr.user.js'),
        'utf8'
    );
    const hook = {};
    const context = {
        URL,
        console,
        document: documentOverride,
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
    assert.deepEqual(plain(hook.serviceTypes(imdbReference, false, 'radarr')), ['movie']);
    assert.deepEqual(plain(hook.serviceTypes(imdbReference, false, 'sonarr')), ['tv']);
});

test('control signatures are stable across separate core evaluations', () => {
    const reference = { source: 'tvdb', id: 'the-dispatcher', type: 'tv', term: 'Last Seen' };
    const expected = JSON.stringify({
        key: 'tvdb:the-dispatcher:tv',
        term: 'Last Seen',
        types: ['tv']
    });
    assert.equal(
        hook.controlSignature('tvdb:the-dispatcher:tv', reference, ['tv']),
        expected
    );
    assert.equal(
        loadTestHook().controlSignature('tvdb:the-dispatcher:tv', reference, ['tv']),
        expected
    );

    const existingControlFromAnotherEvaluation = {
        dataset: {
            ownerHref: 'https://www.thetvdb.com/series/the-dispatcher',
            signature: expected
        }
    };
    assert.equal(hook.hasMatchingControlMetadata(
        existingControlFromAnotherEvaluation,
        link('https://www.thetvdb.com/series/the-dispatcher'),
        expected
    ), true);
    assert.equal(hook.hasMatchingControlMetadata(
        existingControlFromAnotherEvaluation,
        link('https://www.thetvdb.com/series/the-dispatcher'),
        `${expected}-stale`
    ), false);
});

test('matching explicit peer results classify otherwise ambiguous IMDb titles', () => {
    assert.equal(
        hook.normalizeComparableTitle('The Social Reckoning (2026) - TMDB'),
        'the social reckoning 2026'
    );
    assert.equal(
        hook.normalizeComparableTitle('The Social Reckoning (2026)'),
        'the social reckoning 2026'
    );
    assert.deepEqual(plain(hook.peerTypesForTitle('the social reckoning 2026', [
        { title: 'the social reckoning 2026', type: 'movie' },
        { title: 'another title 2026', type: 'tv' }
    ])), ['movie']);
    assert.deepEqual(plain(hook.peerTypesForTitle('shared title 2026', [
        { title: 'shared title 2026', type: 'tv' },
        { title: 'shared title 2026', type: 'movie' }
    ])), ['movie', 'tv']);
});

test('recognizes cross-realm DOM wrappers without instanceof checks', () => {
    const documentWrapper = { nodeType: 9 };
    const elementWrapper = { nodeType: 1, querySelectorAll() {} };
    const anchorWrapper = {
        nodeType: 1,
        tagName: 'a',
        querySelectorAll() {}
    };

    assert.equal(hook.isDocumentNode(documentWrapper), true);
    assert.equal(hook.isElementNode(elementWrapper), true);
    assert.equal(hook.isAnchorNode(anchorWrapper), true);
    assert.equal(hook.isAnchorNode({ ...anchorWrapper, tagName: 'DIV' }), false);
});

test('revisits a child-list mutation target when Google completes a result in stages', () => {
    const resultContainer = { nodeType: 1, querySelectorAll() {} };
    const addedHeading = { nodeType: 1, querySelectorAll() {} };
    const textNode = { nodeType: 3 };

    const roots = hook.childListRoots({
        target: resultContainer,
        addedNodes: [addedHeading, textNode]
    });
    assert.equal(roots.length, 2);
    assert.equal(roots[0], resultContainer);
    assert.equal(roots[1], addedHeading);
});

test('Google controls are placed after the owning link, not inside its heading', () => {
    const owner = link('https://www.imdb.com/title/tt1234567/');
    const container = { querySelector: () => ({ tagName: 'H3' }) };
    assert.equal(hook.findPlacementTarget(owner, container), owner);
});

test('builds one explicit title index for TMDB peers', () => {
    function candidate(href, title) {
        const heading = { textContent: title };
        const container = { querySelector: () => heading };
        return {
            href,
            nodeType: 1,
            tagName: 'A',
            dataset: {},
            parentElement: container,
            querySelector: () => heading,
            querySelectorAll: () => [],
        };
    }
    const candidates = [
        candidate('https://www.themoviedb.org/movie/550-fight-club', 'Fight Club (1999)'),
        candidate('https://www.themoviedb.org/tv/1396-breaking-bad', 'Breaking Bad (2008)')
    ];
    const indexedHook = loadTestHook({ querySelectorAll: () => candidates });
    const index = indexedHook.buildExplicitPeerIndex();
    assert.deepEqual(Array.from(index.get('fight club 1999')), ['movie']);
    assert.deepEqual(Array.from(index.get('breaking bad 2008')), ['tv']);
});
