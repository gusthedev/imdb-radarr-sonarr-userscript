# IMDb to Radarr/Sonarr Userscript

This repository contains the shared, endpoint-free core for a Tampermonkey userscript that adds Radarr and Sonarr buttons beside canonical IMDb, TMDB, and TVDB title links.

## Privacy model

The public core contains no Radarr or Sonarr hostname, credential, token, or API key. Private service URLs stay in a small loader installed locally in Tampermonkey.

## Installation

1. Copy `imdb-radarr-sonarr-loader.example.user.js` into Tampermonkey.
2. Replace the example Radarr and Sonarr URLs with your own HTTPS URLs.
3. Add any private domains on which the script should not run to `excludedDomains`.
4. Save the loader and disable older copies of the full userscript.

The loader runs a validated last-known-good cached core immediately, checks this repository for updates at most hourly using conditional requests, and falls back to the cached core if GitHub is unavailable. A Tampermonkey menu command can check for updates on demand; newly cached updates take effect on the next page load. This makes the GitHub repository a trusted code source, so review repository changes and protect the GitHub account with strong authentication.

## Configuration

- `sonarrBaseUrl`: base URL of the Sonarr instance.
- `radarrBaseUrl`: base URL of the Radarr instance.
- `excludedDomains`: optional domains and subdomains on which the core should immediately stop.

No API keys are needed. The script opens the normal Radarr or Sonarr add screen for manual review.

## Supported links

- Canonical IMDb `/title/<id>` links use `imdb:<id>`. Explicit TV context opens Sonarr; ambiguous results display both Radarr and Sonarr choices.
- Canonical TMDB `/movie/<id>-<optional-slug>` links open Radarr using `tmdb:<id>`.
- Canonical TMDB `/tv/<id>-<optional-slug>` links open Sonarr using `tmdb:<id>`. An optional locale prefix such as `/pt-BR/` is supported.
- Canonical TVDB `/series/<id-or-slug>` links open Sonarr. Numeric IDs use `tvdb:<id>`; slug-only links fall back to a normal title search.
- Legacy TVDB series URLs such as `/?tab=series&id=<id>` and `/?tab=series&seriesid=<id>` use the exact numeric TVDB ID.

Episode, season, cast, person, and other descendant pages are intentionally ignored so their labels cannot be mistaken for title names.

## Development checks

Run `npm test` with Node.js to exercise canonical URL parsing, legacy TVDB IDs, host-scoped relative selectors, and ambiguous IMDb routing.
