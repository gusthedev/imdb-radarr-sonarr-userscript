// ==UserScript==
// @name         IMDb to Radarr/Sonarr Loader
// @namespace    local.imdb.radarr.sonarr.loader
// @version      1.1.0
// @description  Loads the shared IMDb/TMDB/TVDB-to-Radarr/Sonarr script with private local configuration.
// @match        *://*/*
// @exclude      *://mdblist.com/*
// @exclude      *://*.mdblist.com/*
// @exclude      *://imdb.com/*
// @exclude      *://*.imdb.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
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

    const sharedScriptUrl = `https://raw.githubusercontent.com/gusthedev/imdb-radarr-sonarr-userscript/main/imdb-radarr-sonarr.user.js?t=${Date.now()}`;

    GM_xmlhttpRequest({
        method: 'GET',
        url: sharedScriptUrl,
        headers: { 'Cache-Control': 'no-cache' },
        onload(response) {
            if (response.status !== 200) {
                console.error(`[IMDb to Radarr/Sonarr loader] GitHub returned HTTP ${response.status}.`);
                return;
            }
            try {
                eval(`${response.responseText}\n//# sourceURL=imdb-radarr-sonarr.user.js`);
            } catch (error) {
                console.error('[IMDb to Radarr/Sonarr loader] Could not start the shared script.', error);
            }
        },
        onerror(error) {
            console.error('[IMDb to Radarr/Sonarr loader] The shared script is unavailable.', error);
        }
    });
})();
