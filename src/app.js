/**
 * SampleSheet 作成ツール — UI レイヤー
 * 画面構成・配色は DNA希釈計算ツール（MiSeq用）v2.2 Web版に準拠。
 */
import {
  APP_TITLE, DEFAULTS, DATA_HEADER,
  normalizeDate, expandSetSpec, buildRows, buildCsv, csvFileName,
  splitRows, stripTag, stripGroup, groupIndexes,
} from './sheet.js';

const $ = (id) => document.getElementById(id);

const app = {
  mode: 'input',
  rows: [],
  params: null,
};

// ══ messagebox 相当 ══
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
    $('page-input').classList.toggle('hidden', app.mode !== 'input');
    $('page-index').classList.toggle('hidden', app.mode !== 'index');
    if (app.mode === 'index') renderRefTable();
  });
});

// ══ [Header] / [Settings] の既定値 ══
function applyHeaderDefaults() {
  $('h-module').value = DEFAULTS.module;
  $('h-workflow').value = DEFAULTS.workflow;
  $('h-prep').value = DEFAULTS.libraryPrepKit;
  $('h-indexkit').value = DEFAULTS.indexKit;
  $('h-desc').value = DEFAULTS.description;
  $('h-chem').value = DEFAULTS.chemistry;
  $('s-adapter').value = DEFAULTS.adapter;
  $('s-adv').value = DEFAULTS.advancedSetting1;
  $('h-read1').value = DEFAULTS.reads[0];
  $('h-read2').value = DEFAULTS.reads[1];
  $('d-project').value = DEFAULTS.sampleProject;
}
$('btn-reset-header').addEventListener('click', () => {
  applyHeaderDefaults();
  setStatus('[Header] / [Settings] を既定値に戻しました');
});

// ══ index 指定のライブ検証 ══
function refreshIndexCount() {
  const el = $('idx-count');
  try {
    const n7 = expandSetSpec($('idx-i7').value).length;
    const n5 = expandSetSpec($('idx-i5').value).length;
    const nId = splitRows($('d-ids').value).filter((s) => s !== '').length;
    el.classList.remove('bad');
    el.textContent = `i7: ${n7} 件 / i5: ${n5} 件 / Sample_ID: ${nId} 件`;
    if (nId && (n7 < nId || n5 < nId)) el.classList.add('bad');
  } catch (e) {
    el.classList.add('bad');
    el.textContent = e.message;
  }
}
['idx-i7', 'idx-i5', 'd-ids'].forEach((id) => {
  $(id).addEventListener('input', refreshIndexCount);
});

// ══ Sample_Name の自動反映 ══
// Sample_ID 入力時に、Sample_Name が未編集（空 or 直前のIDと一致）なら追従させる。
let namesTouched = false;
$('d-names').addEventListener('input', () => { namesTouched = true; });
$('d-ids').addEventListener('input', () => {
  if (!namesTouched || $('d-names').value.trim() === '') {
    $('d-names').value = $('d-ids').value;
  }
});
$('btn-copy-names').addEventListener('click', () => {
  $('d-names').value = $('d-ids').value;
  namesTouched = false;
  setStatus('Sample_ID を Sample_Name に反映しました（この後 個別に修正できます）');
});
$('btn-fill-desc').addEventListener('click', async () => {
  const ids = splitRows($('d-ids').value).filter((s) => s !== '');
  if (!ids.length) { await showMessage('データなし', 'さきに Sample_ID を入力してください。'); return; }
  const first = splitRows($('d-desc').value).filter((s) => s !== '')[0] ?? '';
  const val = window.prompt('全行に入力する Description を指定してください。', first);
  if (val === null) return;
  $('d-desc').value = ids.map(() => val).join('\n');
  setStatus(`Description を ${ids.length} 行に一括入力しました`);
});

// ══ シート作成 ══
function collectParams() {
  return {
    date: normalizeDate($('h-date').value),
    experimentName: $('h-exp').value.trim(),
    module: $('h-module').value,
    workflow: $('h-workflow').value,
    libraryPrepKit: $('h-prep').value,
    indexKit: $('h-indexkit').value,
    description: $('h-desc').value,
    chemistry: $('h-chem').value,
    adapter: $('s-adapter').value,
    advancedSetting1: $('s-adv').value,
    reads: [$('h-read1').value.trim(), $('h-read2').value.trim()].filter((s) => s !== ''),
  };
}
$('btn-build').addEventListener('click', async () => {
  let params;
  try { params = collectParams(); }
  catch (e) { await showMessage('入力エラー', e.message); return; }

  let result;
  try {
    result = buildRows({
      sampleIds: $('d-ids').value,
      sampleNames: $('d-names').value,
      descriptions: $('d-desc').value,
      i7Spec: $('idx-i7').value,
      i5Spec: $('idx-i5').value,
      sampleProject: $('d-project').value,
    });
  } catch (e) { await showMessage('入力エラー', e.message); return; }

  app.rows = result.rows;
  app.params = params;
  renderTable();
  renderWarnings(result.warnings);
  setStatus(`シート作成完了: ${app.rows.length}件 | Date ${params.date} | ` +
            `${params.workflow} | Reads ${params.reads.join('/')} | 警告 ${result.warnings.length}件`);
});

$('btn-clear').addEventListener('click', () => {
  ['d-ids', 'd-names', 'd-desc'].forEach((id) => { $(id).value = ''; });
  $('idx-i7').value = ''; $('idx-i5').value = '';
  namesTouched = false;
  app.rows = []; app.params = null;
  renderTable(); renderWarnings([]); refreshIndexCount();
  setStatus('クリアしました');
});

$('opt-strip').addEventListener('change', renderTable);

// ══ 結果テーブル ══
function renderTable() {
  const tbody = $('data-tree').querySelector('tbody');
  tbody.innerHTML = '';
  const useStrip = $('opt-strip').checked;
  app.rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.className = stripTag(i, useStrip);
    const cells = [String(i + 1), ...DATA_HEADER.map((k) => r[k])];
    cells.forEach((v, ci) => {
      const td = document.createElement('td');
      td.textContent = v;
      if (ci === 0) td.className = 'num';
      else if (ci <= 3) td.className = 'left';
      tr.appendChild(td);
    });
    if (useStrip) tr.title = `8連グループ ${stripGroup(i)}`;
    tbody.appendChild(tr);
  });
}

function renderWarnings(warnings) {
  const box = $('warn-box');
  box.innerHTML = '';
  if (!warnings.length) { box.classList.add('hidden'); return; }
  const h = document.createElement('b');
  h.textContent = `確認事項 ${warnings.length}件`;
  box.appendChild(h);
  const ul = document.createElement('ul');
  warnings.forEach((w) => {
    const li = document.createElement('li');
    li.textContent = w;
    ul.appendChild(li);
  });
  box.appendChild(ul);
  box.classList.remove('hidden');
}

// ══ 出力 ══
function ensureBuilt() {
  if (!app.rows.length || !app.params) { showMessage('データなし', 'さきに「シート作成」を実行してください。'); return false; }
  return true;
}
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('btn-csv').addEventListener('click', async () => {
  if (!ensureBuilt()) return;
  const csv = buildCsv(app.params, app.rows);
  const name = csvFileName(app.params.date);
  // SampleSheet は装置側が読み取るため BOM は付けない
  downloadFile(name, csv, 'text/csv;charset=utf-8');
  await showMessage('完了', `CSVを保存しました。\n${name}`);
});

$('btn-clip').addEventListener('click', async () => {
  if (!ensureBuilt()) return;
  const csv = buildCsv(app.params, app.rows);
  try {
    await navigator.clipboard.writeText(csv);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = csv; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  setStatus(`クリップボードにコピーしました（${app.rows.length}件, CSV全文）`);
});

const dlgPreview = $('dlg-preview');
$('btn-preview').addEventListener('click', () => {
  if (!ensureBuilt()) return;
  $('preview-body').textContent = buildCsv(app.params, app.rows);
  dlgPreview.showModal();
});
$('preview-close').addEventListener('click', () => dlgPreview.close());

// ══ UDI index 一覧タブ ══
function renderRefTable() {
  const set = Number($('ref-set').value);
  const side = Number($('ref-side').value);
  const tbody = $('ref-tree').querySelector('tbody');
  tbody.innerHTML = '';
  for (let g = 1; g <= 12; g += 1) {
    groupIndexes(set, side, g).forEach((x, i) => {
      const tr = document.createElement('tr');
      tr.className = `strip${(g - 1) % 2}`;
      [i === 0 ? `set${set}-${side}-${g}` : '', String(i + 1), x.id, x.seq].forEach((v, ci) => {
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
$('ref-set').addEventListener('change', renderRefTable);
$('ref-side').addEventListener('change', renderRefTable);

// ══ テストデータ ══
$('btn-demo').addEventListener('click', () => {
  const today = new Date();
  $('h-date').value = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
  $('idx-i7').value = 'set1-1-1~set1-1-12';
  $('idx-i5').value = 'set1-2-1~set1-2-12';
  const ids = ['JUN2024-1-0_0_jgCO1', 'JUN2024-1-1_50-1_jgCO1', 'JUN2024-1-1_50-2_jgCO1',
    'JUN2024-1-2_150-1_jgCO1', 'JUN2024-1-2_150-2_jgCO1', 'JUN2024-1-3_250_jgCO1',
    'JUN2024-1-4_350_jgCO1', 'JUN2024-1-5_450_jgCO1', 'JUN2024-1-6_550-1_jgCO1',
    'JUN2024-1-6_550-2_jgCO1'];
  $('d-ids').value = ids.join('\n');
  $('d-names').value = ids.join('\n');
  $('d-desc').value = ids.map(() => 'Okinawa coast water').join('\n');
  namesTouched = false;
  refreshIndexCount();
  setStatus('テストデータを入力しました（「シート作成」を押してください）');
});

// ══ 初期化 ══
document.title = APP_TITLE;
applyHeaderDefaults();
refreshIndexCount();
setStatus('準備完了');
