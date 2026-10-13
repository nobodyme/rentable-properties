# rentable-properties

A static rental finder deployed to GitHub Pages from `main`:
https://nobodyme.github.io/rentable-properties/. Design lives in `site/`, content in `data/`.
The site is built by `scripts/build.sh` and deployed by `.github/workflows/pages.yml`.
Data refreshes follow `UPDATING.md`.

## Standing rules

### Every change must work on Safari and iOS Safari (iPhone)

The owner mainly uses the site on an iPhone. A change is not done until it works there.

- **Use only features Safari 15.4+ supports.** Check caniuse for anything newer and give it a fallback:
  - Declare a plain value before a newer one, e.g. a solid colour before `color-mix()`, or `vh` before `dvh`.
  - No JS regex lookbehind.
  - No `Array.prototype.findLast`, `toSorted`, `structuredClone` or other post-2022 APIs without a guard.
- **Buttons and chips:**
  - Never rely on native control styling. Every `button` / chip needs `-webkit-appearance: none` and explicit `background-color`, `color` and `border-color` for each state.
  - Put on/off state on `aria-pressed` alone. Don't also toggle a class that styles the same properties: two competing rules can render differently on Safari.
- **Hover:** put `:hover` styles inside `@media (hover: hover)`. iOS keeps `:hover` on the last tapped element, which makes a toggled-off chip look "on".
- **Form fields:** use font-size ≥ 16px on phones, or iOS zooms the page on focus.
- **Viewport height:** use `dvh` with a `vh` fallback. Respect `env(safe-area-inset-bottom)` for fixed bottom UI.
- **Popovers and dropdowns:** must not live inside an `overflow`, `mask` or `transform` container that clips them. That made the rent slider untouchable on phones.
- **Leaflet:** set a map's view (`fitBounds` / `setView`) before adding vector layers, and create maps only once their container is visible.
- **Caching:** the build versions `style.css` and `app.js` by content hash (`?v=…`) and data is fetched with `cache: 'no-cache'`. Keep both, or phones show a new page with an old stylesheet. When telling the owner to check a change on the phone, mention a pull-to-refresh.

### Before pushing a UI change

1. `sh scripts/build.sh` and serve `_site/`.
2. Use Playwright (Chromium at `/opt/pw-browsers/chromium`) to test:
   - viewports 1440×900, 390×844 and 320×640, in light and dark;
   - touch emulation (`hasTouch`, `isMobile`) on the phone sizes;
   - each changed control in both states, with a screenshot.
   - Check for: no console errors, no horizontal scroll, and every popover/slider actually hit-testable (`elementFromPoint`).
3. WebKit can't be installed in the cloud sandbox, so review the diff against the Safari rules above line by line. Say plainly that real Safari was not run.
4. After deploying, confirm the live `index.html` references the new `?v=` hashes.

### Content rules

- The site and commit messages must not name the origin place. The site says "chosen point". The build strips `origin.name` from the published data.
- Never invent listings or fields. Routine refreshes change only `data/` (see `UPDATING.md`).
- Defaults the owner chose:
  - 3 BHK;
  - South only on;
  - drive time 30 min;
  - sort Newest.

### Git

Work on the session's branch and also push to `main`. The owner has approved `main` as the deploy branch.
