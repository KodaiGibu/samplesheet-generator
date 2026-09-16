/**
 * SampleSheet 作成ツール — UI レイヤー
 * 画面構成・配色は DNA希釈計算ツール（MiSeq用）v2.2 Web版に準拠。
 *
 * タブ:
 *   MiSeq i100 … UDI index（set 指定）、[Data] 8列
 *   MiSeq      … Nextera index、[Data] 6列
 *   index 一覧 … 収録 index の参照
 */
import {
  APP_TITLE, DEFAULTS_I100, DEFAULTS_MISEQ,
  DATA_HEADER_I100, DATA_HEADER_MISEQ,
  NEXTERA_I7, NEXTERA_I5,
  normalizeDate, expandSetRange, groupIndexes, splitRows, appendSuffix, sliceNextera,
  buildRowsI100, buildRowsMiSeq, buildCsvI100, buildCsvMiSeq, csvFileName,
} from './sheet.js';

const $ = (id) => document.getElementById(id);

const app = {
  mode: 'i100',
  i100: { rows: [], params: null, namesTouched: false, undo: null },
  miseq: { rows: [], params: null, undo: null },
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

// ══════════ 共通ヘルパ ══════════
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
function renderRows(treeId, rows, header, leftCols) {
  const tbody = $(treeId).querySelector('tbody');
  tbody.innerHTML = '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const cells = [String(i + 1), ...header.map((k) => r[k])];
    cells.forEach((v, ci) => {
      const td = document.createElement('td');
      td.textContent = v;
      if (ci === 0) td.className = 'num';
      else if (ci <= leftCols) td.className = 'left';
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
  $(descEl).value = ids.map(() => val).join('\n');
  setStatus(`Description を ${ids.length} 行に一括入力しました`);
}

/** 接尾辞付与（対象テキストエリアのIDをマップで受け取る） */
async function applySuffix(state, targets, targetSel, fromId, toId, textId) {
  const key = $(targetSel).value;
  const elId = targets[key];
  try {
    const before = $(elId).value;
    const r = appendSuffix(before, Number($(fromId).value), Number($(toId).value), $(textId).value);
    state.undo = { elId, text: before };
    $(elId).value = r.text;
    setStatus(`${$(targetSel).selectedOptions[0].textContent} の ` +
      `行 ${$(fromId).value}〜${$(toId).value} に "${$(textId).value}" を追加しました（${r.count}行）`);
  } catch (e) { await showMessage('入力エラー', e.message); }
}
async function undoSuffix(state) {
  if (!state.undo) { await showMessage('取り消し不可', '直前の追加操作がありません。'); return; }
  $(state.undo.elId).value = state.undo.text;
  state.undo = null;
  setStatus('直前の文字列追加を元に戻しました');
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

function refreshCountI100() {
  const el = $('a-count');
  try {
    const n7 = expandSetRange($('a-i7-start').value, $('a-i7-end').value, 'Index1 (i7)').length;
    const n5 = expandSetRange($('a-i5-start').value, $('a-i5-end').value, 'Index2 (i5)').length;
    const nId = splitRows($('a-ids').value).filter((s) => s !== '').length;
    el.classList.remove('bad');
    el.textContent = `i7: ${n7} 件 / i5: ${n5} 件 / Sample_ID: ${nId} 件`;
    if (nId && (n7 < nId || n5 < nId)) el.classList.add('bad');
  } catch (e) { el.classList.add('bad'); el.textContent = e.message; }
}
['a-i7-start', 'a-i7-end', 'a-i5-start', 'a-i5-end', 'a-ids'].forEach((id) => {
  $(id).addEventListener('input', refreshCountI100);
});

$('a-names').addEventListener('input', () => { app.i100.namesTouched = true; });
$('a-ids').addEventListener('input', () => {
  if (!app.i100.namesTouched || $('a-names').value.trim() === '') $('a-names').value = $('a-ids').value;
});
$('a-copy-names').addEventListener('click', () => {
  $('a-names').value = $('a-ids').value;
  app.i100.namesTouched = false;
  setStatus('Sample_ID を Sample_Name に反映しました（この後 個別に修正できます）');
});
$('a-fill-desc').addEventListener('click', () => fillDescription('a-ids', 'a-descs'));

const I100_TARGETS = { names: 'a-names', ids: 'a-ids', descs: 'a-descs' };
$('a-suffix-apply').addEventListener('click', () =>
  applySuffix(app.i100, I100_TARGETS, 'a-suffix-target', 'a-suffix-from', 'a-suffix-to', 'a-suffix-text'));
$('a-suffix-undo').addEventListener('click', () => undoSuffix(app.i100));

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
  renderRows('a-tree', result.rows, DATA_HEADER_I100, 3);
  renderWarnings('a-warn', result.warnings);
  setStatus(`[MiSeq i100] シート作成完了: ${result.rows.length}件 | Date ${params.date} | ` +
            `Reads ${params.reads.join('/')} | 確認事項 ${result.warnings.length}件`);
});

$('a-clear').addEventListener('click', () => {
  ['a-ids', 'a-names', 'a-descs'].forEach((id) => { $(id).value = ''; });
  ['a-i7-start', 'a-i7-end', 'a-i5-start', 'a-i5-end'].forEach((id) => { $(id).value = ''; });
  app.i100 = { rows: [], params: null, namesTouched: false, undo: null };
  renderRows('a-tree', [], DATA_HEADER_I100, 3);
  renderWarnings('a-warn', []); refreshCountI100();
  setStatus('クリアしました');
});

function ensureI100() {
  if (!app.i100.rows.length || !app.i100.params) {
    showMessage('データなし', 'さきに「シート作成」を実行してください。'); return false;
  }
  return true;
}
$('a-csv').addEventListener('click', async () => {
  if (!ensureI100()) return;
  const name = csvFileName(app.i100.params.date, 'i100');
  downloadFile(name, buildCsvI100(app.i100.params, app.i100.rows), 'text/csv;charset=utf-8');
  await showMessage('完了', `CSVを保存しました。\n${name}`);
});
$('a-clip').addEventListener('click', async () => {
  if (!ensureI100()) return;
  await copyText(buildCsvI100(app.i100.params, app.i100.rows));
  setStatus(`クリップボードにコピーしました（${app.i100.rows.length}件, CSV全文）`);
});
$('a-preview').addEventListener('click', () => {
  if (!ensureI100()) return;
  $('preview-body').textContent = buildCsvI100(app.i100.params, app.i100.rows);
  $('dlg-preview').showModal();
});

// テストデータ（仮想サンプル）
$('a-demo').addEventListener('click', () => {
  const d = new Date();
  $('a-date').value = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  $('a-exp').value = 'eDNA-demo-run';
  $('a-i7-start').value = 'set1-1-1'; $('a-i7-end').value = 'set1-1-2';
  $('a-i5-start').value = 'set1-2-1'; $('a-i5-end').value = 'set1-2-2';
  const ids = [];
  const descs = [];
  for (let i = 1; i <= 8; i += 1) { ids.push(`Demo-Reef-${String(i).padStart(2, '0')}`); descs.push('Reef water (demo)'); }
  for (let i = 1; i <= 8; i += 1) { ids.push(`Demo-Sand-${String(i).padStart(2, '0')}`); descs.push('Sediment (demo)'); }
  $('a-ids').value = ids.join('\n');
  $('a-names').value = ids.join('\n');
  $('a-descs').value = descs.join('\n');
  app.i100.namesTouched = false;
  refreshCountI100();
  setStatus('テストデータ（仮想サンプル16件）を入力しました。「シート作成」を押してください');
});

// ══════════ MiSeq タブ ══════════
function fillSelect(el, list, selected) {
  el.innerHTML = '';
  list.forEach(([id, seq]) => {
    const o = document.createElement('option');
    o.value = id; o.textContent = `${id}  ${seq}`;
    el.appendChild(o);
  });
  el.value = selected;
}
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

function refreshCountMiSeq() {
  const el = $('b-count');
  try {
    const i7 = sliceNextera(NEXTERA_I7, $('b-i7-start').value, $('b-i7-end').value, 'Index1 (i7)');
    const i5 = sliceNextera(NEXTERA_I5, $('b-i5-start').value, $('b-i5-end').value, 'Index2 (i5)');
    const nId = splitRows($('b-ids').value).filter((s) => s !== '').length;
    el.classList.remove('bad');
    el.textContent = `i7: ${i7.length} 件 × i5: ${i5.length} 件 = ${i7.length * i5.length} 通り / Sample_ID: ${nId} 件`;
    if (nId && nId > i7.length * i5.length) el.classList.add('bad');
  } catch (e) { el.classList.add('bad'); el.textContent = e.message; }
}
['b-i7-start', 'b-i7-end', 'b-i5-start', 'b-i5-end'].forEach((id) => {
  $(id).addEventListener('change', refreshCountMiSeq);
});
$('b-ids').addEventListener('input', refreshCountMiSeq);
$('b-fill-desc').addEventListener('click', () => fillDescription('b-ids', 'b-descs'));

const MISEQ_TARGETS = { ids: 'b-ids', descs: 'b-descs' };
$('b-suffix-apply').addEventListener('click', () =>
  applySuffix(app.miseq, MISEQ_TARGETS, 'b-suffix-target', 'b-suffix-from', 'b-suffix-to', 'b-suffix-text'));
$('b-suffix-undo').addEventListener('click', () => undoSuffix(app.miseq));

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
  renderRows('b-tree', result.rows, DATA_HEADER_MISEQ, 2);
  renderWarnings('b-warn', result.warnings);
  setStatus(`[MiSeq] シート作成完了: ${result.rows.length}件 | ` +
            `Date ${params.date || '(空欄)'} | Reads ${params.reads.join('/')} | ` +
            `確認事項 ${result.warnings.length}件`);
});

$('b-clear').addEventListener('click', () => {
  ['b-ids', 'b-descs'].forEach((id) => { $(id).value = ''; });
  app.miseq = { rows: [], params: null, undo: null };
  renderRows('b-tree', [], DATA_HEADER_MISEQ, 2);
  renderWarnings('b-warn', []); refreshCountMiSeq();
  setStatus('クリアしました');
});

function ensureMiSeq() {
  if (!app.miseq.rows.length || !app.miseq.params) {
    showMessage('データなし', 'さきに「シート作成」を実行してください。'); return false;
  }
  return true;
}
$('b-csv').addEventListener('click', async () => {
  if (!ensureMiSeq()) return;
  const name = csvFileName(app.miseq.params.date, 'miseq');
  downloadFile(name, buildCsvMiSeq(app.miseq.params, app.miseq.rows), 'text/csv;charset=utf-8');
  await showMessage('完了', `CSVを保存しました。\n${name}`);
});
$('b-clip').addEventListener('click', async () => {
  if (!ensureMiSeq()) return;
  await copyText(buildCsvMiSeq(app.miseq.params, app.miseq.rows));
  setStatus(`クリップボードにコピーしました（${app.miseq.rows.length}件, CSV全文）`);
});
$('b-preview').addEventListener('click', () => {
  if (!ensureMiSeq()) return;
  $('preview-body').textContent = buildCsvMiSeq(app.miseq.params, app.miseq.rows);
  $('dlg-preview').showModal();
});

$('b-demo').addEventListener('click', () => {
  const d = new Date();
  $('b-date').value = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  $('b-exp').value = 'demo-bacteria-run';
  $('b-i7-start').value = 'N701'; $('b-i7-end').value = 'N729';
  $('b-i5-start').value = 'S508'; $('b-i5-end').value = 'S516';
  const ids = [];
  const descs = [];
  for (let i = 1; i <= 8; i += 1) { ids.push(`Demo-Coral-${String(i).padStart(2, '0')}`); descs.push('Coral polyp (demo)'); }
  for (let i = 1; i <= 8; i += 1) { ids.push(`Demo-Water-${String(i).padStart(2, '0')}`); descs.push('Tank water (demo)'); }
  $('b-ids').value = ids.join('\n');
  $('b-descs').value = descs.join('\n');
  refreshCountMiSeq();
  setStatus('テストデータ（仮想サンプル16件）を入力しました。「シート作成」を押してください');
});

$('preview-close').addEventListener('click', () => $('dlg-preview').close());

// ══════════ index 一覧タブ ══════════
function renderRefTable() {
  const kind = $('ref-kind').value;
  document.querySelectorAll('.udi-only').forEach((e) => e.classList.toggle('hidden', kind !== 'udi'));
  document.querySelectorAll('.nextera-only').forEach((e) => e.classList.toggle('hidden', kind !== 'nextera'));
  const tbody = $('ref-tree').querySelector('tbody');
  tbody.innerHTML = '';
  const push = (cells) => {
    const tr = document.createElement('tr');
    cells.forEach((v, ci) => {
      const td = document.createElement('td');
      td.textContent = v;
      if (ci === 0) td.className = 'left strong';
      if (ci === 3) td.className = 'mono';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  };
  if (kind === 'udi') {
    const set = Number($('ref-set').value);
    const side = Number($('ref-side').value);
    for (let g = 1; g <= 12; g += 1) {
      groupIndexes(set, side, g).forEach((x, i) => {
        push([i === 0 ? `set${set}-${side}-${g}` : '', String(i + 1), x.id, x.seq]);
      });
    }
  } else {
    const list = $('ref-nx-side').value === 'i7' ? NEXTERA_I7 : NEXTERA_I5;
    const label = $('ref-nx-side').value === 'i7' ? 'Nextera i7' : 'Nextera i5';
    list.forEach(([id, seq], i) => push([i === 0 ? label : '', String(i + 1), id, seq]));
  }
}
['ref-kind', 'ref-set', 'ref-side', 'ref-nx-side'].forEach((id) => {
  $(id).addEventListener('change', renderRefTable);
});

// ══════════ 初期化 ══════════
document.title = APP_TITLE;
applyDefaultsI100();
applyDefaultsMiSeq();
fillSelect($('b-i7-start'), NEXTERA_I7, 'N701');
fillSelect($('b-i7-end'), NEXTERA_I7, 'N729');
fillSelect($('b-i5-start'), NEXTERA_I5, 'S508');
fillSelect($('b-i5-end'), NEXTERA_I5, 'S516');
refreshCountI100();
refreshCountMiSeq();
setStatus('準備完了');
