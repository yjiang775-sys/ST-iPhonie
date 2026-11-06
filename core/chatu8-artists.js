import {NAI_MODELS, NAI_SAMPLERS, NAI_SCHEDULES} from './novelai.js';

/** Read only the preset pool; no source settings or references escape this boundary. */
export function chatu8Snapshot(settings) {
  if (!settings?.yushe || typeof settings.yushe !== 'object' || Array.isArray(settings.yushe)) {
    throw Error('没有读到 st-chatu8 画师串，请先在同一个酒馆中启用并配置 st-chatu8');
  }
  const snapshot = structuredClone(settings.yushe);
  artistImportRows(snapshot, []);
  return snapshot;
}

/** Copy only the preset records and parameter groups from NAI切换助手. */
export function naiSwitcherSnapshot(settings) {
  const entries = settings?.entries && typeof settings.entries === 'object' && !Array.isArray(settings.entries) ? settings.entries : {};
  const paramGroups = settings?.paramGroups && typeof settings.paramGroups === 'object' && !Array.isArray(settings.paramGroups) ? settings.paramGroups : {};
  return structuredClone({entries, paramGroups});
}

function sourceParams(entry, groups) {
  // Match nlApplyPresetParams: own parameters, named/default group, then legacy fields.
  const group = Object.hasOwn(groups, entry.naiParamGroup || '默认') ? groups[entry.naiParamGroup || '默认'] : undefined;
  const source = entry.naiParamsSelected ? entry.naiParams || {} : group ? group.params || {} : {
    novelaimode: entry.naiModel, UCP_novelai: entry.naiNegativeQualityPreset,
    novelai_straight_alpha: entry.naiStraightAlpha, novelai_sampler: entry.naiSampler,
    novelai_steps: entry.naiSteps, nai3Scale: entry.naiPromptGuidance, cfg_rescale: entry.naiPromptGuidanceRescale
  };
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const take = key => source[key] !== '' && source[key] != null ? source[key] : undefined;
  const params = {};
  for (const [key, value, allowed] of [
    ['model', take('novelaimode'), NAI_MODELS], ['sampler', take('novelai_sampler'), NAI_SAMPLERS],
    ['schedule', take('Schedule'), NAI_SCHEDULES]
  ]) if (allowed.includes(value)) params[key] = value;
  for (const [key, value] of [['steps', take('novelai_steps')], ['scale', take('nai3Scale')], ['cfgRescale', take('cfg_rescale')]]) {
    if (value !== undefined && Number.isFinite(Number(value))) params[key] = Number(value);
  }
  const boolean = value => value === true || value === 'true' || value === 1 || value === '1';
  for (const [key, value] of [['variety', take('nai3Variety')], ['decrisper', take('nai3Deceisp')]]) if (value !== undefined) params[key] = boolean(value);
  const ucIds = {heavy: 'heavy', light: 'light', none: 'none', humanfocus: 'humanFocus', furryfocus: 'furryFocus'};
  const ucValue = String(take('UCP_novelai') ?? '').replace(/[\s_-]/g, '').toLowerCase();
  if (Object.hasOwn(ucIds, ucValue)) params.ucPreset = ucIds[ucValue];
  if (source.sm !== undefined) params.smea = boolean(source.sm) ? boolean(source.dyn) ? 'dyn' : 'on' : 'off';
  return Object.keys(params).length ? params : undefined;
}

const embeddedImage = value => typeof value === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value) ? value : '';

export function artistImportRows(snapshot, styles, naiSnapshot = {entries: {}, paramGroups: {}}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw Error('画师串快照格式无效');
  const records = Object.values(naiSnapshot?.entries || {}).filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry));
  const rows = Object.entries(snapshot).map(([name, preset]) => {
    if (!name.trim() || !preset || typeof preset !== 'object' || Array.isArray(preset)
      || ['fixedPrompt', 'fixedPrompt_end', 'negativePrompt'].some(key => preset[key] != null && typeof preset[key] !== 'string')) {
      throw Error(`画师串「${name}」格式无效，未导入任何内容`);
    }
    const matches = records.filter(entry => String(entry.name || '').trim() === name.trim());
    const record = matches.length === 1 ? matches[0] : undefined;
    return {name, preset, targets: styles.filter(s => s.name === name).map(s => s.id),
      params: record ? sourceParams(record, naiSnapshot.paramGroups || {}) : undefined,
      coverData: record ? embeddedImage(record.thumb) : '',
      note: matches.length > 1 ? 'NAI 同名记录有多条，未合并参数和封面' : record?.thumb && !embeddedImage(record.thumb) ? '封面格式不支持，未导入封面' : ''};
  });
  if (!rows.length) throw Error('st-chatu8 中没有可导入的画师串');
  return rows;
}

export function stripArtistAnnotations(text) {
  let result = String(text ?? ''), before;
  do {
    before = result;
    result = result.replace(/（[^（）]*）/g, '');
  } while (before !== result);
  return result;
}
