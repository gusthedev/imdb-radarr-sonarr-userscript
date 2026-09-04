# IMDb to Radarr/Sonarr Userscript

This repository contains the shared, endpoint-free core for a Tampermonkey userscript that adds Radarr and Sonarr buttons beside canonical IMDb, TMDB, and TVDB title links.

## Privacy model

The public core contains no Radarr or Sonarr hostname, credential, token, or API key. Private service URLs stay in a small loader installed locally in Tampermonkey.

## Installation

1. Copy `imdb-radarr-sonarr-loader.example.user.js` into Tampermonkey.
2. Replace the example Radarr and Sonarr URLs with your own HTTPS URLs.
3. Add any private domains on which the script should not run to `excludedDomains`.
4. Save the loader and disable older copies of the full userscript.

The loader runs a validated last-known-good cached core immediately, checks this repository for updates at most hourly using conditional requests, and falls back to a separate rollback core if a newly cached version cannot initialize. Tampermonkey menu commands can bypass caches for an update check, show active/cached/rollback versions, and choose how ambiguous IMDb links behave. Newly cached updates take effect on the next page load. This makes the GitHub repository a trusted code source, so review repository changes and protect the GitHub account with strong authentication.

## Configuration

- `sonarrBaseUrl`: base URL of the Sonarr instance.
- `radarrBaseUrl`: base URL of the Radarr instance.
- `ambiguousImdbBehavior`: `both`, `radarr`, or `sonarr`; it can also be cycled from the Tampermonkey menu.
- `excludedDomains`: optional domains and subdomains on which the core should immediately stop.

No API keys are needed for add-screen buttons. Optional library status requires your own API connections: add the API hosts to the private loader's `@connect` entries, then use **Configure library status** in the Tampermonkey menu and reload. Use addresses reachable from the browser's computer. Keep real URLs and keys out of this repository.

Library checks use GET only, coalesce concurrent requests, cache compact results for five minutes, and back off for one minute after failures. Exact IMDb/TMDB/TVDB IDs can show “In Radarr/Sonarr” and open the existing title. Slug-only references and offline/login responses never claim a title is absent. **Refresh library status** clears cached results. API keys stay in private Tampermonkey storage; the core receives only compact library metadata.

Provider metadata is cached until relevant changes or navigation. Search-page processing ignores its own controls and reuses the peer index while preserving reclassification when explicit peer results arrive.

## Supported links

- Canonical IMDb `/title/<id>` links use `imdb:<id>`. Explicit TV context opens Sonarr; ambiguous results display both Radarr and Sonarr choices.
- Canonical TMDB `/movie/<id>-<optional-slug>` links open Radarr using `tmdb:<id>`.
- Canonical TMDB `/tv/<id>-<optional-slug>` links open Sonarr using `tmdb:<id>`. An optional locale prefix such as `/pt-BR/` is supported.
- Canonical TVDB `/series/<id-or-slug>` links open Sonarr. Numeric IDs use `tvdb:<id>`; slug-only links fall back to a normal title search.
- Legacy TVDB series URLs such as `/?tab=series&id=<id>` and `/?tab=series&seriesid=<id>` use the exact numeric TVDB ID.

Episode, season, cast, person, and other descendant pages are intentionally ignored so their labels cannot be mistaken for title names.

## Development checks

Run `npm ci` followed by `npm test` with Node.js 18 or newer to exercise canonical URL parsing, legacy TVDB IDs, host-scoped relative selectors, ambiguous IMDb preferences, safe Google placement, cross-browser DOM wrappers, cold and warm cache behavior, rollback recovery, offline fallback, status reporting, and manual cache bypass.
