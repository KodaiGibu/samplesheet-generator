/**
 * SampleSheet 作成ツール — UI レイヤー
 *
 * タブ:
 *   MiSeq i100 … SampleSheet v2（全行5列）
 *   NextSeq    … 従来形式・7列
 *   MiSeq      … 従来形式・6列
 *   index 一覧 … 収録 index の参照と CSV 出力
 *
 * Index の set 指定は「プルダウンで選択」「手動入力」の2モードを切り替えられる。
 */
import {
  APP_TITLE, DEFAULTS_I100, DEFAULTS_NEXTSEQ, DEFAULTS_MISEQ,
  MACHINES, MACHINE_LABEL, SET_COLUMNS,
  normalizeDate, expandSetRanges, groupIndexes, splitRows, appendSuffix,
  pairedSetToken, setOptions, isValidSetToken,
  buildRows, buildCsv, csvFileName, dataHeader, tableHeader,
  buildTemplateCsv, templateFileName, buildIndexListCsv, buildIndexListCsvFor,
} from './sheet.js';

const $ = (id) => document.getElementById(id);

/** 機種 → UI の接頭辞 */
const PREFIX = { i100: 'a', nextseq: 'b', miseq: 'c' };

/** 接尾辞付与の対象列（機種ごと） */
const SUFFIX_TARGETS = {
  i100: { ids: 'a-ids' },
  nextseq: { names: 'b-names', ids: 'b-ids', descs: 'b-descs' },
  miseq: { ids: 'c-ids', descs: 'c-descs' },
};

/** プルダウン用の set 一覧（起動時に一度だけ構築） */
const SET_OPTIONS = { 1: setOptions(1), 2: setOptions(2) };

const app = {
  mode: 'i100',
  /** 機種ごとの Index 入力方法: 'select' | 'manual' */
  inputMode: { i100: 'select', nextseq: 'select', miseq: 'select' },
  state: {
    i100: { rows: [], params: null, baseline: {} },
    nextseq: { rows: [], params: null, baseline: {}, namesTouched: false },
    miseq: { rows: [], params: null, baseline: {} },
  },
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
function attachGutter(taId, gutterId) {
  const ta = $(taId);
  const gutter = $(gutterId);
  if (!ta || !gutter) return;
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
function setTextareaValue(id, value) {
  const ta = $(id);
  if (!ta) return;
  ta.value = value;
  if (ta._renderGutter) ta._renderGutter();
}

// ══ タブ切替 ══
document.querySelectorAll('.mode-nb > .nb-tabs .nb-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    app.mode = btn.dataset.mode;
    document.querySelectorAll('.mode-nb > .nb-tabs .nb-tab')
      .forEach((b) => b.classList.toggle('active', b === btn));
    ['i100', 'nextseq', 'miseq', 'index'].forEach((m) => {
      $(`page-${m}`).classList.toggle('hidden', app.mode !== m);
    });
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
    if (['Sample_ID', 'Sample_Name', 'LibraryName'].includes(k)) th.classList.add('w-id');
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

// ══════════ Index 範囲ブロック ══════════

/** 行の入力要素（プルダウン / テキスト）から現在値を読む */
function readCell(row, which) {
  const sel = row.querySelector(`.r-${which}-sel`);
  const txt = row.querySelector(`.r-${which}-txt`);
  return (txt.classList.contains('hidden') ? sel.value : txt.value) ?? '';
}
/** 行の入力要素に値を書く（両方の UI を同期させる） */
function writeCell(row, which, value, markAuto = false) {
  const sel = row.querySelector(`.r-${which}-sel`);
  const txt = row.querySelector(`.r-${which}-txt`);
  txt.value = value;
  // プルダウンに該当項目があれば選択、なければ空（手動値）に寄せる
  sel.value = [...sel.options].some((o) => o.value === value) ? value : '';
  if (markAuto) { txt.dataset.auto = '1'; sel.dataset.auto = '1'; }
  else { delete txt.dataset.auto; delete sel.dataset.auto; }
  row.classList.toggle('auto-filled', markAuto);
}
/** 行が自動入力値のままかどうか */
function isAuto(row, which) {
  return row.querySelector(`.r-${which}-txt`).dataset.auto === '1';
}

/** 範囲ブロックの入力値を配列で取得する（例: readRanges('a-i7')） */
function readRanges(key) {
  return [...$(`${key}-rows`).querySelectorAll('.range-row')].map((row) => ({
    start: readCell(row, 'start'),
    end: readCell(row, 'end'),
  }));
}

/** set プルダウンを構築する */
function buildSetSelect(side, isEnd) {
  const sel = document.createElement('select');
  sel.className = isEnd ? 'r-end-sel' : 'r-start-sel';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = isEnd ? '（開始のみ・8 index）' : '（未選択）';
  sel.appendChild(blank);
  SET_OPTIONS[side].forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
  return sel;
}

/** 入力方法（プルダウン / 手動）を行に反映する */
function applyInputMode(row, mode) {
  ['start', 'end'].forEach((which) => {
    const sel = row.querySelector(`.r-${which}-sel`);
    const txt = row.querySelector(`.r-${which}-txt`);
    sel.classList.toggle('hidden', mode !== 'select');
    txt.classList.toggle('hidden', mode === 'select');
  });
}

/** 機種の全行に入力方法を反映する */
function applyInputModeAll(prefix, mode) {
  ['i7', 'i5'].forEach((side) => {
    $(`${prefix}-${side}-rows`).querySelectorAll('.range-row')
      .forEach((row) => applyInputMode(row, mode));
  });
}

/** 対応する i5 の行を取得（同じ並び順の n 番目） */
function i5RowAt(prefix, idx) {
  return $(`${prefix}-i5-rows`).querySelectorAll('.range-row')[idx] ?? null;
}

/**
 * Index1 の入力に応じて Index2 を自動入力する。
 * 未入力または直前の自動入力値のままの場合のみ上書きし、手修正した値は保持する。
 */
function autoFillIndex2(prefix, rowIdx) {
  if (!$(`${prefix}-autopair`).checked) return;
  const i7Row = $(`${prefix}-i7-rows`).querySelectorAll('.range-row')[rowIdx];
  if (!i7Row) return;
  let i5Row = i5RowAt(prefix, rowIdx);
  if (!i5Row) {
    addRangeRow(`${prefix}-i5`);
    i5Row = i5RowAt(prefix, rowIdx);
    if (!i5Row) return;
  }
  ['start', 'end'].forEach((which) => {
    const src = readCell(i7Row, which).trim();
    const dst = readCell(i5Row, which).trim();
    if (src === '') {
      if (isAuto(i5Row, which)) writeCell(i5Row, which, '');
      return;
    }
    const paired = pairedSetToken(src);
    if (paired === null) return;
    if (dst === '' || isAuto(i5Row, which)) writeCell(i5Row, which, paired, true);
  });
}

/** 範囲ブロックを1行追加する */
function addRangeRow(key, start = '', end = '') {
  const rows = $(`${key}-rows`);
  const prefix = key.slice(0, 1);
  const machine = MACHINES.find((m) => PREFIX[m] === prefix);
  const isI7 = key.endsWith('i7');
  const side = isI7 ? 1 : 2;

  const row = document.createElement('div');
  row.className = 'range-row';
  row.innerHTML = `
    <span class="r-no"></span>
    <span class="r-field"><span class="r-cap">開始 set:</span></span>
    <span class="r-field"><span class="r-cap">終了 set:</span></span>
    <span class="r-info"></span>
    <button type="button" class="mini danger r-del" title="この範囲を削除">×</button>`;

  const fields = row.querySelectorAll('.r-field');
  [['start', false], ['end', true]].forEach(([which, isEnd], i) => {
    const sel = buildSetSelect(side, isEnd);
    const txt = document.createElement('input');
    txt.type = 'text';
    txt.className = `r-${which}-txt`;
    txt.size = 12;
    txt.placeholder = isEnd ? `set1-${side}-12` : `set1-${side}-1`;
    fields[i].append(sel, txt);
  });

  rows.appendChild(row);
  writeCell(row, 'start', start);
  writeCell(row, 'end', end);
  applyInputMode(row, app.inputMode[machine]);

  const onChange = (el) => {
    // 手で操作されたら自動入力マークを外す
    delete el.dataset.auto;
    row.classList.remove('auto-filled');
    // プルダウンとテキストを同期
    if (el.classList.contains('r-start-sel')) row.querySelector('.r-start-txt').value = el.value;
    if (el.classList.contains('r-end-sel')) row.querySelector('.r-end-txt').value = el.value;
    if (el.classList.contains('r-start-txt')) {
      const sel = row.querySelector('.r-start-sel');
      sel.value = [...sel.options].some((o) => o.value === el.value) ? el.value : '';
    }
    if (el.classList.contains('r-end-txt')) {
      const sel = row.querySelector('.r-end-sel');
      sel.value = [...sel.options].some((o) => o.value === el.value) ? el.value : '';
    }
    if (isI7) {
      const idx = [...rows.querySelectorAll('.range-row')].indexOf(row);
      autoFillIndex2(prefix, idx);
    }
    refreshCount(prefix);
  };
  row.querySelectorAll('select, input[type=text]').forEach((el) => {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => onChange(el));
  });
  row.querySelector('.r-del').addEventListener('click', () => {
    if (rows.querySelectorAll('.range-row').length <= 1) {
      writeCell(row, 'start', ''); writeCell(row, 'end', '');
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
    const start = readCell(row, 'start').trim();
    const end = readCell(row, 'end').trim();
    if (start === '' && end === '') { info.textContent = ''; info.classList.remove('bad'); return; }
    try {
      info.textContent = `${expandSetRanges([{ start, end }], label).indexes.length} index`;
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

// ══ 既定値の適用 ══
function applyDefaults(machine) {
  const p = PREFIX[machine];
  if (machine === 'i100') {
    const d = DEFAULTS_I100;
    $(`${p}-runname`).value = d.runName;
    $(`${p}-ffv`).value = d.fileFormatVersion;
    $(`${p}-platform`).value = d.instrumentPlatform;
    $(`${p}-orientation`).value = d.indexOrientation;
    $(`${p}-analysis`).value = d.analysisLocation;
    $(`${p}-read1`).value = d.read1Cycles;
    $(`${p}-read2`).value = d.read2Cycles;
    $(`${p}-idx1cyc`).value = d.index1Cycles;
    $(`${p}-idx2cyc`).value = d.index2Cycles;
    $(`${p}-swver`).value = d.softwareVersion;
    $(`${p}-fastqfmt`).value = d.fastqCompressionFormat;
    $(`${p}-nolane`).value = d.noLaneSplitting;
    $(`${p}-fastqc`).value = d.generateFastqcMetrics;
    $(`${p}-override`).value = d.overrideCycles;
    $(`${p}-genver`).value = d.generatedVersion;
    $(`${p}-project`).value = d.projectName;
    $(`${p}-prepkit`).value = d.libraryPrepKitName;
    $(`${p}-adapterkit`).value = d.indexAdapterKitName;
    return;
  }
  const d = machine === 'nextseq' ? DEFAULTS_NEXTSEQ : DEFAULTS_MISEQ;
  $(`${p}-exp`).value = d.experimentName ?? '';
  $(`${p}-module`).value = d.module;
  $(`${p}-workflow`).value = d.workflow;
  $(`${p}-prep`).value = d.libraryPrepKit;
  $(`${p}-desc`).value = d.description;
  $(`${p}-chem`).value = d.chemistry;
  $(`${p}-adv`).value = d.advancedSetting1;
  $(`${p}-read1`).value = d.reads[0];
  $(`${p}-read2`).value = d.reads[1];
  if (machine === 'nextseq') $(`${p}-indexkit`).value = d.indexKit;
  if (machine === 'miseq') $(`${p}-adapter`).value = d.adapter;
}

/** 入力欄から [Header] 等のパラメータを集める */
function collectParams(machine) {
  const p = PREFIX[machine];
  if (machine === 'i100') {
    return {
      runName: $(`${p}-runname`).value.trim(),
      fileFormatVersion: $(`${p}-ffv`).value.trim(),
      instrumentPlatform: $(`${p}-platform`).value.trim(),
      indexOrientation: $(`${p}-orientation`).value,
      analysisLocation: $(`${p}-analysis`).value,
      read1Cycles: $(`${p}-read1`).value.trim(),
      read2Cycles: $(`${p}-read2`).value.trim(),
      index1Cycles: $(`${p}-idx1cyc`).value.trim(),
      index2Cycles: $(`${p}-idx2cyc`).value.trim(),
      softwareVersion: $(`${p}-swver`).value.trim(),
      overrideCycles: $(`${p}-override`).value.trim(),
      fastqCompressionFormat: $(`${p}-fastqfmt`).value.trim(),
      noLaneSplitting: $(`${p}-nolane`).value,
      generateFastqcMetrics: $(`${p}-fastqc`).value,
      generatedVersion: $(`${p}-genver`).value.trim(),
    };
  }
  const params = {
    experimentName: $(`${p}-exp`).value.trim(),
    date: $(`${p}-date`).value.trim() === '' ? '' : normalizeDate($(`${p}-date`).value),
    module: $(`${p}-module`).value,
    workflow: $(`${p}-workflow`).value,
    libraryPrepKit: $(`${p}-prep`).value,
    description: $(`${p}-desc`).value,
    chemistry: $(`${p}-chem`).value,
    advancedSetting1: $(`${p}-adv`).value,
    reads: [$(`${p}-read1`).value.trim(), $(`${p}-read2`).value.trim()].filter((s) => s !== ''),
  };
  if (machine === 'nextseq') params.indexKit = $(`${p}-indexkit`).value;
  if (machine === 'miseq') params.adapter = $(`${p}-adapter`).value;
  return params;
}

/** 入力欄から行構築用のオプションを集める */
function collectRowOpts(machine) {
  const p = PREFIX[machine];
  const base = {
    sampleIds: $(`${p}-ids`).value,
    i7Ranges: readRanges(`${p}-i7`),
    i5Ranges: readRanges(`${p}-i5`),
  };
  if (machine === 'i100') {
    return {
      ...base,
      projectName: $(`${p}-project`).value,
      libraryPrepKitName: $(`${p}-prepkit`).value,
      indexAdapterKitName: $(`${p}-adapterkit`).value,
    };
  }
  if (machine === 'nextseq') {
    return { ...base, sampleNames: $(`${p}-names`).value, descriptions: $(`${p}-descs`).value };
  }
  return { ...base, descriptions: $(`${p}-descs`).value };
}

/** CSV のファイル名キー（i100 は RunName、他は日付） */
function fileKey(machine, params) {
  return machine === 'i100' ? params.runName : (params.date || params.experimentName);
}

// ══ 機種ごとのイベント登録 ══
MACHINES.forEach((machine) => {
  const p = PREFIX[machine];
  const st = app.state[machine];

  // 入力方法の切替（プルダウン / 手動）
  document.querySelectorAll(`input[name="${p}-mode"]`).forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      app.inputMode[machine] = radio.value;
      applyInputModeAll(p, radio.value);
      const manualOnly = readRanges(`${p}-i7`).concat(readRanges(`${p}-i5`))
        .some((r) => (r.start && !isValidSetToken(r.start)) || (r.end && !isValidSetToken(r.end)
          && !/^\d{1,2}$/.test(r.end)));
      setStatus(radio.value === 'select'
        ? `Index の入力方法: プルダウン選択${manualOnly ? '（プルダウンにない値はテキスト側に保持されています）' : ''}`
        : 'Index の入力方法: 手動入力（番号だけの省略指定も使えます）');
    });
  });

  $(`${p}-reset`).addEventListener('click', () => {
    applyDefaults(machine);
    setStatus(`${MACHINE_LABEL[machine]}: 既定値に戻しました`);
  });
  $(`${p}-ids`).addEventListener('input', () => refreshCount(p));
  $(`${p}-autopair`).addEventListener('change', () => {
    if (!$(`${p}-autopair`).checked) { setStatus('Index2 の自動入力を OFF にしました'); return; }
    const n = $(`${p}-i7-rows`).querySelectorAll('.range-row').length;
    for (let i = 0; i < n; i += 1) autoFillIndex2(p, i);
    refreshCount(p);
    setStatus('Index2 の自動入力を ON にしました（Index1 の set に対応する i5 を補完します）');
  });

  // NextSeq: Sample_Name の自動追従
  if (machine === 'nextseq') {
    $(`${p}-names`).addEventListener('input', () => { st.namesTouched = true; });
    $(`${p}-ids`).addEventListener('input', () => {
      if (!st.namesTouched || $(`${p}-names`).value.trim() === '') {
        setTextareaValue(`${p}-names`, $(`${p}-ids`).value);
      }
    });
    $(`${p}-copy-names`).addEventListener('click', () => {
      setTextareaValue(`${p}-names`, $(`${p}-ids`).value);
      st.namesTouched = false;
      delete st.baseline[`${p}-names`];
      setStatus('Sample_ID を Sample_Name に反映しました');
    });
  }
  // Description の一括入力
  if (machine !== 'i100') {
    $(`${p}-fill-desc`).addEventListener('click', async () => {
      const ids = splitRows($(`${p}-ids`).value).filter((s) => s !== '');
      if (!ids.length) { await showMessage('データなし', 'さきに Sample_ID を入力してください。'); return; }
      const first = splitRows($(`${p}-descs`).value).filter((s) => s !== '')[0] ?? '';
      const val = window.prompt('全行に入力する Description を指定してください。', first);
      if (val === null) return;
      setTextareaValue(`${p}-descs`, ids.map(() => val).join('\n'));
      setStatus(`Description を ${ids.length} 行に一括入力しました`);
    });
  }

  // 接尾辞の付与・復元
  $(`${p}-suffix-apply`).addEventListener('click', async () => {
    const elId = SUFFIX_TARGETS[machine][$(`${p}-suffix-target`).value];
    try {
      const before = $(elId).value;
      const r = appendSuffix(before, Number($(`${p}-suffix-from`).value),
        Number($(`${p}-suffix-to`).value), $(`${p}-suffix-text`).value);
      if (st.baseline[elId] === undefined) st.baseline[elId] = before;
      setTextareaValue(elId, r.text);
      setStatus(`${$(`${p}-suffix-target`).selectedOptions[0].textContent.trim()} の ` +
        `行 ${$(`${p}-suffix-from`).value}〜${$(`${p}-suffix-to`).value} に ` +
        `"${$(`${p}-suffix-text`).value}" を追加しました（${r.count}行）`);
    } catch (e) { await showMessage('入力エラー', e.message); }
  });
  $(`${p}-suffix-undo`).addEventListener('click', async () => {
    const elId = SUFFIX_TARGETS[machine][$(`${p}-suffix-target`).value];
    if (st.baseline[elId] === undefined) {
      await showMessage('取り消し不可', '文字列追加の履歴がありません。');
      return;
    }
    setTextareaValue(elId, st.baseline[elId]);
    delete st.baseline[elId];
    setStatus('文字列追加前の状態に戻しました');
  });

  // set名列の切り替え
  $(`${p}-with-set`).addEventListener('change', () => {
    if (st.rows.length) renderRows(`${p}-tree`, st.rows, machine, $(`${p}-with-set`).checked);
    setStatus($(`${p}-with-set`).checked
      ? 'set名列をCSVに出力します（Index1_Set / Index2_Set）'
      : 'set名列は画面表示のみでCSVには出力しません');
  });

  // シート作成
  $(`${p}-build`).addEventListener('click', async () => {
    let params;
    try { params = collectParams(machine); }
    catch (e) { await showMessage('入力エラー', e.message); return; }
    if (machine === 'i100' && params.runName === '') {
      await showMessage('入力エラー', 'RunName を入力してください。'); return;
    }
    let result;
    try { result = buildRows(machine, collectRowOpts(machine)); }
    catch (e) { await showMessage('入力エラー', e.message); return; }

    st.rows = result.rows;
    st.params = params;
    renderRows(`${p}-tree`, result.rows, machine, $(`${p}-with-set`).checked);
    renderWarnings(`${p}-warn`, result.warnings);
    setStatus(`[${MACHINE_LABEL[machine]}] シート作成完了: ${result.rows.length}件 | ` +
      `${result.rows[0].Index1_Set} 〜 ${result.rows[result.rows.length - 1].Index1_Set} | ` +
      `確認事項 ${result.warnings.length}件`);
  });

  // クリア
  $(`${p}-clear`).addEventListener('click', () => {
    Object.values(SUFFIX_TARGETS[machine]).forEach((id) => setTextareaValue(id, ''));
    setTextareaValue(`${p}-ids`, '');
    resetRanges(`${p}-i7`); resetRanges(`${p}-i5`);
    st.rows = []; st.params = null; st.baseline = {};
    if (machine === 'nextseq') st.namesTouched = false;
    renderRows(`${p}-tree`, [], machine, $(`${p}-with-set`).checked);
    renderWarnings(`${p}-warn`, []); refreshCount(p);
    setStatus('クリアしました');
  });

  const ensureBuilt = () => {
    if (!st.rows.length || !st.params) {
      showMessage('データなし', 'さきに「シート作成」を実行してください。'); return false;
    }
    return true;
  };

  $(`${p}-csv`).addEventListener('click', async () => {
    if (!ensureBuilt()) return;
    const withSet = $(`${p}-with-set`).checked;
    const name = csvFileName(fileKey(machine, st.params), machine);
    downloadFile(name, buildCsv(machine, st.params, st.rows, withSet), 'text/csv;charset=utf-8');
    await showMessage('完了', `CSVを保存しました。\n${name}\n` +
      `${MACHINE_LABEL[machine]} 形式（set名列: ${withSet ? 'あり' : 'なし'}）`);
  });
  $(`${p}-clip`).addEventListener('click', async () => {
    if (!ensureBuilt()) return;
    await copyText(buildCsv(machine, st.params, st.rows, $(`${p}-with-set`).checked));
    setStatus(`クリップボードにコピーしました（${st.rows.length}件, CSV全文）`);
  });
  $(`${p}-preview`).addEventListener('click', () => {
    if (!ensureBuilt()) return;
    $('preview-body').textContent = buildCsv(machine, st.params, st.rows, $(`${p}-with-set`).checked);
    $('dlg-preview').showModal();
  });

  // 384サンプルのテンプレート出力
  $(`${p}-template`).addEventListener('click', async () => {
    const withSet = $(`${p}-with-set`).checked;
    const { csv, count } = buildTemplateCsv(machine, withSet);
    const name = templateFileName(machine, count);
    downloadFile(name, csv, 'text/csv;charset=utf-8');
    setStatus(`[${MACHINE_LABEL[machine]}] 384サンプルのテンプレートを出力しました（${name}）`);
    await showMessage('テンプレート出力',
      `384サンプルのデモデータを記載したサンプルシートを保存しました。\n${name}\n\n` +
      `index: set1-1-1〜set4-1-12（i7 384件） / set1-2-1〜set4-2-12（i5 384件）\n` +
      `列数: ${dataHeader(machine, withSet).length}（set名列: ${withSet ? 'あり' : 'なし'}）`);
  });

  // テストデータ入力
  $(`${p}-demo`).addEventListener('click', () => {
    const d = new Date();
    const p2 = (x) => String(x).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
    if (machine === 'i100') {
      $(`${p}-runname`).value = `Demo_Run_${stamp}`;
      $(`${p}-project`).value = 'Demo Project';
    } else {
      $(`${p}-exp`).value = `Demo_Run_${stamp}`;
      $(`${p}-date`).value = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }
    resetRanges(`${p}-i7`, 'set1-1-1', 'set1-1-2');
    resetRanges(`${p}-i5`, 'set1-2-1', 'set1-2-2');
    const ids = []; const descs = [];
    for (let i = 1; i <= 8; i += 1) { ids.push(`Demo-Reef-${p2(i)}`); descs.push('Reef water (demo)'); }
    for (let i = 1; i <= 8; i += 1) { ids.push(`Demo-Sand-${p2(i)}`); descs.push('Sediment (demo)'); }
    setTextareaValue(`${p}-ids`, ids.join('\n'));
    if (machine === 'nextseq') {
      setTextareaValue(`${p}-names`, ids.join('\n'));
      st.namesTouched = false;
    }
    if (machine !== 'i100') setTextareaValue(`${p}-descs`, descs.join('\n'));
    st.baseline = {};
    refreshCount(p);
    setStatus('テストデータ（仮想サンプル16件）を入力しました。「シート作成」を押してください');
  });
});

$('preview-close').addEventListener('click', () => $('dlg-preview').close());

// ══ index 一覧タブ ══
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

$('ref-csv-one').addEventListener('click', async () => {
  const set = Number($('ref-set').value);
  const side = Number($('ref-side').value);
  const name = `UDI_index_set${set}_${side === 1 ? 'i7' : 'i5'}.csv`;
  downloadFile(name, buildIndexListCsvFor(set, side), 'text/csv;charset=utf-8');
  setStatus(`index 一覧を出力しました（set${set} / ${side === 1 ? 'i7' : 'i5'}・96件）`);
  await showMessage('完了', `index 一覧を保存しました。\n${name}\n96 件`);
});
$('ref-csv-all').addEventListener('click', async () => {
  const name = 'UDI_index_all_768.csv';
  downloadFile(name, buildIndexListCsv(), 'text/csv;charset=utf-8');
  setStatus('全 index（768件）の一覧を出力しました');
  await showMessage('完了', `全 index の一覧を保存しました。\n${name}\n768 件（4セット × i7/i5 × 96）`);
});

// ══ 初期化 ══
document.title = APP_TITLE;
MACHINES.forEach((machine) => {
  applyDefaults(machine);
  const p = PREFIX[machine];
  resetRanges(`${p}-i7`); resetRanges(`${p}-i5`);
  renderRows(`${p}-tree`, [], machine, false);
});
[['a-ids', 'a-ids-gutter'],
  ['b-ids', 'b-ids-gutter'], ['b-names', 'b-names-gutter'], ['b-descs', 'b-descs-gutter'],
  ['c-ids', 'c-ids-gutter'], ['c-descs', 'c-descs-gutter']].forEach(([t, g]) => attachGutter(t, g));
Object.values(PREFIX).forEach((p) => refreshCount(p));
setStatus('準備完了');
