import {btn, esc, groupTitle} from './common.js';
import {icon} from './icons.js';
import {artistImportRows} from '../core/chatu8-artists.js';

/** Capture both sources once; neither source is changed by importing. */
export function importChatu8Sheet(ctx, afterImport = () => {}) {
  const {api} = ctx, snapshot = api.chatu8ArtistSnapshot(), naiSnapshot = api.naiSwitcherSnapshot?.() || {entries: {}, paramGroups: {}};
  const styles = api.getState().draw.styles, rows = artistImportRows(snapshot, styles, naiSnapshot);
  const fresh = rows.filter(row => !row.targets.length), conflicts = rows.filter(row => row.targets.length);
  const withParams = rows.filter(row => row.params).length, withCovers = rows.filter(row => row.coverData).length;
  const targets = conflicts.flatMap(row => row.targets.map((id, index) => ({id, source: row, name: row.name + (row.targets.length > 1 ? ` (${index + 1}/${row.targets.length})` : '')})));
  const rowLabel = row => `${row.params ? '参数' : ''}${row.coverData ? `${row.params ? ' · ' : ''}封面` : ''}` || '仅词条';
  const rowName = row => `${esc(row.name)}${row.note ? `<small>${esc(row.note)}</small>` : ''}`;
  const d = ctx.dialog('导入 chatu8 + NAI 画师串', `<div class="group pad"><p>新增 ${fresh.length} 个 · 同名 ${conflicts.length} 个 · 有参数 ${withParams} 个 · 有封面 ${withCovers} 张</p></div>
    ${fresh.length ? groupTitle('新增画风') + `<div class="group">${fresh.map(row => `<div class="setting-row"><span>${rowName(row)}</span><small>${rowLabel(row)}</small></div>`).join('')}</div>` : ''}
    ${targets.length ? groupTitle('覆盖同名画风') + `<div class="group"><label class="setting-row"><span>全部覆盖</span><input class="switch" type="checkbox" data-overwrite-all aria-label="覆盖全部同名画风"></label>
      ${targets.map(row => `<label class="setting-row"><span>${rowName({...row.source, name: row.name})}<small>${rowLabel(row.source)}</small></span><input type="checkbox" data-overwrite-style="${esc(row.id)}" aria-label="覆盖 ${esc(row.name)}"></label>`).join('')}</div>` : ''}
    <div class="actions">${btn('import-chatu8-apply', icon('import') + '导入', 'primary')}${btn('import-chatu8-cancel', '取消', 'secondary')}</div>`);
  d.body.classList.add('chatu8-import');
  const boxes = [...d.body.querySelectorAll('[data-overwrite-style]')], all = d.body.querySelector('[data-overwrite-all]');
  let busy = false;
  const refresh = () => {
    const selected = boxes.filter(box => box.checked).length, button = d.body.querySelector('[data-action=import-chatu8-apply]');
    button.disabled = busy || (!fresh.length && !selected);
    button.innerHTML = icon('import') + (busy ? '正在导入…' : `导入 ${fresh.length} 个` + (selected ? `，覆盖 ${selected} 个` : ''));
    d.body.querySelector('[data-action=import-chatu8-cancel]').disabled = busy;
    for (const box of boxes) box.disabled = busy;
    if (all) all.disabled = busy;
    if (all) { all.checked = selected === boxes.length; all.indeterminate = selected > 0 && selected < boxes.length; }
  };
  d.body.addEventListener('change', e => {
    if (busy) return;
    if (e.target === all) for (const box of boxes) box.checked = all.checked;
    refresh();
  });
  d.body.addEventListener('click', async e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (busy) return;
    if (action === 'import-chatu8-cancel') { d.close(); return; }
    if (action !== 'import-chatu8-apply' || !d.live) return;
    const button = d.body.querySelector('[data-action=import-chatu8-apply]');
    if (button.disabled) return;
    busy = true;
    refresh();
    try {
      const result = await api.importChatu8Artists(snapshot, boxes.filter(box => box.checked).map(box => box.dataset.overwriteStyle), naiSnapshot);
      d.close();
      afterImport();
      ctx.notify(`已导入 ${result.added} 个，覆盖 ${result.overwritten} 个，跳过 ${result.skipped} 个`);
    } catch (error) { busy = false; ctx.notify(error.message, {error: true}); refresh(); }
  });
  refresh();
  return d;
}
