// ==UserScript==
// @name         IMDb to Radarr/Sonarr (Shared Core)
// @namespace    shared.imdb.radarr.sonarr
// @version      5.4.1
// @description  Adds Radarr and Sonarr controls beside canonical IMDb, TMDB, and TVDB title links using loader-provided endpoints.
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

    const INSTANCE_KEY = Symbol.for('shared.imdb.radarr.sonarr.instance');
    if (globalThis[INSTANCE_KEY]) return;

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
            ambiguousImdbBehavior: ['both', 'radarr', 'sonarr'].includes(loaderConfig.ambiguousImdbBehavior)
                ? loaderConfig.ambiguousImdbBehavior
                : 'both',
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

    function buildLinkSelector(hostname) {
        const selectors = [
            'a[href*="imdb.com/title/"]',
            'a[href*="themoviedb.org/"]',
            'a[href*="thetvdb.com/"]'
        ];
        if (isDomainOrSubdomain(hostname, 'themoviedb.org')) {
            selectors.push('a[href*="/movie/"]', 'a[href*="/tv/"]');
        }
        if (isDomainOrSubdomain(hostname, 'thetvdb.com')) {
            selectors.push('a[href*="/series/"]', 'a[href*="tab=series"]');
        }
        return [...new Set(selectors)].join(', ');
    }

    const LINK_SELECTOR = buildLinkSelector(pageHostname);
    const CONTROL_SELECTOR = '.mdblist-link-wrap[data-imdb-rs-control="true"]';
    const TV_PATTERNS = [
        /\btv\s+(?:mini[- ]?series|series|show)\b/i,
        /\bmini[- ]?series\b/i,
        /\blimited\s+series\b/i,
        /\bseason\s*\d{1,2}\b/i,
        /\bepisode\s*\d{1,3}\b/i,
        /\bep\.?\s*\d{1,3}\b/i,
        /\bs\d{1,2}e\d{1,3}\b/i
    ];

    // Safari userscript managers can expose DOM nodes through cross-realm
    // wrappers. Node-type and tag-name checks work across those boundaries,
    // while `instanceof Element` / `HTMLAnchorElement` may silently fail.
    function isDocumentNode(value) {
        return Boolean(value) && value.nodeType === 9;
    }

    function isElementNode(value) {
        return Boolean(value) && value.nodeType === 1
            && typeof value.querySelectorAll === 'function';
    }

    function isAnchorNode(value) {
        return isElementNode(value) && String(value.tagName || '').toUpperCase() === 'A';
    }

    function addStyles() {
        if (document.getElementById('mdblist-userscript-styles')) return;
        const style = document.createElement('style');
        style.id = 'mdblist-userscript-styles';
        style.textContent = `
            .mdblist-link-wrap {
                display: inline-flex !important;
                position: relative !important;
                align-items: center !important;
                gap: 3px !important;
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

    function textWithoutControls(element) {
        if (!element) return '';
        const clone = element.cloneNode?.(true);
        if (clone) {
            clone.querySelectorAll?.(CONTROL_SELECTOR).forEach(control => control.remove());
            return String(clone.innerText || clone.textContent || '').trim();
        }
        return String(element.innerText || element.textContent || '').trim();
    }

    function titleFromTVDBLink(link, url, container = null) {
        const heading = link.querySelector?.('h1, h2, h3, h4, [role="heading"]')
            || container?.querySelector?.('h3');
        const headingText = textWithoutControls(heading);
        if (headingText) return headingText;

        const visibleLines = textWithoutControls(link)
            .split(/\n+/)
            .map(line => line.trim())
            .filter(Boolean);
        const firstLine = visibleLines[0] || '';
        if (firstLine && !/^https?:\/\//i.test(firstLine) && !/^thetvdb\.com$/i.test(firstLine)) {
            return firstLine;
        }

        const slug = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?series\/([^/?#]+)\/?$/i)?.[1] || '';
        return decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
    }

    function searchParamCaseInsensitive(url, name) {
        const expectedName = String(name).toLowerCase();
        for (const [key, value] of url.searchParams) {
            if (key.toLowerCase() === expectedName) return value;
        }
        return '';
    }

    function numericTVDBId(url, link, slug = '') {
        return [
            searchParamCaseInsensitive(url, 'id'),
            searchParamCaseInsensitive(url, 'seriesid'),
            link?.dataset?.tvdbId,
            link?.dataset?.seriesId,
            /^\d+$/.test(slug) ? slug : ''
        ].find(value => /^\d+$/.test(String(value || ''))) || '';
    }

    function extractMediaReference(link, container = null) {
        try {
            const url = new URL(link.href, location.href);
            const hostname = url.hostname.toLowerCase();

            if (/(^|\.)imdb\.com$/i.test(hostname)) {
                const id = url.pathname.match(/^\/title\/(tt\d+)\/?$/i)?.[1];
                return id ? { source: 'imdb', id, type: null, term: `imdb:${id}` } : null;
            }

            if (/(^|\.)themoviedb\.org$/i.test(hostname)) {
                const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(movie|tv)\/(\d+)(?:-[^/]+)?\/?$/i);
                if (!match) return null;
                const type = match[1].toLowerCase() === 'tv' ? 'tv' : 'movie';
                return { source: 'tmdb', id: match[2], type, term: `tmdb:${match[2]}` };
            }

            if (/(^|\.)thetvdb\.com$/i.test(hostname)) {
                const seriesPath = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?series\/([^/?#]+)\/?$/i);
                const legacyPath = /^(?:\/|\/index\.php)$/i.test(url.pathname)
                    && searchParamCaseInsensitive(url, 'tab').toLowerCase() === 'series';
                if (!seriesPath && !legacyPath) return null;

                const slug = seriesPath?.[1] || '';
                const id = numericTVDBId(url, link, slug);
                if (id) return { source: 'tvdb', id: String(id), type: 'tv', term: `tvdb:${id}` };
                if (legacyPath) return null;

                const title = titleFromTVDBLink(link, url, container);
                return title ? { source: 'tvdb', id: slug, type: 'tv', term: title } : null;
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

    function hasTVEvidenceForLink(link, container) {
        const linkContext = [
            textWithoutControls(link),
            link.title,
            link.getAttribute('aria-label'),
            textWithoutControls(link.parentElement)
        ].filter(Boolean).join(' ');
        if (hasTVEvidence(linkContext)) return true;
        return hasTVEvidence(textWithoutControls(container));
    }

    function serviceTypes(reference, tvEvidence = false, ambiguousBehavior = config?.ambiguousImdbBehavior || 'both') {
        if (reference.type === 'tv') return ['tv'];
        if (reference.type === 'movie') return ['movie'];
        if (tvEvidence || ambiguousBehavior === 'sonarr') return ['tv'];
        if (ambiguousBehavior === 'radarr') return ['movie'];
        return ['movie', 'tv'];
    }

    function normalizeComparableTitle(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s*[-–—|]\s*(?:imdb|tmdb|themoviedb|thetvdb)(?:\.com)?\s*$/i, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function comparableTitleForLink(link, container) {
        const heading = link.querySelector?.('h1, h2, h3, h4, [role="heading"]')
            || container?.querySelector?.('h1, h2, h3, h4, [role="heading"]');
        return normalizeComparableTitle(textWithoutControls(heading));
    }

    function peerTypesForTitle(targetTitle, peers) {
        const types = new Set();
        for (const peer of peers) {
            if (peer.title === targetTitle && ['movie', 'tv'].includes(peer.type)) {
                types.add(peer.type);
            }
        }
        return ['movie', 'tv'].filter(type => types.has(type));
    }

    function buildExplicitPeerIndex() {
        const index = new Map();
        if (!location.hostname.includes('google.') && !location.hostname.includes('duckduckgo.com')) {
            return index;
        }
        for (const candidate of document.querySelectorAll(LINK_SELECTOR)) {
            if (!isAnchorNode(candidate)) continue;
            const candidateContainer = findResultContainer(candidate);
            if (!candidateContainer) continue;
            const reference = extractMediaReference(candidate, candidateContainer);
            if (!reference?.type) continue;
            const title = comparableTitleForLink(candidate, candidateContainer);
            if (!title) continue;
            if (!index.has(title)) index.set(title, new Set());
            index.get(title).add(reference.type);
        }
        return index;
    }

    function explicitPeerTypes(link, container, peerIndex) {
        if (!location.hostname.includes('google.') && !location.hostname.includes('duckduckgo.com')) {
            return [];
        }
        const targetTitle = comparableTitleForLink(link, container);
        if (!targetTitle) return [];
        const types = peerIndex?.get(targetTitle) || new Set();
        return ['movie', 'tv'].filter(type => types.has(type));
    }

    function linkPlacementScore(link) {
        const text = textWithoutControls(link);
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

    function controlSignature(key, reference, types) {
        return JSON.stringify({ key, term: reference.term, types });
    }

    const controlState = new WeakMap();
    const knownContainers = new WeakSet();

    function isVerticallyFlipped(element) {
        if (!element) return false;
        let transform = element.style?.transform || '';
        try {
            if (typeof globalThis.getComputedStyle === 'function') {
                transform = globalThis.getComputedStyle(element).transform || transform;
            }
        } catch {
            // Cross-realm DOM wrappers can reject computed-style inspection.
        }
        if (/scaleY\(\s*-/.test(transform)) return true;
        const matrix = transform.match(/^matrix\(([^)]+)\)$/);
        if (!matrix) return false;
        const values = matrix[1].split(',').map(Number);
        return values.length === 6 && Number.isFinite(values[3]) && values[3] < 0;
    }

    function findPlacementTarget(link, container) {
        if (location.hostname.includes('google.')
            && link.querySelector?.('h1, h2, h3, h4, [role="heading"]')) {
            // Google currently flips part of each organic-result header to
            // reorder the site line and title, then overlays its three-dot menu
            // on that same block. Inserting beside the link inherits the flip
            // and collides with the menu. Place controls after the whole header
            // instead; this also keeps buttons outside the result anchor.
            for (let node = link.parentElement, depth = 0;
                node && depth < 4;
                node = node.parentElement, depth += 1) {
                if (isVerticallyFlipped(node)) return node.parentElement || link;
                if (node === container) break;
            }
        }
        return link;
    }

    function controlSearchScope(container) {
        if (location.hostname.includes('google.')) {
            for (let node = container, depth = 0;
                node && depth < 4;
                node = node.parentElement, depth += 1) {
                if (isVerticallyFlipped(node)) {
                    return node.parentElement?.parentElement || node.parentElement || container;
                }
            }
        }
        return container;
    }

    function isCurrentPlacement(wrapper, link, container) {
        const target = findPlacementTarget(link, container);
        return wrapper.previousElementSibling === target;
    }

    function rememberControl(wrapper, link, container, signature) {
        wrapper.dataset.ownerHref = link.href;
        wrapper.dataset.signature = signature;
        controlState.set(wrapper, {
            container,
            owner: link,
            ownerHref: link.href,
            signature
        });
    }

    function hasMatchingControlMetadata(wrapper, link, signature) {
        const state = controlState.get(wrapper);
        const ownerHref = wrapper.dataset.ownerHref || state?.ownerHref || '';
        const storedSignature = wrapper.dataset.signature || state?.signature || '';
        return ownerHref === link.href && storedSignature === signature;
    }

    function isReusableControl(wrapper, link, container, signature) {
        return hasMatchingControlMetadata(wrapper, link, signature)
            && isCurrentPlacement(wrapper, link, container);
    }

    function createMDBListButtons(reference, types, link, container, signature) {
        const wrapper = document.createElement('span');
        wrapper.className = 'mdblist-link-wrap';
        wrapper.dataset.imdbRsControl = 'true';
        wrapper.dataset.mediaKey = referenceKey(reference);
        for (const type of types) {
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
        }

        const target = findPlacementTarget(link, container);
        target.insertAdjacentElement('afterend', wrapper);
        rememberControl(wrapper, link, container, signature);
        return wrapper;
    }

    function linksInContainer(container) {
        const links = [];
        if (container.matches?.(LINK_SELECTOR)) links.push(container);
        links.push(...container.querySelectorAll(LINK_SELECTOR));
        return links;
    }

    function reconcileContainer(container, peerIndex) {
        if (!isElementNode(container) || !container.isConnected) return;
        knownContainers.add(container);

        const groups = new Map();
        for (const link of linksInContainer(container)) {
            if (!isAnchorNode(link)) continue;
            const reference = extractMediaReference(link, container);
            if (!reference) continue;
            const key = referenceKey(reference);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ link, reference });
        }

        // Treat matching controls as shared DOM state, not as private state owned by
        // this particular evaluation. This lets a second loader/core evaluation
        // adopt the existing control instead of creating an identical neighbor.
        const managedControls = Array.from(controlSearchScope(container).querySelectorAll(CONTROL_SELECTOR));
        const controlsByKey = new Map();
        for (const wrapper of managedControls) {
            const key = wrapper.dataset.mediaKey || '';
            if (!controlsByKey.has(key)) controlsByKey.set(key, []);
            controlsByKey.get(key).push(wrapper);
        }

        for (const wrapper of managedControls) {
            if (!groups.has(wrapper.dataset.mediaKey || '')) wrapper.remove();
        }

        for (const [key, candidates] of groups) {
            const preferred = candidates.reduce((best, candidate) =>
                linkPlacementScore(candidate.link) > linkPlacementScore(best.link) ? candidate : best
            );
            const peerTypes = preferred.reference.type
                ? []
                : explicitPeerTypes(preferred.link, container, peerIndex);
            const types = peerTypes.length
                ? peerTypes
                : serviceTypes(
                    preferred.reference,
                    hasTVEvidenceForLink(preferred.link, container)
                );
            const signature = controlSignature(key, preferred.reference, types);
            const existing = controlsByKey.get(key) || [];
            let current = existing.find(wrapper =>
                isReusableControl(wrapper, preferred.link, container, signature)
            );
            for (const wrapper of existing) {
                if (wrapper !== current) wrapper.remove();
            }
            if (!current) {
                current = createMDBListButtons(
                    preferred.reference,
                    types,
                    preferred.link,
                    container,
                    signature
                );
            } else {
                rememberControl(current, preferred.link, container, signature);
            }
        }
    }

    function collectKnownContainer(element, containers) {
        for (let current = element; current; current = current.parentElement) {
            if (knownContainers.has(current)) {
                containers.add(current);
                return;
            }
        }
    }

    function collectContainers(root, containers) {
        if (!(isDocumentNode(root) || isElementNode(root))) return;
        if (isElementNode(root)) collectKnownContainer(root, containers);

        const links = [];
        if (isElementNode(root) && root.matches(LINK_SELECTOR)) links.push(root);
        links.push(...root.querySelectorAll(LINK_SELECTOR));
        for (const link of links) {
            if (!isAnchorNode(link)) continue;
            const container = findResultContainer(link);
            if (container) containers.add(container);
        }
    }

    function processRoots(roots) {
        const containers = new Set();
        for (const root of roots) collectContainers(root, containers);
        const peerIndex = buildExplicitPeerIndex();
        for (const container of containers) reconcileContainer(container, peerIndex);
    }

    let queuedRoots = new Set();
    let flushScheduled = false;

    function flushQueuedRoots() {
        flushScheduled = false;
        const roots = Array.from(queuedRoots).filter(root =>
            isDocumentNode(root) || (isElementNode(root) && root.isConnected)
        );
        queuedRoots = new Set();
        const outermostRoots = roots.filter(root => !roots.some(other =>
            other !== root && typeof other.contains === 'function' && other.contains(root)
        ));
        processRoots(outermostRoots);
    }

    function queueRoot(root) {
        if (!(isDocumentNode(root) || isElementNode(root))) return;
        queuedRoots.add(root);
        if (flushScheduled) return;
        flushScheduled = true;
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(flushQueuedRoots);
        } else {
            setTimeout(flushQueuedRoots, 16);
        }
    }

    function queueContainingKnownContainer(element) {
        for (let current = element; current; current = current.parentElement) {
            if (knownContainers.has(current)) {
                queueRoot(current);
                return;
            }
        }
    }

    function childListRoots(mutation) {
        const roots = [];
        if (isElementNode(mutation.target)) roots.push(mutation.target);
        for (const node of mutation.addedNodes || []) {
            if (isElementNode(node)) roots.push(node);
        }
        return roots;
    }

    if (loaderConfig.testMode === true
        && globalThis.__IMDB_RS_TEST_HOOK__
        && typeof globalThis.__IMDB_RS_TEST_HOOK__ === 'object') {
        Object.assign(globalThis.__IMDB_RS_TEST_HOOK__, {
            buildLinkSelector,
            buildExplicitPeerIndex,
            controlSignature,
            extractMediaReference,
            findPlacementTarget,
            controlSearchScope,
            hasMatchingControlMetadata,
            hasTVEvidence,
            isAnchorNode,
            childListRoots,
            isDocumentNode,
            isElementNode,
            normalizeComparableTitle,
            peerTypesForTitle,
            referenceKey,
            serviceTypes
        });
        return;
    }

    addStyles();
    processRoots([document]);

    // Search pages often finish hydrating after document-idle without producing
    // a mutation that contains the final canonical link. A few bounded rescans
    // cover that startup window, and returning to the tab provides a cheap
    // recovery point without running a permanent polling loop.
    const reconcilePage = () => queueRoot(document);
    for (const delay of [250, 1_000, 3_000]) setTimeout(reconcilePage, delay);
    globalThis.addEventListener?.('pageshow', reconcilePage);
    globalThis.addEventListener?.('focus', reconcilePage);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reconcilePage();
    });

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                queueRoot(mutation.target);
                continue;
            }
            queueContainingKnownContainer(mutation.target);
            // Safari can expose a Google result in separate mutation batches:
            // first the canonical link, then its heading as a sibling. Queueing
            // the mutation target revisits that now-complete result subtree.
            for (const root of childListRoots(mutation)) queueRoot(root);
        }
    });
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['href'],
        childList: true,
        subtree: true
    });
    globalThis[INSTANCE_KEY] = Object.freeze({ observer, version: '5.4.1' });
})();
