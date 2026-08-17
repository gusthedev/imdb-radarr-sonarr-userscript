// ==UserScript==
// @name         IMDb to Radarr/Sonarr Loader
// @namespace    local.imdb.radarr.sonarr.loader
// @version      1.2.1
// @description  Loads the shared IMDb/TMDB/TVDB-to-Radarr/Sonarr script with private local configuration.
// @match        *://*/*
// @exclude      *://mdblist.com/*
// @exclude      *://*.mdblist.com/*
// @exclude      *://imdb.com/*
// @exclude      *://*.imdb.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      raw.githubusercontent.com
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // Keep your real service URLs in your locally installed copy of this loader.
    globalThis.IMDB_RS_CONFIG = Object.freeze({
        sonarrBaseUrl: 'https://sonarr.example.com',
        radarrBaseUrl: 'https://radarr.example.com',
        excludedDomains: ['example.com']
    });

    const SHARED_SCRIPT_URL = 'https://raw.githubusercontent.com/gusthedev/imdb-radarr-sonarr-userscript/main/imdb-radarr-sonarr.user.js';
    const UPDATE_INTERVAL = 60 * 60 * 1000;
    const EMPTY_CACHE_RETRY_INTERVAL = 5 * 60 * 1000;
    const REQUEST_TIMEOUT = 15_000;
    const INSTANCE_KEY = Symbol.for('shared.imdb.radarr.sonarr.instance');
    const STORAGE = Object.freeze({
        source: 'imdbRsLoader.sharedCore.source.v1',
        etag: 'imdbRsLoader.sharedCore.etag.v1',
        lastAttempt: 'imdbRsLoader.sharedCore.lastAttempt.v1'
    });

    let executionAttempted = false;
    let updateInFlight = false;

    function sharedCoreVersion(source) {
        return String(source || '').match(/^\/\/\s*@version\s+([^\s]+)\s*$/m)?.[1] || 'unknown version';
    }

    function isValidSharedCore(source) {
        if (typeof source !== 'string' || source.length < 1_000 || source.length > 500_000) return false;
        if (!source.includes('// @name         IMDb to Radarr/Sonarr (Shared Core)')) return false;
        if (!source.includes('// @namespace    shared.imdb.radarr.sonarr')) return false;
        if (!source.includes('globalThis.IMDB_RS_CONFIG')) return false;

        try {
            new Function(source);
            return true;
        } catch {
            return false;
        }
    }

    function readCachedSource() {
        const source = GM_getValue(STORAGE.source, '');
        if (isValidSharedCore(source)) return source;
        if (source) {
            GM_deleteValue(STORAGE.source);
            GM_deleteValue(STORAGE.etag);
            console.warn('[IMDb to Radarr/Sonarr loader] Discarded an invalid cached shared core.');
        }
        return '';
    }

    function executeSharedCore(source) {
        if (globalThis[INSTANCE_KEY]) return true;
        if (executionAttempted || !isValidSharedCore(source)) return false;
        executionAttempted = true;
        try {
            eval(`${source}\n//# sourceURL=imdb-radarr-sonarr.user.js`);
            if (globalThis[INSTANCE_KEY]) return true;
            executionAttempted = false;
            console.warn('[IMDb to Radarr/Sonarr loader] The shared script returned without initializing; it can be retried.');
            return false;
        } catch (error) {
            executionAttempted = false;
            console.error('[IMDb to Radarr/Sonarr loader] Could not start the shared script.', error);
            return false;
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

    function checkForSharedCoreUpdate({ manual = false, executeIfEmpty = false } = {}) {
        if (updateInFlight) {
            if (manual) notifyManual('An update check is already running.');
            return;
        }

        updateInFlight = true;
        GM_setValue(STORAGE.lastAttempt, Date.now());

        const previousSource = readCachedSource();
        const etag = previousSource ? GM_getValue(STORAGE.etag, '') : '';
        const headers = etag ? { 'If-None-Match': etag } : {};

        function fail(message, error) {
            updateInFlight = false;
            const suffix = previousSource ? ' The cached core remains active.' : '';
            console.warn(`[IMDb to Radarr/Sonarr loader] ${message}${suffix}`, error || '');
            if (manual) notifyManual(`${message}${suffix}`);
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: SHARED_SCRIPT_URL,
            headers,
            timeout: REQUEST_TIMEOUT,
            onload(response) {
                updateInFlight = false;

                if (response.status === 304 && previousSource) {
                    executeSharedCore(previousSource);
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

                const changed = nextSource !== previousSource;
                GM_setValue(STORAGE.source, nextSource);
                const nextEtag = responseHeader(response, 'etag');
                if (nextEtag) GM_setValue(STORAGE.etag, nextEtag);
                else GM_deleteValue(STORAGE.etag);

                if ((executeIfEmpty && !previousSource) || !globalThis[INSTANCE_KEY]) {
                    executeSharedCore(nextSource);
                }

                const version = sharedCoreVersion(nextSource);
                if (manual) {
                    notifyManual(changed
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

    const cachedSource = readCachedSource();
    if (cachedSource) executeSharedCore(cachedSource);

    const lastAttempt = Number(GM_getValue(STORAGE.lastAttempt, 0)) || 0;
    const retryInterval = cachedSource ? UPDATE_INTERVAL : EMPTY_CACHE_RETRY_INTERVAL;
    if (Date.now() - lastAttempt >= retryInterval) {
        checkForSharedCoreUpdate({ executeIfEmpty: !cachedSource });
    }
})();
