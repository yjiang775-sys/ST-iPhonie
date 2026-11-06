import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {importChatu8Sheet} from '../ui/chatu8-import.js';
import {chatu8Snapshot} from '../core/chatu8-artists.js';
const {parseHTML} = createRequire(import.meta.url)(process.env.DOM_TEST_MODULE || 'linkedom');

function fixture({fresh = true, importResult} = {}) {
  const {document, window} = parseHTML('<html><body></body></html>');
  const source = {yushe: {same: {fixedPrompt: 'NEW'}, second: {fixedPrompt: 'SECOND'}}};
  const naiSource = {entries: {
    same: {name: 'same', naiParamsSelected: true, naiParams: {novelai_steps: '24'}, thumb: 'data:image/png;base64,AAAA'},
    second: {name: 'second', naiParamGroup: 'Shared'}
  }, paramGroups: {Shared: {params: {novelai_steps: '28'}}}};
  if (fresh) source.yushe['<img src=x onerror=alert(1)>'] = {fixedPrompt: 'SAFE'};
  const styles = [{id: 'a', name: 'same'}, {id: 'b', name: 'second'}], commits = [], notices = [];
  let closed = false, after = 0;
  const ctx = {
    api: {
      chatu8ArtistSnapshot: () => chatu8Snapshot(source),
      naiSwitcherSnapshot: () => structuredClone(naiSource),
      getState: () => ({draw: {styles: structuredClone(styles)}}),
      importChatu8Artists(snapshot, ids, naiSnapshot) { commits.push({snapshot, ids, naiSnapshot}); return importResult ? importResult() : {added: fresh ? 1 : 0, overwritten: ids.length, skipped: 2 - ids.length}; }
    },
    dialog(title, html) {
      const body = document.createElement('div'); body.innerHTML = html; document.body.append(body);
      return {body, get live() { return !closed; }, close() { closed = true; body.remove(); }};
    },
    notify: message => notices.push(message)
  };
  const dialog = importChatu8Sheet(ctx, () => after++), body = dialog.body;
  const click = async selector => { body.querySelector(selector).dispatchEvent(new window.Event('click', {bubbles: true})); await new Promise(resolve => setImmediate(resolve)); };
  const check = (selector, checked) => { const box = body.querySelector(selector); box.checked = checked; box.dispatchEvent(new window.Event('change', {bubbles: true})); };
  return {source, naiSource, body, commits, notices, click, check, after: () => after, closed: () => closed};
}

test('cancel never commits and source preset names render as text', () => {
  const f = fixture(), before = structuredClone(f.source);
  assert.equal(f.body.querySelector('img'), null);
  assert.ok(f.body.textContent.includes('<img src=x onerror=alert(1)>'));
  f.click('[data-action=import-chatu8-cancel]');
  assert.equal(f.closed(), true); assert.equal(f.commits.length, 0); assert.deepEqual(f.source, before);
});

test('preview reports matching parameters and covers, and commit captures both source snapshots', async () => {
  const f = fixture();
  assert.match(f.body.textContent, /有参数 2 个/);
  assert.match(f.body.textContent, /有封面 1 张/);
  f.naiSource.paramGroups.Shared.params.novelai_steps = '3';
  f.naiSource.entries.same.thumb = 'changed after opening';
  await f.click('[data-action=import-chatu8-apply]');
  assert.equal(f.commits[0].naiSnapshot.entries.same.name, 'same');
  assert.equal(f.commits[0].naiSnapshot.paramGroups.Shared.params.novelai_steps, '28');
  assert.equal(f.commits[0].naiSnapshot.entries.same.thumb, 'data:image/png;base64,AAAA');
});

test('all same-name presets are skipped by default and commit reads the captured snapshot', async () => {
  const f = fixture();
  f.source.yushe.same.fixedPrompt = 'CHANGED AFTER OPEN';
  await f.click('[data-action=import-chatu8-apply]');
  assert.deepEqual(f.commits[0].ids, []);
  assert.equal(f.commits[0].snapshot.same.fixedPrompt, 'NEW');
  assert.equal(f.after(), 1); assert.equal(f.closed(), true);
  await f.click('[data-action=import-chatu8-apply]');
  assert.equal(f.commits.length, 1);
});

test('individual selection, select all and partial state send exactly the chosen IDs', async () => {
  const f = fixture(), all = f.body.querySelector('[data-overwrite-all]');
  f.check('[data-overwrite-style=a]', true);
  assert.equal(all.indeterminate, true);
  f.check('[data-overwrite-all]', true);
  assert.equal(f.body.querySelector('[data-overwrite-style=b]').checked, true);
  assert.equal(all.indeterminate, false);
  f.check('[data-overwrite-style=b]', false);
  assert.equal(all.indeterminate, true);
  await f.click('[data-action=import-chatu8-apply]');
  assert.deepEqual(f.commits[0].ids, ['a']);
});

test('with only conflicts, import is disabled until an overwrite is selected', async () => {
  const f = fixture({fresh: false}), button = f.body.querySelector('[data-action=import-chatu8-apply]');
  assert.equal(button.disabled, true);
  await f.click('[data-action=import-chatu8-apply]'); assert.equal(f.commits.length, 0);
  f.check('[data-overwrite-all]', true); assert.equal(button.disabled, false);
  f.check('[data-overwrite-all]', false); assert.equal(button.disabled, true);
});

test('pending imports lock selection and prevent duplicate commits or misleading cancellation', async () => {
  let finish;
  const f = fixture({importResult: () => new Promise(resolve => { finish = resolve; })});
  await f.click('[data-action=import-chatu8-apply]');
  assert.equal(f.closed(), false);
  assert.equal(f.body.querySelector('[data-overwrite-all]').disabled, true);
  assert.equal(f.body.querySelector('[data-action=import-chatu8-cancel]').disabled, true);
  await f.click('[data-action=import-chatu8-apply]');
  await f.click('[data-action=import-chatu8-cancel]');
  assert.equal(f.commits.length, 1);
  assert.equal(f.closed(), false);
  finish({added: 1, overwritten: 0, skipped: 2});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.closed(), true);
  assert.equal(f.after(), 1);
});

test('failed image imports keep the dialog open and allow a deliberate retry', async () => {
  let attempts = 0;
  const f = fixture({importResult: async () => {
    if (++attempts === 1) throw Error('封面上传失败');
    return {added: 1, overwritten: 0, skipped: 2};
  }});
  await f.click('[data-action=import-chatu8-apply]');
  assert.equal(f.closed(), false);
  assert.equal(f.after(), 0);
  assert.match(f.notices[0], /封面上传失败/);
  assert.equal(f.body.querySelector('[data-action=import-chatu8-apply]').disabled, false);
  await f.click('[data-action=import-chatu8-apply]');
  assert.equal(f.commits.length, 2);
  assert.equal(f.closed(), true);
});
