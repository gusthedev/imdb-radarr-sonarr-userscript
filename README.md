# IMDb to Radarr/Sonarr Userscript

This repository contains the shared, endpoint-free core for a Tampermonkey userscript that adds Radarr and Sonarr buttons beside IMDb title links.

## Privacy model

The public core contains no Radarr or Sonarr hostname, credential, token, or API key. Private service URLs stay in a small loader installed locally in Tampermonkey.

## Installation

1. Copy `imdb-radarr-sonarr-loader.example.user.js` into Tampermonkey.
2. Replace the example Radarr and Sonarr URLs with your own HTTPS URLs.
3. Add any private domains on which the script should not run to `excludedDomains`.
4. Save the loader and disable older copies of the full userscript.

The loader retrieves the current core from this repository whenever it runs. This makes the GitHub repository a trusted code source; review repository changes and protect the GitHub account with strong authentication.

## Configuration

- `sonarrBaseUrl`: base URL of the Sonarr instance.
- `radarrBaseUrl`: base URL of the Radarr instance.
- `excludedDomains`: optional domains and subdomains on which the core should immediately stop.

No API keys are needed. The script opens the normal Radarr or Sonarr add screen for manual review.
