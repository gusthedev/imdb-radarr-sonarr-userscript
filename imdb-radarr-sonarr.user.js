// ==UserScript==
// @name         IMDb to Radarr/Sonarr (Shared Core)
// @namespace    shared.imdb.radarr.sonarr
// @version      5.2.0
// @description  Adds Radarr or Sonarr controls beside IMDb, TMDB, and TVDB title links using loader-provided endpoints.
// @match        *://*/*
// @exclude      *://mdblist.com/*
// @exclude      *://*.mdblist.com/*
// @exclude      *://imdb.com/*
// @exclude      *://*.imdb.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const loaderConfig = typeof globalThis.IMDB_RS_CONFIG === 'object' && globalThis.IMDB_RS_CONFIG
        ? globalThis.IMDB_RS_CONFIG
        : null;

    function normalizeBaseUrl(value, label) {
        const url = new URL(String(value || ''));
        if (!['https:', 'http:'].includes(url.protocol)) {
            throw new Error(`${label} must use HTTP or HTTPS.`);
        }
        url.pathname = url.pathname.replace(/\/$/, '');
        url.search = '';
        url.hash = '';
        return url.href.replace(/\/$/, '');
    }

    function normalizeHostname(value) {
        return String(value || '').toLowerCase().replace(/^\.+|\.+$/g, '');
    }

    function isDomainOrSubdomain(hostname, domain) {
        const normalizedHostname = normalizeHostname(hostname);
        const normalizedDomain = normalizeHostname(domain);
        return Boolean(normalizedDomain)
            && (normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`));
    }

    let config;
    try {
        if (!loaderConfig) throw new Error('Install this script through its configured loader.');
        config = Object.freeze({
            sonarrBaseUrl: normalizeBaseUrl(loaderConfig.sonarrBaseUrl, 'Sonarr URL'),
            radarrBaseUrl: normalizeBaseUrl(loaderConfig.radarrBaseUrl, 'Radarr URL'),
            excludedDomains: Array.isArray(loaderConfig.excludedDomains)
                ? loaderConfig.excludedDomains.map(normalizeHostname).filter(Boolean)
                : []
        });
    } catch (error) {
        console.error('[IMDb to Radarr/Sonarr] Invalid loader configuration.', error);
        return;
    }

    const pageHostname = normalizeHostname(location.hostname);
    if (config.excludedDomains.some(domain => isDomainOrSubdomain(pageHostname, domain))) return;

    const LINK_SELECTOR = [
        'a[href*="imdb.com/title/"]',
        'a[href*="themoviedb.org/"]',
        'a[href^="/movie/"]',
        'a[href^="/tv/"]',
        'a[href*="thetvdb.com/"]',
        'a[href^="/series/"]'
    ].join(', ');
    const ADDED_ATTRIBUTE = 'data-mdblist-added';
    const TV_PATTERNS = [
        /\btv\s+(?:mini[- ]?series|series|show)\b/i,
        /\bmini[- ]?series\b/i,
        /\blimited\s+series\b/i,
        /\bseason\s*\d{1,2}\b/i,
        /\bepisode\s*\d{1,3}\b/i,
        /\bep\.?\s*\d{1,3}\b/i,
        /\bs\d{1,2}e\d{1,3}\b/i
    ];

    function addStyles() {
        if (document.getElementById('mdblist-userscript-styles')) return;
        const style = document.createElement('style');
        style.id = 'mdblist-userscript-styles';
        style.textContent = `
            .mdblist-link-wrap {
                display: inline-flex !important;
                position: relative !important;
                align-items: center !important;
                margin-inline-start: 5px !important;
                vertical-align: middle !important;
                direction: ltr !important;
                transform: none !important;
            }
            .mdblist-btn {
                box-sizing: border-box !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 30px !important;
                min-height: 22px !important;
                margin: 0 !important;
                padding: 2px 6px !important;
                border: 1px solid #888 !important;
                border-radius: 5px !important;
                background: Canvas !important;
                color: CanvasText !important;
                font: 600 11px/1.2 system-ui, -apple-system, BlinkMacSystemFont, sans-serif !important;
                letter-spacing: 0 !important;
                text-decoration: none !important;
                white-space: nowrap !important;
                cursor: pointer !important;
                opacity: 0.82 !important;
                direction: ltr !important;
                transform: none !important;
                appearance: none !important;
            }
            .mdblist-btn:hover { opacity: 1 !important; filter: brightness(0.96) !important; }
            .mdblist-btn:focus-visible {
                opacity: 1 !important;
                outline: 2px solid #4c9ffe !important;
                outline-offset: 2px !important;
            }
            @media (prefers-color-scheme: dark) {
                .mdblist-btn {
                    background: #242424 !important;
                    color: #f5f5f5 !important;
                    border-color: #777 !important;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function titleFromTVDBLink(link, url) {
        const linkText = String(link.textContent || '').trim();
        if (linkText && !/^https?:\/\//i.test(linkText)) return linkText;

        const slug = url.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?series\/([^/?#]+)/i)?.[1] || '';
        return decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
    }

    function extractMediaReference(link, container = null) {
        try {
            const url = new URL(link.href, location.href);
            const hostname = url.hostname.toLowerCase();

            if (/(^|\.)imdb\.com$/i.test(hostname)) {
                const id = url.pathname.match(/^\/title\/(tt\d+)/i)?.[1];
                return id ? { source: 'imdb', id, type: null, term: `imdb:${id}` } : null;
            }

            if (/(^|\.)themoviedb\.org$/i.test(hostname)) {
                const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(movie|tv)\/(\d+)/i);
                if (!match) return null;
                const type = match[1].toLowerCase() === 'tv' ? 'tv' : 'movie';
                return { source: 'tmdb', id: match[2], type, term: `tmdb:${match[2]}` };
            }

            if (/(^|\.)thetvdb\.com$/i.test(hostname)) {
                const seriesPath = url.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?series\/([^/?#]+)/i);
                if (!seriesPath) return null;

                const visibleContext = [
                    link.textContent,
                    link.title,
                    link.getAttribute('aria-label'),
                    container?.innerText,
                    container?.textContent
                ].filter(Boolean).join(' ');
                const id = [
                    url.searchParams.get('id'),
                    url.searchParams.get('seriesid'),
                    link.dataset.tvdbId,
                    link.dataset.seriesId,
                    /^\d+$/.test(seriesPath[1]) ? seriesPath[1] : '',
                    visibleContext.match(/(?:the\s*)?tvdb(?:\.com)?\s*(?:series\s*)?id\s*[:#]?\s*(\d+)/i)?.[1]
                ].find(value => /^\d+$/.test(String(value || '')));

                if (id) return { source: 'tvdb', id: String(id), type: 'tv', term: `tvdb:${id}` };

                const title = titleFromTVDBLink(link, url);
                return title ? { source: 'tvdb', id: seriesPath[1], type: 'tv', term: title } : null;
            }

            return null;
        } catch {
            return null;
        }
    }

    function hasTVEvidence(text) {
        return TV_PATTERNS.some(pattern => pattern.test(text || ''));
    }

    function findResultContainer(link) {
        const hostname = location.hostname;
        if (hostname.includes('google.')) {
            let node = link.parentElement;
            for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
                if (node.querySelector('h3')) return node;
            }
            return null;
        }
        if (hostname.includes('duckduckgo.com')) return link.closest('[data-testid="result"], article, .result');
        if (hostname.includes('reddit.com')) {
            return link.closest('shreddit-post, article, div[data-testid="post-container"], div[data-click-id="text"]');
        }
        return link.closest('article, li, [role="article"], [role="listitem"]') || link.parentElement;
    }

    function guessType(link, container) {
        const linkContext = [
            link.textContent,
            link.title,
            link.getAttribute('aria-label'),
            link.parentElement?.textContent
        ].filter(Boolean).join(' ');
        if (hasTVEvidence(linkContext)) return 'tv';
        const containerText = container?.innerText || container?.textContent || '';
        return hasTVEvidence(containerText) ? 'tv' : 'movie';
    }

    function linkPlacementScore(link) {
        const text = (link.textContent || '').trim();
        let score = Math.min(text.length, 60);
        if (link.querySelector('h1, h2, h3, h4, [role="heading"]')) score += 200;
        if (link.closest('h1, h2, h3, h4, [role="heading"]')) score += 150;
        if (/^imdb$/i.test(text)) score -= 100;
        if (/^https?:\/\//i.test(text) || /imdb\.com\s*[›>]/i.test(text)) score -= 80;
        return score;
    }

    function referenceKey(reference) {
        return `${reference.source}:${reference.id}:${reference.type || 'unknown'}`;
    }

    function preferredLinkForTitle(link, container, reference) {
        const key = referenceKey(reference);
        const candidates = Array.from(container.querySelectorAll(LINK_SELECTOR))
            .filter(candidate => {
                const candidateReference = extractMediaReference(candidate, container);
                return candidateReference && referenceKey(candidateReference) === key;
            });
        if (!candidates.length) return link;
        return candidates.reduce((best, candidate) =>
            linkPlacementScore(candidate) > linkPlacementScore(best) ? candidate : best
        );
    }

    function findPlacementTarget(link, container) {
        if (location.hostname.includes('google.')) {
            return container.querySelector('h3') || link;
        }
        return link;
    }

    function createMDBListButton(reference, type, link, container) {
        const wrapper = document.createElement('span');
        wrapper.className = 'mdblist-link-wrap';
        wrapper.dataset.mediaKey = referenceKey(reference);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mdblist-btn';
        const service = type === 'tv' ? 'Sonarr' : 'Radarr';
        const baseUrl = type === 'tv' ? config.sonarrBaseUrl : config.radarrBaseUrl;
        button.textContent = service;
        button.title = `Show this title in ${service}`;
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const term = encodeURIComponent(reference.term);
            window.open(`${baseUrl}/add/new?term=${term}`, '_blank', 'noopener');
        });
        wrapper.appendChild(button);

        const target = findPlacementTarget(link, container);
        if (target.matches('h1, h2, h3, h4, [role="heading"]')) {
            target.appendChild(wrapper);
        } else {
            target.insertAdjacentElement('afterend', wrapper);
        }
    }

    function processLink(link) {
        if (!(link instanceof HTMLAnchorElement)) return;
        if (link.getAttribute(ADDED_ATTRIBUTE) === 'true') return;
        const container = findResultContainer(link);
        if (!container) return;
        const reference = extractMediaReference(link, container);
        if (!reference) return;
        if (preferredLinkForTitle(link, container, reference) !== link) return;

        const mediaKey = referenceKey(reference);
        const duplicate = Array.from(container.querySelectorAll('.mdblist-link-wrap'))
            .some(element => element.dataset.mediaKey === mediaKey);
        link.setAttribute(ADDED_ATTRIBUTE, 'true');
        if (duplicate) return;
        createMDBListButton(reference, reference.type || guessType(link, container), link, container);
    }

    function processLinks(context = document) {
        if (!(context instanceof Document || context instanceof Element)) return;
        if (context instanceof Element && context.matches(LINK_SELECTOR)) processLink(context);
        context.querySelectorAll(LINK_SELECTOR).forEach(processLink);
    }

    addStyles();
    processLinks();
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node instanceof Element) processLinks(node);
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
