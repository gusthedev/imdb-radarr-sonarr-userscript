// ==UserScript==
// @name         IMDb to Radarr/Sonarr Loader
// @namespace    local.imdb.radarr.sonarr.loader
// @version      1.5.0
// @description  Loads the shared IMDb/TMDB/TVDB-to-Radarr/Sonarr script with private local configuration.
// @match        *://*/*
// @exclude      *://mdblist.com/*
// @exclude      *://*.mdblist.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      raw.githubusercontent.com
// @connect      sonarr.example.com
// @connect      radarr.example.com
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const AMBIGUOUS_BEHAVIOR_KEY = 'imdbRsLoader.ambiguousBehavior.v1';
    const storedAmbiguousBehavior = GM_getValue(AMBIGUOUS_BEHAVIOR_KEY, 'both');
    // These remain private in Tampermonkey storage. Add the chosen hosts to @connect.
    const LIBRARY_CONNECTIONS = {
        movie: { baseUrl: GM_getValue('imdbRs.library.movie.url', ''), apiKey: GM_getValue('imdbRs.library.movie.key', '') },
        tv: { baseUrl: GM_getValue('imdbRs.library.tv.url', ''), apiKey: GM_getValue('imdbRs.library.tv.key', '') }
    };
    const libraryRequests = new Map();
    const libraryFailures = new Map();
    const LIBRARY_TTL = 5 * 60 * 1000;

    function readLibrary(type, force = false) {
        const connection = LIBRARY_CONNECTIONS[type];
        if (!connection?.baseUrl || !connection.apiKey) return Promise.resolve({ state: 'unconfigured' });
        if (libraryRequests.has(type)) return libraryRequests.get(type);
        const cacheKey = `imdbRs.library.${type}.cache.v1`;
        const cached = GM_getValue(cacheKey, null);
        if (!force && cached?.baseUrl === connection.baseUrl && Array.isArray(cached.rows)
            && Date.now() - cached.at >= 0 && Date.now() - cached.at < LIBRARY_TTL) {
            return Promise.resolve({ state: 'ready', rows: cached.rows });
        }
        if (!force && Date.now() - (libraryFailures.get(type) || 0) < 60_000) {
            return Promise.resolve({ state: 'unavailable' });
        }
        const request = new Promise(resolve => {
            const fail = () => {
                libraryFailures.set(type, Date.now());
                resolve({ state: 'unavailable' });
            };
            try {
                const base = new URL(connection.baseUrl);
                if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
                    fail(); return;
                }
                const url = base.href.replace(/\/$/, '') + '/api/v3/' + (type === 'tv' ? 'series' : 'movie');
                GM_xmlhttpRequest({
                    method: 'GET', url, timeout: 10_000,
                    headers: { 'X-Api-Key': connection.apiKey, Accept: 'application/json' },
                    onload(response) {
                        try {
                            if (response.status !== 200) { fail(); return; }
                            const data = JSON.parse(response.responseText);
                            if (!Array.isArray(data) || data.some(item => !item || !Number.isInteger(item.id) || item.id <= 0)) { fail(); return; }
                            // Never persist paths, artwork, or API credentials in the library cache.
                            const rows = data.map(item => ({
                                id: item.id, imdbId: item.imdbId || '', tmdbId: item.tmdbId || 0,
                                tvdbId: item.tvdbId || 0, titleSlug: item.titleSlug || '',
                                monitored: item.monitored === true,
                                hasFile: type === 'movie' ? item.hasFile === true : (item.statistics?.episodeFileCount || 0) > 0
                            }));
                            GM_setValue(cacheKey, { baseUrl: connection.baseUrl, at: Date.now(), rows });
                            libraryFailures.delete(type);
                            resolve({ state: 'ready', rows });
                        } catch { fail(); }
                    },
                    onerror: fail, ontimeout: fail, onabort: fail
                });
            } catch { fail(); }
        });
        libraryRequests.set(type, request);
        request.then(() => libraryRequests.delete(type));
        return request;
    }

    // Keep your real service URLs in your locally installed copy of this loader.
    globalThis.IMDB_RS_CONFIG = Object.freeze({
        sonarrBaseUrl: 'https://sonarr.example.com',
        radarrBaseUrl: 'https://radarr.example.com',
        ambiguousImdbBehavior: ['both', 'radarr', 'sonarr'].includes(storedAmbiguousBehavior)
            ? storedAmbiguousBehavior
            : 'both',
        excludedDomains: ['example.com'],
        readLibrary
    });

    const SHARED_SCRIPT_URL = 'https://raw.githubusercontent.com/gusthedev/imdb-radarr-sonarr-userscript/main/imdb-radarr-sonarr.user.js';
    const UPDATE_INTERVAL = 60 * 60 * 1000;
    const REQUEST_TIMEOUT = 15_000;
    const INSTANCE_KEY = Symbol.for('shared.imdb.radarr.sonarr.instance');
    const STORAGE = Object.freeze({
        source: 'imdbRsLoader.sharedCore.source.v2',
        fallbackSource: 'imdbRsLoader.sharedCore.fallbackSource.v2',
        etag: 'imdbRsLoader.sharedCore.etag.v2',
        lastAttempt: 'imdbRsLoader.sharedCore.lastAttempt.v2',
        rejectedSignature: 'imdbRsLoader.sharedCore.rejectedSignature.v2',
        ambiguousBehavior: AMBIGUOUS_BEHAVIOR_KEY
    });

    let activeSource = '';
    let updateInFlight = false;

    function metadataValue(source, key) {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return String(source || '').match(new RegExp(`^//\\s*@${escapedKey}\\s+(.+?)\\s*$`, 'm'))?.[1] || '';
    }

    function sharedCoreVersion(source) {
        return metadataValue(source, 'version') || 'unknown version';
    }

    function isValidSharedCore(source) {
        if (typeof source !== 'string' || source.length < 1_000 || source.length > 500_000) return false;
        if (metadataValue(source, 'name') !== 'IMDb to Radarr/Sonarr (Shared Core)') return false;
        if (metadataValue(source, 'namespace') !== 'shared.imdb.radarr.sonarr') return false;
        if (!/^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(metadataValue(source, 'version'))) return false;
        if (!source.includes('globalThis.IMDB_RS_CONFIG')) return false;

        try {
            new Function(source);
            return true;
        } catch {
            return false;
        }
    }

    function sourceSignature(source) {
        let hash = 0x811c9dc5;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return `${source.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    function readCachedSource(key, label) {
        const source = GM_getValue(key, '');
        if (isValidSharedCore(source)) return source;
        if (source) {
            GM_deleteValue(key);
            console.warn(`[IMDb to Radarr/Sonarr loader] Discarded an invalid cached ${label}.`);
        }
        return '';
    }

    function readCachedSources() {
        const primary = readCachedSource(STORAGE.source, 'shared core');
        if (!primary) GM_deleteValue(STORAGE.etag);
        const fallback = readCachedSource(STORAGE.fallbackSource, 'fallback core');
        return { primary, fallback: fallback === primary ? '' : fallback };
    }

    function executeSharedCore(source, { clearRejected = true } = {}) {
        if (globalThis[INSTANCE_KEY]) return true;
        if (activeSource || !isValidSharedCore(source)) return false;
        try {
            eval(`${source}\n//# sourceURL=imdb-radarr-sonarr.user.js`);
            if (!globalThis[INSTANCE_KEY]) throw new Error('The shared core returned without initializing.');
            activeSource = source;
            // Starting an older working version must not pardon a rejected update.
            if (clearRejected && GM_getValue(STORAGE.rejectedSignature, '') === sourceSignature(source)) {
                GM_deleteValue(STORAGE.rejectedSignature);
            }
            return true;
        } catch (error) {
            GM_setValue(STORAGE.rejectedSignature, sourceSignature(source));
            console.error('[IMDb to Radarr/Sonarr loader] Could not start the shared script.', error);
            return false;
        }
    }

    function startCachedCore() {
        const { primary, fallback } = readCachedSources();
        if (primary && executeSharedCore(primary)) return;
        if (primary) {
            GM_deleteValue(STORAGE.source);
            GM_deleteValue(STORAGE.etag);
        }
        if (fallback && executeSharedCore(fallback, { clearRejected: false })) {
            GM_setValue(STORAGE.source, fallback);
            GM_deleteValue(STORAGE.fallbackSource);
            GM_deleteValue(STORAGE.etag);
            console.warn(`[IMDb to Radarr/Sonarr loader] Restored shared core ${sharedCoreVersion(fallback)}.`);
        } else if (fallback) {
            GM_deleteValue(STORAGE.fallbackSource);
        }
    }

    function responseHeader(response, headerName) {
        const target = headerName.toLowerCase();
        for (const line of String(response.responseHeaders || '').split(/\r?\n/)) {
            const separator = line.indexOf(':');
            if (separator < 0 || line.slice(0, separator).trim().toLowerCase() !== target) continue;
            return line.slice(separator + 1).trim();
        }
        return '';
    }

    function notifyManual(message) {
        window.alert(`[IMDb to Radarr/Sonarr loader] ${message}`);
    }

    function checkForSharedCoreUpdate({ manual = false } = {}) {
        if (updateInFlight) {
            if (manual) notifyManual('An update check is already running.');
            return;
        }

        updateInFlight = true;
        GM_setValue(STORAGE.lastAttempt, Date.now());

        const { primary, fallback } = readCachedSources();
        const previousSource = primary || fallback;
        const etag = primary ? GM_getValue(STORAGE.etag, '') : '';
        const headers = etag ? { 'If-None-Match': etag } : {};
        if (manual) {
            headers['Cache-Control'] = 'no-cache';
            headers.Pragma = 'no-cache';
        }

        function fail(message, error) {
            updateInFlight = false;
            const suffix = activeSource || previousSource ? ' The cached core remains active.' : '';
            console.warn(`[IMDb to Radarr/Sonarr loader] ${message}${suffix}`, error || '');
            if (manual) notifyManual(`${message}${suffix}`);
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: manual ? `${SHARED_SCRIPT_URL}?tm_refresh=${Date.now()}` : SHARED_SCRIPT_URL,
            headers,
            timeout: REQUEST_TIMEOUT,
            onload(response) {
                updateInFlight = false;

                if (response.status === 304 && previousSource) {
                    if (!activeSource) executeSharedCore(previousSource);
                    if (manual) notifyManual(`The shared core is current (${sharedCoreVersion(previousSource)}).`);
                    return;
                }
                if (response.status !== 200) {
                    fail(`GitHub returned HTTP ${response.status}.`);
                    return;
                }

                const nextSource = response.responseText;
                if (!isValidSharedCore(nextSource)) {
                    fail('GitHub returned an invalid shared core; it was not saved.');
                    return;
                }

                const version = sharedCoreVersion(nextSource);
                if (sourceSignature(nextSource) === GM_getValue(STORAGE.rejectedSignature, '')) {
                    fail(`Shared core ${version} failed to start previously and was not saved again.`);
                    return;
                }

                const changed = nextSource !== previousSource;
                let executedNow = false;
                if (!activeSource && !previousSource) {
                    if (!executeSharedCore(nextSource)) {
                        fail(`Shared core ${version} could not start and was not saved.`);
                        return;
                    }
                    executedNow = true;
                }
                if (previousSource && changed) GM_setValue(STORAGE.fallbackSource, previousSource);
                GM_setValue(STORAGE.source, nextSource);
                const nextEtag = responseHeader(response, 'etag');
                if (nextEtag) GM_setValue(STORAGE.etag, nextEtag);
                else GM_deleteValue(STORAGE.etag);

                if (manual) {
                    notifyManual(executedNow
                        ? `Shared core ${version} was saved and started.`
                        : changed
                        ? `Shared core ${version} was saved. Reload the page to use it.`
                        : `The shared core is current (${version}).`);
                } else if (changed && previousSource) {
                    console.info(`[IMDb to Radarr/Sonarr loader] Shared core ${version} cached for the next page load.`);
                }
            },
            onerror(error) {
                fail('The shared core update check failed.', error);
            },
            ontimeout() {
                fail('The shared core update check timed out.');
            }
        });
    }

    GM_registerMenuCommand('Check for shared-core updates now', () => {
        checkForSharedCoreUpdate({ manual: true });
    });

    GM_registerMenuCommand('Show shared-core status', () => {
        const { primary, fallback } = readCachedSources();
        const lastAttempt = Number(GM_getValue(STORAGE.lastAttempt, 0)) || 0;
        notifyManual([
            `Active: ${globalThis[INSTANCE_KEY]?.version || (activeSource ? sharedCoreVersion(activeSource) : 'none')}`,
            `Cached: ${primary ? sharedCoreVersion(primary) : 'none'}`,
            `Rollback: ${fallback ? sharedCoreVersion(fallback) : 'none'}`,
            `Ambiguous IMDb: ${globalThis.IMDB_RS_CONFIG.ambiguousImdbBehavior}`,
            `Last update check: ${lastAttempt ? new Date(lastAttempt).toLocaleString() : 'never'}`
        ].join('\n'));
    });

    GM_registerMenuCommand('Cycle ambiguous IMDb action', () => {
        const values = ['both', 'radarr', 'sonarr'];
        const current = globalThis.IMDB_RS_CONFIG.ambiguousImdbBehavior;
        const next = values[(values.indexOf(current) + 1) % values.length];
        GM_setValue(STORAGE.ambiguousBehavior, next);
        notifyManual(`Ambiguous IMDb results will use ${next}. Reload the page to apply it.`);
    });

    GM_registerMenuCommand('Configure library status', () => {
        for (const [type, name] of [['movie', 'Radarr'], ['tv', 'Sonarr']]) {
            const current = LIBRARY_CONNECTIONS[type];
            const baseUrl = window.prompt(`${name} API base URL (blank disables status; its host must be in @connect):`, current.baseUrl);
            if (baseUrl === null) return;
            if (baseUrl.trim()) {
                try {
                    const parsed = new URL(baseUrl.trim());
                    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
                } catch { notifyManual('Use an HTTP(S) base URL without credentials, query, or fragment.'); return; }
            }
            const key = baseUrl.trim() ? window.prompt(`${name} API key (stored only in Tampermonkey):`, '') : '';
            if (key === null) return;
            GM_setValue(`imdbRs.library.${type}.url`, baseUrl.trim().replace(/\/$/, ''));
            GM_setValue(`imdbRs.library.${type}.key`, key.trim());
            GM_deleteValue(`imdbRs.library.${type}.cache.v1`);
        }
        notifyManual('Library-status settings saved. Reload the page to apply them.');
    });

    GM_registerMenuCommand('Refresh library status', () => {
        for (const type of ['movie', 'tv']) GM_deleteValue(`imdbRs.library.${type}.cache.v1`);
        libraryFailures.clear();
        globalThis[INSTANCE_KEY]?.refreshLibraryStatus?.();
    });

    startCachedCore();

    const lastAttempt = Number(GM_getValue(STORAGE.lastAttempt, 0)) || 0;
    // A recent failed request must never strand a page without a core. When
    // nothing initialized, recover immediately; only throttle background
    // update checks while a working core is already active.
    if (!globalThis[INSTANCE_KEY] || Date.now() - lastAttempt >= UPDATE_INTERVAL) {
        checkForSharedCoreUpdate();
    }
})();
