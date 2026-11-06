import test from 'node:test';
import assert from 'node:assert/strict';
import {chatu8Snapshot, naiSwitcherSnapshot, artistImportRows} from '../core/chatu8-artists.js';
import {installDrawSettings} from '../core/backend-draw.js';
import {normalizeDraw, stylePrompt, styleNegative, styleSample, pictureInputs, lookTest, budgetNumbers, styleOfWords} from '../core/draw.js';
import {spriteRequest} from '../core/vn.js';
import {TTSBackend} from '../core/backend.js';
import {normalizeSettings, validateSettings} from '../core/state.js';

class Backend {
  constructor(styles) { this.settings = {draw: normalizeDraw({styles}), routes: []}; this.saves = 0; this.revision = 0; }
  assertOpen() {}
  getState() { return structuredClone(this.settings); }
  save(value, expectedRevision) {
    if (expectedRevision !== undefined && expectedRevision !== this.revision) throw Error('配置已在别处修改');
    this.settings = {...structuredClone(value), draw: normalizeDraw(value.draw)}; this.saves++; this.revision++; return this.getState();
  }
}
installDrawSettings(Backend);
const preset = (prefix = 'artist_a（备注）') => ({fixedPrompt: prefix, fixedPrompt_end: 'tail（后置备注）', negativePrompt: 'bad（负面备注）'});
const local = (extra = {}) => ({id: 'local', name: 'existing', artist: 'old', positive: 'quality', negative: 'old bad', ...extra});
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Only the browser codec is stubbed; the import, normalization and file lifecycle are real.
function coverFiles(t, backend, {failAt, onWrite} = {}) {
  const originals = Object.fromEntries(['createImageBitmap', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.createImageBitmap = async () => ({width: 400, height: 600, close() {}});
  globalThis.OffscreenCanvas = class {
    getContext() { return {drawImage() {}}; }
    async convertToBlob() { return new Blob(['encoded cover'], {type: 'image/webp'}); }
  };
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  const writes = [], removed = [];
  backend.syncFiles = {
    async writePath(path, blob) { writes.push({path, blob}); await onWrite?.(writes.length); if (writes.length === failAt) throw Error('upload failed'); return '/' + path; },
    async removePath(path) { removed.push(path); }
  };
  return {writes, removed};
}

test('snapshot is a complete independent copy of the preset pool only', () => {
  const source = {yushe: {existing: {...preset(), metadata: {previewImageId: 'external'}}}, apiKey: 'not-for-import'};
  const snapshot = chatu8Snapshot(source);
  assert.deepEqual(snapshot, source.yushe);
  snapshot.existing.metadata.previewImageId = 'changed';
  snapshot.existing.fixedPrompt = 'changed';
  assert.equal(source.yushe.existing.fixedPrompt, preset().fixedPrompt);
  assert.equal(source.yushe.existing.metadata.previewImageId, 'external');
  assert.equal(JSON.stringify(snapshot).includes('not-for-import'), false);
});

test('NAI snapshot resolves inline and shared-group parameters without importing unrelated settings', () => {
  const source = {entries: {
    a: {name: 'Group artist', naiParamGroup: 'V5', naiParamsSelected: false, naiParams: {novelai_steps: '4'}, thumb: 'data:image/png;base64,AAAA'},
    b: {name: 'Inline artist', naiParamsSelected: true, naiParams: {novelaimode: 'nai-diffusion-5-full', novelai_sampler: 'k_euler', Schedule: 'native', novelai_steps: '31', nai3Scale: '6.5', cfg_rescale: '0.2', sm: true, dyn: false, nai3Variety: true, nai3Deceisp: true, novelai_seed: '123'}}
  }, paramGroups: {V5: {params: {novelaimode: 'nai-diffusion-5-curated', novelai_sampler: 'k_euler_ancestral', novelai_steps: '25', nai3Scale: '4.5', sm: true, dyn: true}}}, apiKey: 'excluded'};
  const snapshot = naiSwitcherSnapshot(source), rows = artistImportRows({
    'Group artist': preset(), 'Inline artist': preset(), 'No NAI record': preset()
  }, [], snapshot);
  assert.equal(JSON.stringify(snapshot).includes('apiKey'), false);
  assert.deepEqual(rows[0].params, {model: 'nai-diffusion-5-curated', sampler: 'k_euler_ancestral', steps: 25, scale: 4.5, smea: 'dyn'});
  assert.deepEqual(rows[1].params, {model: 'nai-diffusion-5-full', sampler: 'k_euler', schedule: 'native', steps: 31, scale: 6.5, cfgRescale: 0.2, variety: true, decrisper: true, smea: 'on'});
  assert.equal(rows[0].coverData, 'data:image/png;base64,AAAA');
  assert.equal(rows[2].params, undefined);
  assert.equal(rows[2].coverData, '');
  assert.deepEqual(source.entries.a.naiParams, {novelai_steps: '4'});
});

test('the production backend API exposes and forwards snapshot imports', async () => {
  const backend = new Backend([local()]), api = TTSBackend.prototype.api.call(backend);
  assert.equal(typeof api.importChatu8Artists, 'function');
  assert.equal((await api.importChatu8Artists({new: preset()})).added, 1);
  assert.equal(backend.settings.draw.styles.find(s => s.name === 'new').postfix, preset().fixedPrompt_end);
});

test('the complete settings pipeline preserves imported data and remains valid', async () => {
  const backend = new Backend([local()]), snapshot = {new: {...preset(), previewImageId: 'archived'}};
  await backend.importChatu8Artists(snapshot);
  const settings = normalizeSettings(JSON.parse(JSON.stringify(backend.settings)));
  assert.doesNotThrow(() => validateSettings(settings));
  assert.deepEqual(settings.draw.chatu8Snapshot, snapshot);
  assert.equal(settings.draw.styles.find(s => s.name === 'new').postfix, preset().fixedPrompt_end);
});

test('import persists independently through JSON reload and source removal', async () => {
  let source = {yushe: {new: {...preset(), metadata: {note: 'kept'}}}};
  const backend = new Backend([local()]);
  const before = structuredClone(source), snapshot = chatu8Snapshot(source);
  assert.deepEqual(await backend.importChatu8Artists(snapshot), {added: 1, overwritten: 0, skipped: 0});
  assert.deepEqual(source, before);
  snapshot.new.metadata.note = 'changed';
  assert.equal(backend.settings.draw.chatu8Snapshot.new.metadata.note, 'kept');
  source = undefined;
  const restored = JSON.parse(JSON.stringify(backend.settings));
  restored.draw = normalizeDraw(restored.draw);
  const imported = restored.draw.styles.find(s => s.name === 'new');
  assert.equal(stylePrompt(imported, 'scene'), 'artist_a, scene, tail');
  assert.equal(styleNegative(imported), 'bad');
  assert.equal(imported.artist, preset().fixedPrompt);
  assert.equal(imported.postfix, preset().fixedPrompt_end);
  assert.equal(imported.negative, preset().negativePrompt);
  assert.equal(imported.positive, '');
});

test('matched NAI parameters are stored on the imported style and survive normalization', async () => {
  const backend = new Backend([local()]), source = naiSwitcherSnapshot({entries: {one: {
    name: 'new', naiParamsSelected: true, naiParams: {novelaimode: 'nai-diffusion-4-5-full', novelai_sampler: 'k_euler', novelai_steps: '32', nai3Scale: '6.2', cfg_rescale: '0.2', nai3Variety: true}
  }}});
  await backend.importChatu8Artists({new: preset()}, [], source);
  const style = normalizeDraw(backend.settings.draw).styles.find(item => item.name === 'new');
  assert.equal(style.params.model, 'nai-diffusion-4-5-full');
  assert.equal(style.params.sampler, 'k_euler');
  assert.equal(style.params.steps, 32);
  assert.equal(style.params.scale, 6.2);
  assert.equal(style.params.cfgRescale, 0.2);
  assert.equal(style.params.variety, true);
  backend.saveDraw({activeStyle: style.id});
  assert.equal(backend.settings.draw.params.steps, 32);
  assert.equal(backend.settings.draw.params.scale, 6.2);
});

test('parameter precedence follows the switcher, including default groups and legacy fallback', () => {
  const snapshot = {a: preset(), b: preset(), c: preset(), d: preset()};
  const nai = {entries: {
    a: {name: 'a', naiSteps: 3, naiParams: {novelai_steps: 4}},
    b: {name: 'b', naiParamGroup: 'missing', naiSteps: '21', naiNegativeQualityPreset: 'Heavy'},
    c: {name: 'c', naiParamsSelected: true, naiParams: {novelai_steps: '22', sm: 'false', dyn: true, nai3Variety: 'false'}},
    d: {name: 'd', naiParamsSelected: true, naiParams: {}}
  }, paramGroups: {'默认': {params: {novelai_steps: 27}}}};
  const rows = artistImportRows(snapshot, [], nai);
  assert.equal(rows[0].params.steps, 27);
  assert.deepEqual(rows[1].params, {steps: 21, ucPreset: 'heavy'});
  assert.deepEqual(rows[2].params, {steps: 22, variety: false, smea: 'off'});
  assert.equal(rows[3].params, undefined);
});

test('ambiguous NAI names and unsupported covers are reported without guessing', () => {
  const rows = artistImportRows({a: preset(), b: preset()}, [], {entries: {
    a: {name: 'a', naiSteps: 12, thumb: image}, other: {name: ' a ', naiSteps: 28},
    b: {name: 'b', thumb: 'https://example.com/cover.png'}
  }});
  assert.equal(rows[0].params, undefined);
  assert.equal(rows[0].coverData, '');
  assert.match(rows[0].note, /多条/);
  assert.match(rows[1].note, /封面格式不支持/);
});

test('combined import copies covers to owned files and overwrites only selected local styles', async t => {
  const oldCover = {thumb: '/user/images/ST-iPhonie/style-old-s.webp', full: '/user/images/ST-iPhonie/style-old-l.webp'};
  const backend = new Backend([local({cover: oldCover, params: {steps: 21, scale: 6}}), local({id: 'second'})]);
  const files = coverFiles(t, backend), originalSecond = backend.getState().draw.styles[1];
  const source = {entries: {one: {name: 'existing', naiParamsSelected: true, naiParams: {novelai_steps: '24', novelai_seed: 123}, thumb: image}}};
  const before = structuredClone(source), api = TTSBackend.prototype.api.call(backend);
  const result = await api.importChatu8Artists({existing: preset()}, ['local'], source);
  assert.deepEqual(result, {added: 0, overwritten: 1, skipped: 0});
  const style = backend.settings.draw.styles[0];
  assert.equal(style.id, 'local');
  assert.equal(style.params.steps, 24);
  assert.equal(style.params.scale, 6);
  assert.equal(style.params.seed, undefined);
  assert.equal(backend.settings.draw.activeStyle, 'local');
  assert.deepEqual(backend.settings.draw.styles[1], originalSecond);
  assert.equal(files.writes.length, 2);
  assert.ok(files.writes.every(({path, blob}) => path.startsWith('user/images/ST-iPhonie/style-') && blob.type === 'image/webp'));
  assert.deepEqual(files.removed.sort(), Object.values(oldCover).sort());
  assert.deepEqual(style.cover, {thumb: '/' + files.writes[0].path, full: '/' + files.writes[1].path});
  assert.equal(backend.settings.draw.naiSwitcherSnapshot.entries.one.naiParams.novelai_seed, 123);
  assert.equal(backend.settings.draw.naiSwitcherSnapshot.entries.one.thumb, undefined);
  assert.deepEqual(source, before);
  const restored = normalizeSettings(JSON.parse(JSON.stringify(backend.settings)));
  assert.deepEqual(restored.draw.styles[0].cover, style.cover);
  assert.equal(restored.draw.styles[0].params.steps, 24);
});

test('skipped matches never decode or upload their covers', async () => {
  const backend = new Backend([local()]), before = backend.getState();
  const result = await backend.importChatu8Artists({existing: preset()}, [], {entries: {a: {name: 'existing', thumb: image}}});
  assert.equal(result.skipped, 1);
  assert.deepEqual(backend.settings, before);
  assert.equal(backend.saves, 0);
});

test('cover upload failures leave settings intact and clean up previously uploaded files', async t => {
  const backend = new Backend([local()]), files = coverFiles(t, backend, {failAt: 4}), before = backend.getState();
  await assert.rejects(backend.importChatu8Artists({a: preset(), b: preset()}, [], {entries: {
    a: {name: 'a', thumb: image}, b: {name: 'b', thumb: image}
  }}), /upload failed/);
  assert.deepEqual(backend.settings, before);
  assert.equal(backend.saves, 0);
  assert.deepEqual(files.removed.sort(), files.writes.slice(0, 3).map(({path}) => '/' + path).sort());
});

test('concurrent edits during image upload are preserved and the stale import is rejected', async t => {
  const backend = new Backend([local()]);
  const files = coverFiles(t, backend, {onWrite: count => {
    if (count === 1) backend.saveStyle({...local(), artist: 'edited during import'});
  }});
  await assert.rejects(backend.importChatu8Artists({new: preset()}, [], {entries: {a: {name: 'new', thumb: image}}}), /配置已在别处修改/);
  assert.equal(backend.settings.draw.styles.length, 1);
  assert.equal(backend.settings.draw.styles[0].artist, 'edited during import');
  assert.equal(files.removed.length, 2);
});

test('repeated imports skip matches by default without saving or duplicating', async () => {
  const backend = new Backend([local()]), snapshot = {new: preset()};
  await backend.importChatu8Artists(snapshot);
  const before = backend.getState(), saves = backend.saves;
  assert.deepEqual(await backend.importChatu8Artists(snapshot), {added: 0, overwritten: 0, skipped: 1});
  assert.deepEqual(backend.settings, before);
  assert.equal(backend.saves, saves);
});

test('selected overwrite replaces words but preserves IDs, groups, covers, params and selection', async () => {
  const backend = new Backend([local({group: 'g', cover: {thumb: '/user/images/ST-iPhonie/style-thumb.png', full: '/user/images/ST-iPhonie/style-full.png'}, params: {steps: 21}})]);
  backend.settings.draw.styleGroups = [{id: 'g', name: 'group', open: true}];
  backend.settings.draw.styles[0].group = 'g';
  const before = backend.getState().draw.styles[0], active = backend.settings.draw.activeStyle;
  assert.deepEqual(await backend.importChatu8Artists({existing: preset()}, ['local']), {added: 0, overwritten: 1, skipped: 0});
  const result = backend.settings.draw.styles[0];
  for (const key of ['id', 'group', 'cover', 'params']) assert.deepEqual(result[key], before[key]);
  assert.equal(backend.settings.draw.activeStyle, active);
  assert.equal(result.positive, '');
  assert.equal(result.artist, preset().fixedPrompt);
});

test('duplicate local names are overwritten only at selected IDs', async () => {
  const backend = new Backend([local(), local({id: 'second'})]);
  assert.deepEqual(artistImportRows({existing: preset()}, backend.settings.draw.styles)[0].targets, ['local', 'second']);
  await backend.importChatu8Artists({existing: preset()}, ['second']);
  assert.equal(backend.settings.draw.styles[0].artist, 'old');
  assert.equal(backend.settings.draw.styles[1].artist, preset().fixedPrompt);
});

test('long names and every prompt survive normalization without silent truncation', async () => {
  const name = 'a'.repeat(90), text = 'x'.repeat(6001), backend = new Backend([local()]);
  await backend.importChatu8Artists({[name]: {fixedPrompt: text, fixedPrompt_end: text, negativePrompt: text}});
  const result = normalizeDraw(backend.settings.draw).styles.find(s => s.name === name);
  assert.equal(result.artist, text); assert.equal(result.postfix, text); assert.equal(result.negative, text);
  assert.equal((await backend.importChatu8Artists({[name]: preset()})).skipped, 1);
});

test('invalid entries fail atomically and unavailable sources have no fallback', async () => {
  const backend = new Backend([local()]), before = backend.getState();
  await assert.rejects(backend.importChatu8Artists({valid: preset(), broken: null}), /格式无效/);
  assert.deepEqual(backend.settings, before); assert.equal(backend.saves, 0);
  for (const source of [undefined, {}, {yushe: []}, {yushe: {}}]) assert.throws(() => chatu8Snapshot(source));
});

test('local edits, copies, groups and deletion operate independently after import', async () => {
  const source = {yushe: {new: preset()}}, before = structuredClone(source), backend = new Backend([local()]);
  await backend.importChatu8Artists(chatu8Snapshot(source));
  const imported = backend.settings.draw.styles.find(s => s.name === 'new');
  backend.saveStyle({...imported, artist: 'edited', postfix: 'edited tail'});
  const copy = backend.saveStyle({...imported, id: undefined, name: 'copy', postfix: 'copy tail'});
  assert.equal(copy.postfix, 'copy tail'); assert.equal(copy.stripAnnotations, true);
  backend.arrangeStyles([{style: 'local'}, {group: {id: 'g', name: 'group', open: true}, styles: [imported.id, copy.id]}]);
  assert.equal(backend.settings.draw.styles.find(s => s.id === imported.id).group, 'g');
  backend.deleteStyle(imported.id);
  assert.equal(backend.settings.draw.styles.some(s => s.id === imported.id), false);
  assert.deepEqual(source, before);
});

test('preexisting local prompts keep their original annotation semantics', () => {
  const style = local({artist: 'artist（literal）'});
  assert.equal(stylePrompt(style, 'scene'), 'artist（literal）, quality, scene');
  assert.equal(styleNegative(style), 'old bad');
});

test('imported postfix is last in samples, story paths, character tests and sprites', async () => {
  const backend = new Backend([local()]); await backend.importChatu8Artists({new: preset()});
  const imported = backend.settings.draw.styles.find(s => s.name === 'new');
  backend.settings.draw.activeStyle = imported.id;
  const settings = backend.settings;
  const requests = [styleSample(settings.draw, imported, 'scene'), lookTest(settings, {appearance: 'girl'}), spriteRequest(settings, 'Alice', {appearance: 'girl'})];
  requests.push(pictureInputs(settings, {prompt: 'scene', characters: []}));
  requests.push(pictureInputs(settings, {spec: {tags: 'landscape', cast: [], register: [], nl: 'description'}}));
  requests.push(pictureInputs(settings, {spec: {tags: 'scene', cast: [{name: 'Alice', tags: 'smile'}], register: [], nl: ''}}));
  settings.routes = [{name: 'Alice', appearance: 'girl'}];
  requests.push(pictureInputs(settings, {spec: {tags: '1girl', cast: [], register: [], nl: ''}}, 'Alice'));
  for (const request of requests) { assert.ok(request.prompt.startsWith('artist_a, '), request.prompt); assert.ok(request.prompt.endsWith(', tail'), request.prompt); assert.ok(request.negative.startsWith('bad'), request.negative); }
});

test('nested full-width remarks are cleaned only at use and postfix counts towards budget', () => {
  const backend = new Backend([local({postfix: 'x'.repeat(200), stripAnnotations: true, artist: 'a（outer（inner））'})]);
  const style = backend.settings.draw.styles[0], before = style.artist;
  assert.equal(stylePrompt(style, 'scene').startsWith('a, quality, scene, '), true);
  const withTail = budgetNumbers(backend.settings).head;
  style.postfix = '';
  assert.ok(withTail > budgetNumbers(backend.settings).head);
  assert.equal(style.artist, before);
});

test('album style recognition uses cleaned artist words without changing the saved text', async () => {
  const backend = new Backend([local()]); await backend.importChatu8Artists({new: preset()});
  const style = backend.settings.draw.styles.find(s => s.name === 'new');
  assert.equal(styleOfWords(backend.settings.draw, stylePrompt(style, 'scene')).id, style.id);
  assert.equal(style.artist, preset().fixedPrompt);
});
