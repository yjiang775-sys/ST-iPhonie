import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';

const {chromium} = createRequire(import.meta.url)(process.env.BROWSER_TEST_MODULE || 'playwright-core');
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const artifacts = process.env.BROWSER_TEST_ARTIFACTS;
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'};
const server = createServer(async (request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try { response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); response.end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({channel: 'chrome', headless: true});
  if (artifacts) await mkdir(artifacts, {recursive: true});
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 375, 812], ['small-mobile', 320, 640]]) {
    const page = await browser.newPage({viewport: {width, height}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/import-preview.html`);
    await page.waitForFunction(() => window.testReady);
    await page.click('#test-open');
    await page.locator('[data-overwrite-all]').check();
    const dimensions = await page.evaluate(() => {
      const body = document.querySelector('.chatu8-import');
      return {width: body.clientWidth, content: body.scrollWidth, text: body.textContent, images: body.querySelectorAll('img').length};
    });
    assert.ok(dimensions.content <= dimensions.width + 1, `${name}: horizontal overflow`);
    assert.match(dimensions.text, /有参数 2 个/);
    assert.match(dimensions.text, /有封面 1 张/);
    assert.equal(dimensions.images, 0, 'untrusted preset names must stay text');
    if (artifacts) await page.screenshot({path: path.join(artifacts, `import-${name}.png`)});
    const before = await page.evaluate(() => JSON.stringify([testFixture.source, testFixture.naiSource]));
    await page.click('[data-action=import-chatu8-apply]');
    await page.waitForFunction(() => window.testNotice?.startsWith('已导入'));
    const result = await page.evaluate(async () => {
      const fixture = window.testFixture, style = fixture.backend.settings.draw.styles.find(s => s.id === 'a');
      const dimensions = [];
      for (const key of ['thumb', 'full']) {
        const bitmap = await createImageBitmap(fixture.files.get(style.cover[key]));
        dimensions.push([bitmap.width, bitmap.height]); bitmap.close();
      }
      const url = URL.createObjectURL(fixture.files.get(style.cover.thumb));
      const image = new Image(); image.src = url; await image.decode(); document.querySelector('#test-screen').append(image);
      return {steps: style.params.steps, scale: style.params.scale, dimensions, files: fixture.files.size, unchanged: JSON.stringify([fixture.source, fixture.naiSource]), errors: document.querySelectorAll('.chatu8-import').length};
    });
    assert.equal(result.steps, 23); assert.equal(result.scale, 6);
    assert.equal(result.files, 2); assert.equal(result.unchanged, before);
    assert.deepEqual(result.dimensions, [[180, 270], [240, 360]]);
    assert.equal(result.errors, 0); assert.deepEqual(errors, []);
    if (artifacts) await page.screenshot({path: path.join(artifacts, `cover-${name}.png`)});
    console.log(`${name}: preview, real image decode/resize, parameter import and independent cover files passed`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
