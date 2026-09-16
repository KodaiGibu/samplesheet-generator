/**
 * SampleSheet 作成ツール — UI レイヤー
 *
 * タブ:
 *   MiSeq i100 … UDI index（set 指定）、[Data] 8列
 *   MiSeq      … UDI index（set 指定）、[Data] 6列
 *   index 一覧 … 収録 index の参照
 */
import {
  APP_TITLE, DEFAULTS_I100, DEFAULTS_MISEQ,
  normalizeDate, expandSetRange, groupIndexes, splitRows, appendSuffix,
  buildRowsI100, buildRowsMiSeq, buildCsvI100, buildCsvMiSeq,
  csvFileName, dataHeader, tableHeader, SET_COLUMNS,
} from './sheet.js';

const $ = (id) => document.getElementById(id);

const app = {
  mode: 'i100',
  i100: { rows: [], params: null, namesTouched: false, baseline: {} },
  miseq: { rows: [], params: null, baseline: {} },
};

// ══ ダイアログ・ステータス ══
const dlgMsg = $('dlg-msg');
function showMessage(title, body) {
  return new Promise((resolve) => {
    $('msg-title').textContent = title;
    $('msg-body').textContent = body;
    const ok = () => { $('msg-ok').removeEventListener('click', ok); dlgMsg.close(); resolve(true); };
    $('msg-ok').addEventListener('click', ok);
    dlgMsg.showModal();
  });
}
function setStatus(text, isError = false) {
  const sb = $('statusbar');
  sb.textContent = text;
  sb.classList.toggle('error', isError);
}

// ══ 行番号ガター ══
/** textarea の行数に合わせて番号を描画し、スクロールを同期する */
function attachGutter(taId, gutterId) {
  const ta = $(taId);
  const gutter = $(gutterId);
  const render = () => {
    const n = Math.max(ta.value.split('\n').length, 1);
    const frag = [];
    for (let i = 1; i <= n; i += 1) frag.push(i);
    gutter.textContent = frag.join('\n');
    gutter.scrollTop = ta.scrollTop;
  };
  ta.addEventListener('input', render);
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  ta._renderGutter = render;
  render();
}
/** 値を差し替えたあとに行番号を更新する */
function setTextareaValue(id, value) {
  const ta = $(id);
  ta.value = value;
  if (ta._renderGutter) ta._renderGutter();
}

// ══ タブ切替 ══
document.querySelectorAll('.mode-nb > .nb-tabs .nb-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    app.mode = btn.dataset.mode;
    document.querySelectorAll('.mode-nb > .nb-tabs .nb-tab')
      .forEach((b) => b.classList.toggle('active', b === btn));
    $('page-i100').classList.toggle('hidden', app.mode !== 'i100');
    $('page-miseq').classList.toggle('hidden', app.mode !== 'miseq');
    $('page-index').classList.toggle('hidden', app.mode !== 'index');
    if (app.mode === 'index') renderRefTable();
  });
});

// ══ 共通ヘルパ ══
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}
function renderWarnings(boxId, warnings) {
  const box = $(boxId);
  box.innerHTML = '';
  if (!warnings.length) { box.classList.add('hidden'); return; }
  const h = document.createElement('b');
  h.textContent = `確認事項 ${warnings.length}件`;
  box.appendChild(h);
  const ul = document.createElement('ul');
  warnings.forEach((w) => { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); });
  box.appendChild(ul);
  box.classList.remove('hidden');
}

/** 結果表を描画する。set名列は常に表示し、CSV 出力対象外なら淡色で示す */
function renderRows(treeId, rows, machine, withSetNames) {
  const header = tableHeader(machine);
  const table = $(treeId);
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const trh = document.createElement('tr');
  const thNo = document.createElement('th');
  thNo.textContent = '#';
  trh.appendChild(thNo);
  header.forEach((k) => {
    const th = document.createElement('th');
    th.textContent = k;
    if (SET_COLUMNS.includes(k)) {
      th.className = withSetNames ? 'setcol on' : 'setcol off';
      th.title = withSetNames ? 'CSVに出力されます' : 'CSVには出力されません（画面表示のみ）';
    }
    if (k === 'Sample_ID' || k === 'Sample_Name') th.classList.add('w-id');
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const tdNo = document.createElement('td');
    tdNo.textContent = String(i + 1);
    tdNo.className = 'num';
    tr.appendChild(tdNo);
    header.forEach((k) => {
      const td = document.createElement('td');
      td.textContent = r[k] ?? '';
      if (k === 'Sample_ID' || k === 'Sample_Name' || k === 'Description') td.className = 'left';
      if (SET_COLUMNS.includes(k)) td.className = withSetNames ? 'setcol on' : 'setcol off';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

async function fillDescription(idsEl, descEl) {
  const ids = splitRows($(idsEl).value).filter((s) => s !== '');
  if (!ids.length) { await showMessage('データなし', 'さきに Sample_ID を入力してください。'); return; }
  const first = splitRows($(descEl).value).filter((s) => s !== '')[0] ?? '';
  const val = window.prompt('全行に入力する Description を指定してください。', first);
  if (val === null) return;
  setTextareaValue(descEl, ids.map(() => val).join('\n'));
  setStatus(`Description を ${ids.length} 行に一括入力しました`);
}

/**
 * 接尾辞の付与。対象列ごとに「最初の付与前の内容」を baseline として保持する。
 */
async function applySuffix(state, targets, targetSel, fromId, toId, textId) {
  const key = $(targetSel).value;
  const elId = targets[key];
  try {
    const before = $(elId).value;
    const r = appendSuffix(before, Number($(fromId).value), Number($(toId).value), $(textId).value);
    // 初回の付与時のみベースラインを記録する（2回目以降は上書きしない）
    if (state.baseline[elId] === undefined) state.baseline[elId] = before;
    setTextareaValue(elId, r.text);
    setStatus(`${$(targetSel).selectedOptions[0].textContent} の ` +
      `行 ${$(fromId).value}〜${$(toId).value} に "${$(textId).value}" を追加しました（${r.count}行）`);
  } catch (e) { await showMessage('入力エラー', e.message); }
}
/** 対象列を「最初の付与前」の状態に戻す */
async function undoSuffix(state, targets, targetSel) {
  const key = $(targetSel).value;
  const elId = targets[key];
  if (state.baseline[elId] === undefined) {
    await showMessage('取り消し不可',
      `${$(targetSel).selectedOptions[0].textContent} には文字列追加の履歴がありません。`);
    return;
  }
  setTextareaValue(elId, state.baseline[elId]);
  delete state.baseline[elId];
  setStatus(`${$(targetSel).selectedOptions[0].textContent} を文字列追加前の状態に戻しました`);
}

// ══════════ MiSeq i100 タブ ══════════
function applyDefaultsI100() {
  $('a-module').value = DEFAULTS_I100.module;
  $('a-workflow').value = DEFAULTS_I100.workflow;
  $('a-prep').value = DEFAULTS_I100.libraryPrepKit;
  $('a-indexkit').value = DEFAULTS_I100.indexKit;
  $('a-desc').value = DEFAULTS_I100.description;
  $('a-chem').value = DEFAULTS_I100.chemistry;
  $('a-adapter').value = DEFAULTS_I100.adapter;
  $('a-adv').value = DEFAULTS_I100.advancedSetting1;
  $('a-read1').value = DEFAULTS_I100.reads[0];
  $('a-read2').value = DEFAULTS_I100.reads[1];
  $('a-project').value = DEFAULTS_I100.sampleProject;
}
$('a-reset').addEventListener('click', () => {
  applyDefaultsI100();
  setStatus('[Header] / [Settings] を既定値に戻しました');
});

function refreshCount(prefix) {
  const el = $(`${prefix}-count`);
  try {
    const n7 = expandSetRange($(`${prefix}-i7-start`).value, $(`${prefix}-i7-end`).value, 'Index1 (i7)').length;
    const n5 = expandSetRange($(`${prefix}-i5-start`).value, $(`${prefix}-i5-end`).value, 'Index2 (i5)').length;
    const nId = splitRows($(`${prefix}-ids`).value).filter((s) => s !== '').length;
    el.classList.remove('bad');
    el.textContent = `i7: ${n7} 件 / i5: ${n5} 件 / Sample_ID: ${nId} 件`;
    if (nId && (n7 < nId || n5 < nId)) el.classList.add('bad');
  } catch (e) { el.classList.add('bad'); el.textContent = e.message; }
}
['a-i7-start', 'a-i7-end', 'a-i5-start', 'a-i5-end', 'a-ids'].forEach((id) => {
  $(id).addEventListener('input', () => refreshCount('a'));
});

$('a-names').addEventListener('input', () => { app.i100.namesTouched = true; });
$('a-ids').addEventListener('input', () => {
  if (!app.i100.namesTouched || $('a-names').value.trim() === '') setTextareaValue('a-names', $('a-ids').value);
});
$('a-copy-names').addEventListener('click', () => {
  setTextareaValue('a-names', $('a-ids').value);
  app.i100.namesTouched = false;
  delete app.i100.baseline['a-names'];
  setStatus('Sample_ID を Sample_Name に反映しました（この後 個別に修正できます）');
});
$('a-fill-desc').addEventListener('click', () => fillDescription('a-ids', 'a-descs'));

const I100_TARGETS = { names: 'a-names', ids: 'a-ids', descs: 'a-descs' };
$('a-suffix-apply').addEventListener('click', () =>
  applySuffix(app.i100, I100_TARGETS, 'a-suffix-target', 'a-suffix-from', 'a-suffix-to', 'a-suffix-text'));
$('a-suffix-undo').addEventListener('click', () =>
  undoSuffix(app.i100, I100_TARGETS, 'a-suffix-target'));

$('a-with-set').addEventListener('change', () => {
  if (app.i100.rows.length) renderRows('a-tree', app.i100.rows, 'i100', $('a-with-set').checked);
  setStatus($('a-with-set').checked
    ? 'set名列をCSVに出力します（Index1_Set / Index2_Set）'
    : 'set名列は画面表示のみでCSVには出力しません');
});

$('a-build').addEventListener('click', async () => {
  let params;
  try {
    params = {
      date: normalizeDate($('a-date').value),
      experimentName: $('a-exp').value.trim(),
      module: $('a-module').value,
      workflow: $('a-workflow').value,
      libraryPrepKit: $('a-prep').value,
      indexKit: $('a-indexkit').value,
      description: $('a-desc').value,
      chemistry: $('a-chem').value,
      adapter: $('a-adapter').value,
      advancedSetting1: $('a-adv').value,
      reads: [$('a-read1').value.trim(), $('a-read2').value.trim()].filter((s) => s !== ''),
    };
  } catch (e) { await showMessage('入力エラー', e.message); return; }

  let result;
  try {
    result = buildRowsI100({
      sampleIds: $('a-ids').value,
      sampleNames: $('a-names').value,
      descriptions: $('a-descs').value,
      i7Start: $('a-i7-start').value, i7End: $('a-i7-end').value,
      i5Start: $('a-i5-start').value, i5End: $('a-i5-end').value,
      sampleProject: $('a-project').value,
    });
  } catch (e) { await showMessage('入力エラー', e.message); return; }

  app.i100.rows = result.rows;
  app.i100.params = params;
  renderRows('a-tree', result.rows, 'i100', $('a-with-set').checked);
  renderWarnings('a-warn', result.warnings);
  setStatus(`[MiSeq i100] シート作成完了: ${result.rows.length}件 | Date ${params.date} | ` +
            `${result.rows[0].Index1_Set} 〜 ${result.rows[result.rows.length - 1].Index1_Set} | ` +
            `確認事項 ${result.warnings.length}件`);
});

$('a-clear').addEventListener('click', () => {
  ['a-ids', 'a-names', 'a-descs'].forEach((id) => setTextareaValue(id, ''));
  ['a-i7-start', 'a-i7-end', 'a-i5-start', 'a-i5-end'].forEach((id) => { $(id).value = ''; });
  app.i100 = { rows: [], params: null, namesTouched: false, baseline: {} };
  renderRows('a-tree', [], 'i100', $('a-with-set').checked);
  renderWarnings('a-warn', []); refreshCount('a');
  setStatus('クリアしました');
});

function ensureBuilt(state) {
  if (!state.rows.length || !state.params) {
    showMessage('データなし', 'さきに「シート作成」を実行してください。'); return false;
  }
  return true;
}
$('a-csv').addEventListener('click', async () => {
  if (!ensureBuilt(app.i100)) return;
  const withSet = $('a-with-set').checked;
  const name = csvFileName(app.i100.params.date, 'i100');
  downloadFile(name, buildCsvI100(app.i100.params, app.i100.rows, withSet), 'text/csv;charset=utf-8');
  await showMessage('完了', `CSVを保存しました。\n${name}\n列数: ${dataHeader('i100', withSet).length}` +
    `（set名列: ${withSet ? 'あり' : 'なし'}）`);
});
$('a-clip').addEventListener('click', async () => {
  if (!ensureBuilt(app.i100)) return;
  await copyText(buildCsvI100(app.i100.params, app.i100.rows, $('a-with-set').checked));
  setStatus(`クリップボードにコピーしました（${app.i100.rows.length}件, CSV全文）`);
});
$('a-preview').addEventListener('click', () => {
  if (!ensureBuilt(app.i100)) return;
  $('preview-body').textContent = buildCsvI100(app.i100.params, app.i100.rows, $('a-with-set').checked);
  $('dlg-preview').showModal();
});

$('a-demo').addEventListener('click', () => {
  const d = new Date();
  $('a-date').value = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  $('a-exp').value = 'eDNA-demo-run';
  $('a-i7-start').value = 'set1-1-1'; $('a-i7-end').value = 'set1-1-2';
  $('a-i5-start').value = 'set1-2-1'; $('a-i5-end').value = 'set1-2-2';
  const ids = []; const descs = [];
  for (let i = 1; i <= 8; i += 1) { ids.push(`Demo-Reef-${String(i).padStart(2, '0')}`); descs.push('Reef water (demo)'); }
  for (let i = 1; i <= 8; i += 1) { ids.push(`Demo-Sand-${String(i).padStart(2, '0')}`); descs.push('Sediment (demo)'); }
  setTextareaValue('a-ids', ids.join('\n'));
  setTextareaValue('a-names', ids.join('\n'));
  setTextareaValue('a-descs', descs.join('\n'));
  app.i100.namesTouched = false;
  app.i100.baseline = {};
  refreshCount('a');
  setStatus('テストデータ（仮想サンプル16件）を入力しました。「シート作成」を押してください');
});

// ══════════ MiSeq タブ ══════════
function applyDefaultsMiSeq() {
  $('b-module').value = DEFAULTS_MISEQ.module;
  $('b-workflow').value = DEFAULTS_MISEQ.workflow;
  $('b-prep').value = DEFAULTS_MISEQ.libraryPrepKit;
  $('b-desc').value = DEFAULTS_MISEQ.description;
  $('b-chem').value = DEFAULTS_MISEQ.chemistry;
  $('b-adapter').value = DEFAULTS_MISEQ.adapter;
  $('b-adv').value = DEFAULTS_MISEQ.advancedSetting1;
  $('b-read1').value = DEFAULTS_MISEQ.reads[0];
  $('b-read2').value = DEFAULTS_MISEQ.reads[1];
}
$('b-reset').addEventListener('click', () => {
  applyDefaultsMiSeq();
  setStatus('[Header] / [Settings] を既定値に戻しました');
});

['b-i7-start', 'b-i7-end', 'b-i5-start', 'b-i5-end', 'b-ids'].forEach((id) => {
  $(id).addEventListener('input', () => refreshCount('b'));
});
$('b-fill-desc').addEventListener('click', () => fillDescription('b-ids', 'b-descs'));

const MISEQ_TARGETS = { ids: 'b-ids', descs: 'b-descs' };
$('b-suffix-apply').addEventListener('click', () =>
  applySuffix(app.miseq, MISEQ_TARGETS, 'b-suffix-target', 'b-suffix-from', 'b-suffix-to', 'b-suffix-text'));
$('b-suffix-undo').addEventListener('click', () =>
  undoSuffix(app.miseq, MISEQ_TARGETS, 'b-suffix-target'));

$('b-with-set').addEventListener('change', () => {
  if (app.miseq.rows.length) renderRows('b-tree', app.miseq.rows, 'miseq', $('b-with-set').checked);
  setStatus($('b-with-set').checked
    ? 'set名列をCSVに出力します（Index1_Set / Index2_Set）'
    : 'set名列は画面表示のみでCSVには出力しません');
});

$('b-build').addEventListener('click', async () => {
  let params;
  try {
    params = {
      date: $('b-date').value.trim() === '' ? '' : normalizeDate($('b-date').value),
      experimentName: $('b-exp').value.trim(),
      module: $('b-module').value,
      workflow: $('b-workflow').value,
      libraryPrepKit: $('b-prep').value,
      description: $('b-desc').value,
      chemistry: $('b-chem').value,
      adapter: $('b-adapter').value,
      advancedSetting1: $('b-adv').value,
      reads: [$('b-read1').value.trim(), $('b-read2').value.trim()].filter((s) => s !== ''),
    };
  } catch (e) { await showMessage('入力エラー', e.message); return; }

  let result;
  try {
    result = buildRowsMiSeq({
      sampleIds: $('b-ids').value,
      descriptions: $('b-descs').value,
      i7Start: $('b-i7-start').value, i7End: $('b-i7-end').value,
      i5Start: $('b-i5-start').value, i5End: $('b-i5-end').value,
    });
  } catch (e) { await showMessage('入力エラー', e.message); return; }

  app.miseq.rows = result.rows;
  app.miseq.params = params;
  renderRows('b-tree', result.rows, 'miseq', $('b-with-set').checked);
  renderWarnings('b-warn', result.warnings);
  setStatus(`[MiSeq] シート作成完了: ${result.rows.length}件 | Date ${params.date || '(空欄)'} | ` +
            `${result.rows[0].Index1_Set} 〜 ${result.rows[result.rows.length - 1].Index1_Set} | ` +
            `確認事項 ${result.warnings.length}件`);
});

$('b-clear').addEventListener('click', () => {
  ['b-ids', 'b-descs'].forEach((id) => setTextareaValue(id, ''));
  ['b-i7-start', 'b-i7-end', 'b-i5-start', 'b-i5-end'].forEach((id) => { $(id).value = ''; });
  app.miseq = { rows: [], params: null, baseline: {} };
  renderRows('b-tree', [], 'miseq', $('b-with-set').checked);
  renderWarnings('b-warn', []); refreshCount('b');
  setStatus('クリアしました');
});

$('b-csv').addEventListener('click', async () => {
  if (!ensureBuilt(app.miseq)) return;
  const withSet = $('b-with-set').checked;
  const name = csvFileName(app.miseq.params.date, 'miseq');
  downloadFile(name, buildCsvMiSeq(app.miseq.params, app.miseq.rows, withSet), 'text/csv;charset=utf-8');
  await showMessage('完了', `CSVを保存しました。\n${name}\n列数: ${dataHeader('miseq', withSet).length}` +
    `（set名列: ${withSet ? 'あり' : 'なし'}）`);
});
$('b-clip').addEventListener('click', async () => {
  if (!ensureBuilt(app.miseq)) return;
  await copyText(buildCsvMiSeq(app.miseq.params, app.miseq.rows, $('b-with-set').checked));
  setStatus(`クリップボードにコピーしました（${app.miseq.rows.length}件, CSV全文）`);
});
$('b-preview').addEventListener('click', () => {
  if (!ensureBuilt(app.miseq)) return;
  $('preview-body').textContent = buildCsvMiSeq(app.miseq.params, app.miseq.rows, $('b-with-set').checked);
  $('dlg-preview').showModal();
});

$('b-demo').addEventListener('click', () => {
  const d = new Date();
  $('b-date').value = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  $('b-exp').value = 'demo-bacteria-run';
  $('b-i7-start').value = 'set1-1-1'; $('b-i7-end').value = 'set1-1-2';
  $('b-i5-start').value = 'set1-2-1'; $('b-i5-end').value = 'set1-2-2';
  const ids = []; const descs = [];
  for (let i = 1; i <= 8; i += 1) { ids.push(`Demo-Coral-${String(i).padStart(2, '0')}`); descs.push('Coral polyp (demo)'); }
  for (let i = 1; i <= 8; i += 1) { ids.push(`Demo-Water-${String(i).padStart(2, '0')}`); descs.push('Tank water (demo)'); }
  setTextareaValue('b-ids', ids.join('\n'));
  setTextareaValue('b-descs', descs.join('\n'));
  app.miseq.baseline = {};
  refreshCount('b');
  setStatus('テストデータ（仮想サンプル16件）を入力しました。「シート作成」を押してください');
});

$('preview-close').addEventListener('click', () => $('dlg-preview').close());

// ══════════ index 一覧タブ ══════════
function renderRefTable() {
  const set = Number($('ref-set').value);
  const side = Number($('ref-side').value);
  const tbody = $('ref-tree').querySelector('tbody');
  tbody.innerHTML = '';
  for (let g = 1; g <= 12; g += 1) {
    groupIndexes(set, side, g).forEach((x, i) => {
      const tr = document.createElement('tr');
      [i === 0 ? x.groupLabel : '', String(i + 1), x.id, x.seq].forEach((v, ci) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (ci === 0) td.className = 'left strong';
        if (ci === 3) td.className = 'mono';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
}
['ref-set', 'ref-side'].forEach((id) => { $(id).addEventListener('change', renderRefTable); });

// ══════════ 初期化 ══════════
document.title = APP_TITLE;
applyDefaultsI100();
applyDefaultsMiSeq();
[['a-ids', 'a-ids-gutter'], ['a-names', 'a-names-gutter'], ['a-descs', 'a-descs-gutter'],
  ['b-ids', 'b-ids-gutter'], ['b-descs', 'b-descs-gutter']].forEach(([t, g]) => attachGutter(t, g));
renderRows('a-tree', [], 'i100', false);
renderRows('b-tree', [], 'miseq', false);
refreshCount('a');
refreshCount('b');
setStatus('準備完了');
