# Verification

Run the data, persistence and prompt regression tests:

```powershell
node --test tests/chatu8-artists.test.js
```

The UI tests use LinkeDOM as an external test tool; it is not a runtime dependency of the extension. Install it outside this plugin directory and set `DOM_TEST_MODULE` to its absolute package path, then run:

```powershell
node --test tests/chatu8-artists.test.js tests/chatu8-import-ui.test.js
```

`import-preview.html` is a synthetic UI fixture for manual browser inspection, served over localhost. It does not load real SillyTavern settings or generate images.

DOM tests exercise selection, cancellation, captured snapshots, escaped names and duplicate-submit protection. They do not verify pixels, layout or real SillyTavern loading.

The data tests also cover NAI parameter priority, independent storage, selected overwrites, file cleanup after failed uploads and concurrent settings edits. Their image codec is stubbed; they test the file lifecycle, not browser decoding.

For real browser image decoding and resizing, desktop/mobile overflow checks and optional screenshots, install Playwright Core outside the plugin and provide Chrome:

```powershell
$env:BROWSER_TEST_MODULE = 'C:\path\to\node_modules\playwright-core'
$env:BROWSER_TEST_ARTIFACTS = 'C:\path\to\screenshots'
node tests/chatu8-import-browser.mjs
```

This test starts and closes its own localhost server. It uses synthetic chatu8/NAI settings and an in-memory tavern file adapter. Real SillyTavern file uploads, authentication and loading both installed source plugins still require an integration check in the user's tavern.
