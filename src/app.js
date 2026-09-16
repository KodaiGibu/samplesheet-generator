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
  normalizeDate, expandSetRanges, groupIndexes, splitRows, appendSuffix,
  buildRowsI100, buildRowsMiSeq, buildCsvI100, buildCsvMiSeq,
  csvFileName, dataHeader, tableHeader, SET_COLUMNS,
} from './sheet.js';

const $ = (id) => document.getElementById(id);

const app = {
  mode: 'i100',
  i100: { rows: [], params: null, baseline: {} },
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
    if (k === 'Sample_ID' || k === 'Sample_Name' || k === 'LibraryName') th.classList.add('w-id');
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
      if (['Sample_ID', 'Sample_Name', 'Description', 'LibraryName'].includes(k)) td.className = 'left';
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
  $('a-runname').value = DEFAULTS_I100.runName;
  $('a-ffv').value = DEFAULTS_I100.fileFormatVersion;
  $('a-platform').value = DEFAULTS_I100.instrumentPlatform;
  $('a-orientation').value = DEFAULTS_I100.indexOrientation;
  $('a-analysis').value = DEFAULTS_I100.analysisLocation;
  $('a-read1').value = DEFAULTS_I100.read1Cycles;
  $('a-read2').value = DEFAULTS_I100.read2Cycles;
  $('a-idx1cyc').value = DEFAULTS_I100.index1Cycles;
  $('a-idx2cyc').value = DEFAULTS_I100.index2Cycles;
  $('a-swver').value = DEFAULTS_I100.softwareVersion;
  $('a-fastqfmt').value = DEFAULTS_I100.fastqCompressionFormat;
  $('a-nolane').value = DEFAULTS_I100.noLaneSplitting;
  $('a-fastqc').value = DEFAULTS_I100.generateFastqcMetrics;
  $('a-override').value = DEFAULTS_I100.overrideCycles;
  $('a-genver').value = DEFAULTS_I100.generatedVersion;
  $('a-project').value = DEFAULTS_I100.projectName;
  $('a-prepkit').value = DEFAULTS_I100.libraryPrepKitName;
  $('a-adapterkit').value = DEFAULTS_I100.indexAdapterKitName;
}
$('a-reset').addEventListener('click', () => {
  applyDefaultsI100();
  setStatus('[Header] / [Settings] を既定値に戻しました');
});

// ══ Index 範囲ブロック（複数セット対応）══

/** 範囲ブロックの入力値を配列で取得する。例: readRanges('a-i7') */
function readRanges(key) {
  return [...$(`${key}-rows`).querySelectorAll('.range-row')].map((row) => ({
    start: row.querySelector('.r-start').value,
    end: row.querySelector('.r-end').value,
  }));
}

/** 範囲ブロックを1行追加する */
function addRangeRow(key, start = '', end = '') {
  const rows = $(`${key}-rows`);
  const side = key.endsWith('i7') ? 1 : 2;
  const row = document.createElement('div');
  row.className = 'range-row';
  row.innerHTML = `
    <span class="r-no"></span>
    <label>開始 set:<input type="text" class="r-start" size="12" placeholder="set1-${side}-1"></label>
    <label>終了 set:<input type="text" class="r-end" size="12" placeholder="set1-${side}-12"></label>
    <span class="r-info"></span>
    <button type="button" class="mini danger r-del" title="この範囲を削除">×</button>`;
  row.querySelector('.r-start').value = start;
  row.querySelector('.r-end').value = end;
  rows.appendChild(row);

  const prefix = key.slice(0, 1);
  row.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', () => refreshCount(prefix));
  });
  row.querySelector('.r-del').addEventListener('click', () => {
    if (rows.querySelectorAll('.range-row').length <= 1) {
      row.querySelector('.r-start').value = '';
      row.querySelector('.r-end').value = '';
    } else {
      row.remove();
    }
    refreshCount(prefix);
  });
  renumberRanges(key);
  return row;
}

/** 行番号と各範囲の件数表示を更新する */
function renumberRanges(key) {
  const rows = [...$(`${key}-rows`).querySelectorAll('.range-row')];
  const label = key.endsWith('i7') ? 'Index1 (i7)' : 'Index2 (i5)';
  rows.forEach((row, i) => {
    row.querySelector('.r-no').textContent = rows.length > 1 ? `範囲${i + 1}` : '';
    const info = row.querySelector('.r-info');
    const start = row.querySelector('.r-start').value.trim();
    const end = row.querySelector('.r-end').value.trim();
    if (start === '' && end === '') { info.textContent = ''; info.classList.remove('bad'); return; }
    try {
      const n = expandSetRanges([{ start, end }], label).indexes.length;
      info.textContent = `${n} index`;
      info.classList.remove('bad');
    } catch { info.textContent = '指定エラー'; info.classList.add('bad'); }
  });
}

/** 範囲ブロックを初期化（1行だけにして値を設定） */
function resetRanges(key, start = '', end = '') {
  $(`${key}-rows`).innerHTML = '';
  addRangeRow(key, start, end);
}

document.querySelectorAll('[data-add-range]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.addRange;
    addRangeRow(key);
    refreshCount(key.slice(0, 1));
    setStatus(`${key.endsWith('i7') ? 'Index1 (i7)' : 'Index2 (i5)'} に範囲を追加しました`);
  });
});

function refreshCount(prefix) {
  const el = $(`${prefix}-count`);
  renumberRanges(`${prefix}-i7`);
  renumberRanges(`${prefix}-i5`);
  try {
    const n7 = expandSetRanges(readRanges(`${prefix}-i7`), 'Index1 (i7)').indexes.length;
    const n5 = expandSetRanges(readRanges(`${prefix}-i5`), 'Index2 (i5)').indexes.length;
    const nId = splitRows($(`${prefix}-ids`).value).filter((s) => s !== '').length;
    el.classList.remove('bad');
    el.textContent = `i7: ${n7} 件 / i5: ${n5} 件 / Sample_ID: ${nId} 件`;
    if (nId && (n7 < nId || n5 < nId)) el.classList.add('bad');
  } catch (e) { el.classList.add('bad'); el.textContent = e.message; }
}
$('a-ids').addEventListener('input', () => refreshCount('a'));

const I100_TARGETS = { ids: 'a-ids' };
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
  const params = {
    runName: $('a-runname').value.trim(),
    fileFormatVersion: $('a-ffv').value.trim(),
    instrumentPlatform: $('a-platform').value.trim(),
    indexOrientation: $('a-orientation').value,
    analysisLocation: $('a-analysis').value,
    read1Cycles: $('a-read1').value.trim(),
    read2Cycles: $('a-read2').value.trim(),
    index1Cycles: $('a-idx1cyc').value.trim(),
    index2Cycles: $('a-idx2cyc').value.trim(),
    softwareVersion: $('a-swver').value.trim(),
    overrideCycles: $('a-override').value.trim(),
    fastqCompressionFormat: $('a-fastqfmt').value.trim(),
    noLaneSplitting: $('a-nolane').value,
    generateFastqcMetrics: $('a-fastqc').value,
    generatedVersion: $('a-genver').value.trim(),
  };
  if (params.runName === '') { await showMessage('入力エラー', 'RunName を入力してください。'); return; }

  let result;
  try {
    result = buildRowsI100({
      sampleIds: $('a-ids').value,
      projectName: $('a-project').value,
      libraryPrepKitName: $('a-prepkit').value,
      indexAdapterKitName: $('a-adapterkit').value,
      i7Ranges: readRanges('a-i7'),
      i5Ranges: readRanges('a-i5'),
    });
  } catch (e) { await showMessage('入力エラー', e.message); return; }

  app.i100.rows = result.rows;
  app.i100.params = params;
  renderRows('a-tree', result.rows, 'i100', $('a-with-set').checked);
  renderWarnings('a-warn', result.warnings);
  setStatus(`[MiSeq i100] シート作成完了: ${result.rows.length}件 | RunName ${params.runName} | ` +
            `${result.rows[0].Index1_Set} 〜 ${result.rows[result.rows.length - 1].Index1_Set} | ` +
            `確認事項 ${result.warnings.length}件`);
});

$('a-clear').addEventListener('click', () => {
  setTextareaValue('a-ids', '');
  resetRanges('a-i7'); resetRanges('a-i5');
  app.i100 = { rows: [], params: null, baseline: {} };
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
  const name = csvFileName(app.i100.params.runName, 'i100');
  downloadFile(name, buildCsvI100(app.i100.params, app.i100.rows, withSet), 'text/csv;charset=utf-8');
  await showMessage('完了', `CSVを保存しました。\n${name}\n` +
    `SampleSheet v2 形式・全行 5 列（set名列: ${withSet ? 'あり' : 'なし'}）`);
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
  const p2 = (x) => String(x).padStart(2, '0');
  $('a-runname').value = `Demo_Run_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  $('a-project').value = 'Demo Project';
  resetRanges('a-i7', 'set1-1-1', 'set1-1-2');
  resetRanges('a-i5', 'set1-2-1', 'set1-2-2');
  const ids = [];
  for (let i = 1; i <= 8; i += 1) ids.push(`Demo-Reef-${p2(i)}_jgCO1`);
  for (let i = 1; i <= 8; i += 1) ids.push(`Demo-Sand-${p2(i)}_jgCO1`);
  setTextareaValue('a-ids', ids.join('\n'));
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

$('b-ids').addEventListener('input', () => refreshCount('b'));
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
      i7Ranges: readRanges('b-i7'),
      i5Ranges: readRanges('b-i5'),
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
  resetRanges('b-i7'); resetRanges('b-i5');
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
  resetRanges('b-i7', 'set1-1-1', 'set1-1-2');
  resetRanges('b-i5', 'set1-2-1', 'set1-2-2');
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
[['a-ids', 'a-ids-gutter'], ['b-ids', 'b-ids-gutter'], ['b-descs', 'b-descs-gutter']]
  .forEach(([t, g]) => attachGutter(t, g));
['a-i7', 'a-i5', 'b-i7', 'b-i5'].forEach((k) => resetRanges(k));
renderRows('a-tree', [], 'i100', false);
renderRows('b-tree', [], 'miseq', false);
refreshCount('a');
refreshCount('b');
setStatus('準備完了');
