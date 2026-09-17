# Manor Lakes FC frontend instructions

## Project overview

This repository is the production frontend for Manor Lakes Football Club. It is a dependency-free static progressive web app hosted at `https://ml-fc.github.io/`.

- `index.html` contains the persistent application shell.
- `styles.css` contains the complete responsive matchday visual system.
- `src/router.js` implements hash-based routing.
- `src/pages/` contains route renderers.
- `src/api/` contains the Cloudflare Worker client and endpoint wrappers.
- `service-worker.js` owns offline static-asset caching.
- `src/config.js` contains the production API URL and release build ID.

## Working rules

- Preserve the dependency-free architecture unless the user explicitly approves a framework migration.
- Keep all URLs compatible with GitHub Pages at the domain root.
- Treat the backend response as untrusted data. Escape dynamic values before inserting them into HTML or attributes.
- Preserve login, availability, captain, leaderboard, notification, admin, and offline flows when changing shared code.
- Keep the UI responsive, keyboard accessible, touch friendly, and compatible with reduced-motion preferences.
- Reuse the existing matchday design tokens and component classes instead of introducing an unrelated visual system.
- Do not add credentials, API tokens, private keys, player phone numbers, or production data to source control.

## Release and cache rules

- Bump `BUILD_ID` in `src/config.js` whenever a release changes cached HTML, CSS, JavaScript, icons, or the service worker. Keep the release query strings on the `styles.css` and `src/app.js` references in `index.html` aligned with that build ID so an older service worker cannot serve a mixed release.
- Add new offline-critical modules or assets to `STATIC_ASSETS` in `service-worker.js`.
- Do not cache backend API responses in the service worker; page modules manage API data caching.
- The production branch is `main`. Pushing to `main` triggers the GitHub Pages deployment.
- Never force-push the production branch.

## Validation

Before committing frontend work, run:

```bash
for f in src/*.js src/api/*.js src/pages/*.js src/ui/*.js service-worker.js; do node --check "$f" || exit 1; done
git diff --check
python3 -m http.server 4173
```

Confirm the local root responds, then stop the temporary server. After publishing, verify that `https://ml-fc.github.io/src/config.js` exposes the new `BUILD_ID` and that the GitHub Pages job completed successfully.
