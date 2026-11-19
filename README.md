# Manor Lakes FC PWA

Dependency-free static progressive web app for Manor Lakes Football Club, hosted by GitHub Pages at [ml-fc.github.io](https://ml-fc.github.io/). The application talks to the production Cloudflare Worker configured in `src/config.js`.

## Run directly in a browser

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173/). The API allows both of these development origins:

- `http://127.0.0.1:4173`
- `http://localhost:4173`

This means authentication, availability, captain, admin, and other API-backed flows can be tested directly in the browser without disabling CORS. Use port 4173 consistently. Localhost is a secure context for service-worker and offline-PWA testing.

To test against a locally running Worker, temporarily point `CONFIG.API_BASE` at `http://127.0.0.1:8787`, then restore `src/config.js` before committing.

## Validation

```bash
for f in src/*.js src/api/*.js src/pages/*.js src/ui/*.js service-worker.js; do node --check "$f" || exit 1; done
git diff --check
```

Browser release checks should cover:

- sign-in and profile rendering;
- match lists and availability updates;
- captain and admin workflows;
- untrusted names, titles, and errors rendering as text rather than executable HTML;
- an offline reload after the service worker controls the page;
- styles, query-versioned modules, the manifest, and icons loading offline.

## Release and caching

For every frontend release:

1. Update `BUILD_ID` in `src/config.js`.
2. Set the same value on the `styles.css?v=...` and `src/app.js?v=...` references in `index.html`.
3. Add any new offline-critical file to `STATIC_ASSETS` in `service-worker.js`.
4. Run syntax, browser, XSS, and offline checks.

The current release is `2026-11-19.98`.

## Deployment

GitHub Pages is configured in legacy branch mode using `main` and the repository root. Publishing is therefore:

```bash
git push origin main
```

Check the latest Pages build:

```bash
gh api repos/ml-fc/ml-fc.github.io/pages/builds/latest \
  --jq '{status,commit,error:.error.message}'
```

After it reports `built`, verify the release:

```bash
curl -fsSL https://ml-fc.github.io/src/config.js
```

Installed PWAs may need to be closed and reopened once so the new service worker activates.

## Security

Treat every backend field as untrusted and escape it before inserting it into HTML or an attribute. Never commit API tokens, player data, OAuth credentials, or files named like `client_secret_*.json`. The Google site-verification HTML file is public verification material; it is not an OAuth client secret.

## Club Desk regression checks

Start the local server on port 4173, then run the browser checks with Playwright CLI:

```bash
npx --package @playwright/cli playwright-cli -s=club-admin open about:blank
npx --package @playwright/cli playwright-cli -s=club-admin run-code --filename=tests/admin-workspace.browser.js
npx --package @playwright/cli playwright-cli -s=club-admin run-code --filename=tests/awards.browser.js
```

The checks use synthetic seasons, matches and players and intercept every Worker request, including mutations. They cover navigation and legacy URLs, shared seasons, returning from management and scoring, match restrictions, pagination, retained drafts, validation, duplicate submission, lazy tools, errors, keyboard focus, and layouts at 360, 390, 768 and 1280 pixels. Service-worker installation is blocked in this fixture run to keep update reloads separate from interaction checks.

Awards checks cover creating categories during active voting, confirmed removal, fresh participation, voter PNG content/download, Melbourne deadlines, privacy, errors and themed club-tool layouts. Open match actions are always visible; history retains its compact disclosure. Back controls share a compact chevron and return through browser history when the destination matches.

The awards Worker requires `0008_season_awards.sql` and `0009_award_removal.sql` from the sibling API repository. Apply migrations before deploying the Worker and publishing this frontend. Removed draft/active categories retain their snapshots and votes; finished categories remain protected.

Match creation and management support an optional ground name and HTTP/HTTPS location URL. The shared match page hyperlinks the name; WhatsApp text includes the name and location URL. Ground changes refresh the same match link. Deploy API migration `0010_match_ground.sql` and its Worker before publishing this frontend.
