/**
 * SampleSheet 作成ツール — ロジックコア
 *
 * 対応機種（index はいずれも UDI index の set 指定）:
 *   - MiSeq i100 : SampleSheet v2 形式（FileFormatVersion 2 / 全行5列 /
 *                  [Header][Reads][BCLConvert_Settings][BCLConvert_Data]
 *                  [Cloud_Settings][Cloud_Data]）
 *   - NextSeq    : 従来形式・7列（[Data] に Sample_Name / Description あり、adapter 行なし）
 *   - MiSeq      : 従来形式・6列（[Data] に Sample_Name なし、Index Kit 行なし）
 *
 * 依存なしの ES Module。ブラウザ / Node の両方から import 可能。
 */
import { UDI_INDEX, GROUP_SIZE, GROUP_COUNT, SET_NUMBERS } from './udi-data.js';

export const APP_TITLE = 'SampleSheet作成ツール';

// ══ 既定値 ══

/** MiSeq i100（SampleSheet v2）用の既定値 */
export const DEFAULTS_I100 = {
  fileFormatVersion: '2',
  runName: 'Test Run',
  instrumentPlatform: 'MiSeqi100Series',
  indexOrientation: 'Forward',
  analysisLocation: 'Local',
  read1Cycles: '501',
  read2Cycles: '501',
  index1Cycles: '8',
  index2Cycles: '8',
  softwareVersion: '4.4.6',
  overrideCycles: '',              // 空欄ならサイクル数から自動生成
  fastqCompressionFormat: 'gzip',
  noLaneSplitting: 'TRUE',
  generateFastqcMetrics: 'TRUE',
  generatedVersion: '1.26.0.202606102337',
  projectName: 'Test Project',
  libraryPrepKitName: '',
  indexAdapterKitName: '',
};

/** NextSeq 用の既定値（runsheet_UTokyo の SampleSheet 準拠） */
export const DEFAULTS_NEXTSEQ = {
  experimentName: 'MIGrunxx',
  module: 'GenerateFASTQ - 3.1.0',
  workflow: 'GenerateFASTQ',
  libraryPrepKit: '',
  indexKit: '',
  description: '',
  chemistry: 'Amplicon',
  advancedSetting1: '123',
  reads: ['151', '151'],
};

/** MiSeq（従来機）用の既定値 */
export const DEFAULTS_MISEQ = {
  module: 'GenerateFASTQ - 2.0.0',
  workflow: 'GenerateFASTQ',
  libraryPrepKit: '',
  description: '',
  chemistry: 'Amplicon',
  adapter: 'CTGTCTCTTATACACATCT',
  advancedSetting1: '123',
  reads: ['301', '301'],
};

/** 機種一覧（UI のタブ順） */
export const MACHINES = ['i100', 'nextseq', 'miseq'];
export const MACHINE_LABEL = {
  i100: 'MiSeq i100',
  nextseq: 'NextSeq',
  miseq: 'MiSeq',
};

// ══ 列定義 ══

/** set名列のキー（CSV に出力するかは任意） */
export const SET_COLUMNS = ['Index1_Set', 'Index2_Set'];

/** MiSeq i100: CSV 全体の列数（v2 形式は 5 列で揃える） */
export const I100_COLUMNS = 5;

/** MiSeq i100: [BCLConvert_Data] / [Cloud_Data] のヘッダ */
export const BCL_HEADER = ['Sample_ID', 'Index', 'Index2'];
export const CLOUD_HEADER = [
  'Sample_ID', 'ProjectName', 'LibraryName', 'LibraryPrepKitName', 'IndexAdapterKitName',
];

/** NextSeq: [Data] のヘッダ（7列） */
export const DATA_HEADER_NEXTSEQ = [
  'Sample_ID', 'Sample_Name', 'Description', 'I7_Index_ID', 'index', 'I5_Index_ID', 'index2',
];

/** MiSeq（従来機）: [Data] のヘッダ（6列） */
export const DATA_HEADER_MISEQ = [
  'Sample_ID', 'Description', 'I7_Index_ID', 'index', 'I5_Index_ID', 'index2',
];

/** 機種ごとの基本データ列 */
function baseHeader(machine) {
  if (machine === 'miseq') return DATA_HEADER_MISEQ;
  if (machine === 'nextseq') return DATA_HEADER_NEXTSEQ;
  return BCL_HEADER;
}

/**
 * CSV 用のデータ列ヘッダを返す。
 * set名列は Index / index2 の直後に差し込む。
 */
export function dataHeader(machine, withSetNames) {
  const base = baseHeader(machine);
  if (!withSetNames) return [...base];
  const out = [];
  base.forEach((k) => {
    out.push(k);
    if (k === 'Index' || k === 'index') out.push('Index1_Set');
    if (k === 'Index2' || k === 'index2') out.push('Index2_Set');
  });
  return out;
}

/** 画面の結果表で表示するヘッダ（set名列を必ず含む） */
export function tableHeader(machine) {
  if (machine === 'i100') {
    return ['Sample_ID', 'Index', 'Index1_Set', 'Index2', 'Index2_Set', 'LibraryName'];
  }
  return dataHeader(machine, true);
}

// ══ 日付 ══

/** Date → "YYYY/M/D"（月日はゼロ埋めしない） */
export function formatDate(d) {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 日付入力の正規化。"2026/8/18" "2026-08-18" を受け付け "2026/8/18" を返す */
export function normalizeDate(text) {
  const t = String(text).trim();
  if (t === '') throw new Error('シーケンス日付を入力してください。');
  const m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) throw new Error(`日付は YYYY/M/D の形式で入力してください（入力値: ${t}）。`);
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, da);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) {
    throw new Error(`存在しない日付です（入力値: ${t}）。`);
  }
  return `${y}/${mo}/${da}`;
}

// ══ set 指定（UDI index）══

export { GROUP_SIZE, GROUP_COUNT, SET_NUMBERS };

const SET_RE = /^set([1-4])-([12])-(\d{1,2})$/i;

/** "set1-1-3" → {set:1, side:1, group:3} */
export function parseSetToken(token) {
  const t = String(token).trim();
  const m = t.match(SET_RE);
  if (!m) throw new Error(`set の指定形式が不正です: "${t}"（例: set1-1-1）`);
  const group = Number(m[3]);
  if (group < 1 || group > GROUP_COUNT) {
    throw new Error(`グループ番号は 1〜${GROUP_COUNT} です: "${t}"`);
  }
  return { set: Number(m[1]), side: Number(m[2]), group };
}

/**
 * i7 の set 名から、対になる i5 の set 名を返す。
 * 側(M)を 1 → 2 に入れ替えるだけで、セット番号とグループ番号は保つ。
 * 例: "set1-1-1" → "set1-2-1"
 * @returns {string|null} 変換できない場合は null
 */
export function pairedSetToken(token, targetSide = 2) {
  const t = String(token ?? '').trim();
  if (t === '') return null;
  const m = t.match(SET_RE);
  if (!m) return null;
  return `set${m[1]}-${targetSide}-${Number(m[3])}`;
}

/** 指定グループ（8連1本）の index 8 件を返す */
export function groupIndexes(set, side, group) {
  const key = `set${set}-${side}`;
  const table = UDI_INDEX[key];
  if (!table) throw new Error(`未知のセットです: ${key}`);
  const arr = table[String(group)];
  if (!arr) throw new Error(`未知のグループです: ${key}-${group}`);
  return arr.map(([id, seq], i) => ({
    id, seq, label: `${key}-${group}-${i + 1}`, groupLabel: `${key}-${group}`,
  }));
}

/** set をセット番号順・グループ順に並べたときの通し位置（0 始まり） */
export function setOrdinal({ set, group }) {
  return (set - 1) * GROUP_COUNT + (group - 1);
}
/** 通し位置から {set, group} に戻す */
export function ordinalToSet(ordinal) {
  return { set: Math.floor(ordinal / GROUP_COUNT) + 1, group: (ordinal % GROUP_COUNT) + 1 };
}
/** 収録されている全グループ数（4セット × 12グループ） */
export const TOTAL_GROUPS = SET_NUMBERS.length * GROUP_COUNT;

/**
 * 開始 set と終了 set からその範囲の index を展開する。
 * セットをまたぐ指定に対応（set1-1-12 の次は set2-1-1）。
 */
export function expandSetRange(startToken, endToken, labelForError = 'Index') {
  const s = String(startToken ?? '').trim();
  const e = String(endToken ?? '').trim();
  if (s === '') {
    if (e === '') return [];
    throw new Error(`${labelForError} の開始 set を入力してください。`);
  }
  const a = parseSetToken(s);
  let b;
  if (e === '') {
    b = a;
  } else if (/^\d{1,2}$/.test(e)) {
    const g = Number(e);
    if (g < 1 || g > GROUP_COUNT) throw new Error(`グループ番号は 1〜${GROUP_COUNT} です: "${e}"`);
    b = { ...a, group: g };
  } else {
    b = parseSetToken(e);
  }
  if (a.side !== b.side) {
    throw new Error(`${labelForError} の開始と終了は同じ側（i7 どうし / i5 どうし）で指定してください（${s} / ${e}）。`);
  }
  const from = setOrdinal(a);
  const to = setOrdinal(b);
  if (to < from) throw new Error(`${labelForError} の終了 set が開始より前です（${s} / ${e}）。`);
  const out = [];
  for (let o = from; o <= to; o += 1) {
    const { set, group } = ordinalToSet(o);
    out.push(...groupIndexes(set, a.side, group));
  }
  return out;
}

/** 複数の範囲ブロックをまとめて展開し、指定順に連結する */
export function expandSetRanges(ranges, labelForError = 'Index') {
  const list = (ranges ?? []).filter((r) => String(r.start ?? '').trim() !== ''
    || String(r.end ?? '').trim() !== '');
  if (!list.length) return { indexes: [], warnings: [] };
  const out = [];
  const seen = new Map();
  const warnings = [];
  list.forEach((r, bi) => {
    const part = expandSetRange(r.start, r.end, `${labelForError} の範囲${bi + 1}`);
    part.forEach((x) => {
      if (seen.has(x.id)) {
        throw new Error(`${labelForError} で index が重複しています: ${x.id}（範囲${seen.get(x.id) + 1} と 範囲${bi + 1}）。`);
      }
      seen.set(x.id, bi);
      out.push(x);
    });
  });
  if (list.length > 1) {
    warnings.push(`${labelForError} は ${list.length} 個の範囲を指定順に連結しました（計 ${out.length}件）。`);
  }
  return { indexes: out, warnings };
}

// ══ 行のリスト入力 ══

/** 改行区切りのテキストを配列へ（末尾の空行のみ除去） */
export function splitRows(text) {
  const t = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (t === '') return [];
  return t.split('\n').map((s) => s.trim());
}

// ══ サンプル名への接尾辞付与 ══

/** 指定行範囲の値の末尾に文字列を追加する */
export function appendSuffix(text, from, to, suffix) {
  const rows = splitRows(text);
  if (!rows.length) throw new Error('対象のリストが空です。');
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('行番号は整数で指定してください。');
  if (from < 1 || to < 1) throw new Error('行番号は 1 以上で指定してください。');
  if (from > to) throw new Error(`開始行が終了行より後になっています（${from} 〜 ${to}）。`);
  if (to > rows.length) throw new Error(`終了行がリストの行数 (${rows.length}) を超えています。`);
  if (suffix === '') throw new Error('追加する文字列を入力してください。');
  let count = 0;
  const out = rows.map((v, i) => {
    const n = i + 1;
    if (n >= from && n <= to && v !== '') { count += 1; return v + suffix; }
    return v;
  });
  return { text: out.join('\n'), count };
}

// ══ 範囲の正規化・index 解決 ══

/** 単一範囲と配列の両方の呼び出し方に対応する */
export function toRanges(ranges, start, end) {
  if (Array.isArray(ranges) && ranges.length) return ranges;
  if (String(start ?? '').trim() !== '' || String(end ?? '').trim() !== '') {
    return [{ start: start ?? '', end: end ?? '' }];
  }
  return [];
}

function resolveIndexes(ids, opts) {
  const r7 = toRanges(opts.i7Ranges, opts.i7Start, opts.i7End);
  const r5 = toRanges(opts.i5Ranges, opts.i5Start, opts.i5End);
  const a = expandSetRanges(r7, 'Index1 (i7)');
  const b = expandSetRanges(r5, 'Index2 (i5)');
  const i7 = a.indexes;
  const i5 = b.indexes;
  if (!i7.length) throw new Error('Index1 (i7) の set を指定してください。');
  if (!i5.length) throw new Error('Index2 (i5) の set を指定してください。');
  if (i7.length < ids.length) {
    throw new Error(`Index1 (i7) が不足しています（サンプル ${ids.length}件 に対し ${i7.length}件）。`);
  }
  if (i5.length < ids.length) {
    throw new Error(`Index2 (i5) が不足しています（サンプル ${ids.length}件 に対し ${i5.length}件）。`);
  }
  const warnings = [...a.warnings, ...b.warnings];
  if (i7.length > ids.length) warnings.push(`Index1 は ${i7.length - ids.length}件 余っています（先頭から順に割当）。`);
  if (i5.length > ids.length) warnings.push(`Index2 は ${i5.length - ids.length}件 余っています（先頭から順に割当）。`);
  return { i7, i5, warnings };
}

function checkDuplicateIds(ids, warnings) {
  const seen = new Map();
  ids.forEach((id, i) => {
    if (id === '') return;
    if (seen.has(id)) warnings.push(`Sample_ID の重複: "${id}"（行 ${seen.get(id) + 1} と ${i + 1}）`);
    else seen.set(id, i);
  });
}
function checkDuplicatePairs(rows, warnings, k1, k2) {
  const combo = new Map();
  rows.forEach((r, i) => {
    const k = `${r[k1]}/${r[k2]}`;
    if (combo.has(k)) warnings.push(`index の組み合わせが重複: ${k}（行 ${combo.get(k) + 1} と ${i + 1}）`);
    else combo.set(k, i);
  });
}

// ══ サンプル表の組み立て ══

/**
 * MiSeq i100（SampleSheet v2）用の行を構築する。
 * LibraryName は `Sample_ID_Index_Index2` で自動生成する。
 */
export function buildRowsI100(opts) {
  const ids = splitRows(opts.sampleIds).filter((s) => s !== '');
  if (!ids.length) throw new Error('Sample_ID を入力してください。');
  const { i7, i5, warnings } = resolveIndexes(ids, opts);
  const projectName = opts.projectName ?? DEFAULTS_I100.projectName;
  checkDuplicateIds(ids, warnings);

  const rows = ids.map((id, i) => ({
    Sample_ID: id,
    Index: i7[i].seq,
    Index1_Set: i7[i].label,
    Index2: i5[i].seq,
    Index2_Set: i5[i].label,
    ProjectName: projectName,
    LibraryName: `${id}_${i7[i].seq}_${i5[i].seq}`,
    LibraryPrepKitName: opts.libraryPrepKitName ?? '',
    IndexAdapterKitName: opts.indexAdapterKitName ?? '',
    I7_Index_ID: i7[i].id,
    I5_Index_ID: i5[i].id,
  }));
  checkDuplicatePairs(rows, warnings, 'Index', 'Index2');
  return { rows, warnings };
}

/**
 * NextSeq 用の行を構築する（[Data] 7列）。
 * Sample_ID を空欄にしたテンプレート的な使い方にも対応するため、
 * Sample_ID が未入力でも index の件数だけ行を生成できる（`rowCount` 指定）。
 */
export function buildRowsNextSeq(opts) {
  const rawIds = splitRows(opts.sampleIds);
  const ids = rawIds.filter((s) => s !== '');
  const rowCount = Number(opts.rowCount ?? 0);
  const count = ids.length || rowCount;
  if (!count) throw new Error('Sample_ID を入力してください。');

  const names = splitRows(opts.sampleNames);
  const descs = splitRows(opts.descriptions);
  const list = ids.length ? ids : Array.from({ length: count }, () => '');
  const { i7, i5, warnings } = resolveIndexes(list, opts);

  if (ids.length && descs.length && descs.length !== ids.length) {
    throw new Error(`Sample_ID (${ids.length}行) と Description (${descs.length}行) の行数が不一致。`);
  }
  checkDuplicateIds(list, warnings);

  const rows = list.map((id, i) => ({
    Sample_ID: id,
    Sample_Name: names[i] !== undefined && names[i] !== '' ? names[i] : id,
    Description: descs[i] ?? (descs.length === 1 ? descs[0] : ''),
    I7_Index_ID: i7[i].id,
    index: i7[i].seq,
    Index1_Set: i7[i].label,
    I5_Index_ID: i5[i].id,
    index2: i5[i].seq,
    Index2_Set: i5[i].label,
  }));
  checkDuplicatePairs(rows, warnings, 'index', 'index2');
  return { rows, warnings };
}

/** MiSeq（従来機）用の行を構築する（[Data] 6列） */
export function buildRowsMiSeq(opts) {
  const ids = splitRows(opts.sampleIds).filter((s) => s !== '');
  if (!ids.length) throw new Error('Sample_ID を入力してください。');
  const descs = splitRows(opts.descriptions);
  const { i7, i5, warnings } = resolveIndexes(ids, opts);
  if (descs.length && descs.length !== ids.length) {
    throw new Error(`Sample_ID (${ids.length}行) と Description (${descs.length}行) の行数が不一致。`);
  }
  checkDuplicateIds(ids, warnings);

  const rows = ids.map((id, i) => ({
    Sample_ID: id,
    Description: descs[i] ?? '',
    I7_Index_ID: i7[i].id,
    index: i7[i].seq,
    Index1_Set: i7[i].label,
    I5_Index_ID: i5[i].id,
    index2: i5[i].seq,
    Index2_Set: i5[i].label,
  }));
  checkDuplicatePairs(rows, warnings, 'index', 'index2');
  return { rows, warnings };
}

/** 機種に応じた行構築（共通入口） */
export function buildRows(machine, opts) {
  if (machine === 'i100') return buildRowsI100(opts);
  if (machine === 'nextseq') return buildRowsNextSeq(opts);
  return buildRowsMiSeq(opts);
}

// ══ CSV 生成 ══

function esc(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function padLine(cells, columns) {
  const a = cells.map(esc);
  while (a.length < columns) a.push('');
  return a.join(',');
}

/** OverrideCycles をサイクル数から自動生成する */
export function makeOverrideCycles(p) {
  return `R1:Y${p.read1Cycles};I1:I${p.index1Cycles};I2:I${p.index2Cycles};R2:Y${p.read2Cycles}`;
}

/** MiSeq i100 用 SampleSheet CSV（v2 形式・全行 5 列） */
export function buildCsvI100(params, rows, withSetNames = false) {
  const p = { ...DEFAULTS_I100, ...params };
  const n = I100_COLUMNS;
  const blank = padLine([], n);
  const bclHeader = dataHeader('i100', withSetNames);
  const override = String(p.overrideCycles ?? '').trim() || makeOverrideCycles(p);
  const lines = [
    padLine(['[Header]'], n),
    padLine(['FileFormatVersion', p.fileFormatVersion], n),
    padLine(['RunName', p.runName], n),
    padLine(['InstrumentPlatform', p.instrumentPlatform], n),
    padLine(['IndexOrientation', p.indexOrientation], n),
    padLine(['AnalysisLocation', p.analysisLocation], n),
    blank,
    padLine(['[Reads]'], n),
    padLine(['Read1Cycles', p.read1Cycles], n),
    padLine(['Read2Cycles', p.read2Cycles], n),
    padLine(['Index1Cycles', p.index1Cycles], n),
    padLine(['Index2Cycles', p.index2Cycles], n),
    blank,
    padLine(['[BCLConvert_Settings]'], n),
    padLine(['SoftwareVersion', p.softwareVersion], n),
    padLine(['OverrideCycles', override], n),
    padLine(['FastqCompressionFormat', p.fastqCompressionFormat], n),
    padLine(['NoLaneSplitting', p.noLaneSplitting], n),
    padLine(['GenerateFastqcMetrics', p.generateFastqcMetrics], n),
    blank,
    padLine(['[BCLConvert_Data]'], n),
    padLine(bclHeader, n),
    ...rows.map((r) => padLine(bclHeader.map((k) => r[k]), n)),
    blank,
    padLine(['[Cloud_Settings]'], n),
    padLine(['GeneratedVersion', p.generatedVersion], n),
    blank,
    padLine(['[Cloud_Data]'], n),
    padLine(CLOUD_HEADER, n),
    ...rows.map((r) => padLine(CLOUD_HEADER.map((k) => r[k]), n)),
  ];
  return lines.join('\r\n') + '\r\n';
}

/** NextSeq 用 SampleSheet CSV（7列・[Settings] は AdvancedSetting1 のみ） */
export function buildCsvNextSeq(params, rows, withSetNames = false) {
  const p = { ...DEFAULTS_NEXTSEQ, ...params };
  const header = dataHeader('nextseq', withSetNames);
  const n = header.length;
  const blank = padLine([], n);
  const lines = [
    padLine(['[Header]'], n),
    padLine(['Experiment Name', p.experimentName], n),
    padLine(['Date', p.date ?? ''], n),
    padLine(['Module', p.module], n),
    padLine(['Workflow', p.workflow], n),
    padLine(['Library Prep Kit', p.libraryPrepKit], n),
    padLine(['Index Kit', p.indexKit], n),
    padLine(['Description', p.description], n),
    padLine(['Chemistry', p.chemistry], n),
    padLine(['[Reads]'], n),
    ...p.reads.map((r) => padLine([r], n)),
    blank,
    padLine(['[Settings]'], n),
    padLine(['AdvancedSetting1', p.advancedSetting1], n),
    blank,
    padLine(['[Data]'], n),
    header.map(esc).join(','),
    ...rows.map((r) => header.map((k) => esc(r[k])).join(',')),
  ];
  return lines.join('\r\n') + '\r\n';
}

/** MiSeq（従来機）用 SampleSheet CSV（6列・Index Kit 行なし） */
export function buildCsvMiSeq(params, rows, withSetNames = false) {
  const p = { ...DEFAULTS_MISEQ, ...params };
  const header = dataHeader('miseq', withSetNames);
  const n = header.length;
  const lines = [
    padLine(['[Header]'], n),
    padLine(['Experiment Name', p.experimentName ?? ''], n),
    padLine(['Date', p.date ?? ''], n),
    padLine(['Module', p.module], n),
    padLine(['Workflow', p.workflow], n),
    padLine(['Library Prep Kit', p.libraryPrepKit], n),
    padLine(['Description', p.description], n),
    padLine(['Chemistry', p.chemistry], n),
    padLine(['[Reads]'], n),
    ...p.reads.map((r) => padLine([r], n)),
    padLine(['[Settings]'], n),
    padLine(['adapter', p.adapter], n),
    padLine(['AdvancedSetting1', p.advancedSetting1], n),
    padLine(['[Data]'], n),
    header.map(esc).join(','),
    ...rows.map((r) => header.map((k) => esc(r[k])).join(',')),
  ];
  return lines.join('\r\n') + '\r\n';
}

/** 機種に応じた CSV 生成（共通入口） */
export function buildCsv(machine, params, rows, withSetNames = false) {
  if (machine === 'i100') return buildCsvI100(params, rows, withSetNames);
  if (machine === 'nextseq') return buildCsvNextSeq(params, rows, withSetNames);
  return buildCsvMiSeq(params, rows, withSetNames);
}

/** 保存ファイル名 */
export function csvFileName(key, machine) {
  const safe = String(key ?? '').trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
  if (machine === 'i100') return safe ? `SampleSheet_${safe}.csv` : 'SampleSheet.csv';
  const tag = machine === 'nextseq' ? 'NextSeq' : 'MiSeq';
  const m = String(key ?? '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const p2 = (x) => String(x).padStart(2, '0');
    return `SampleSheet_${tag}_${m[1]}${p2(m[2])}${p2(m[3])}.csv`;
  }
  return safe ? `SampleSheet_${tag}_${safe}.csv` : `SampleSheet_${tag}.csv`;
}

// ══ 384サンプルのデモテンプレート ══

/** デモ用の仮想サンプル ID を生成する（4プレート × 96） */
export function demoSampleIds(count = 384) {
  const plates = ['A', 'B', 'C', 'D'];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const plate = plates[Math.floor(i / 96) % plates.length];
    const well = (i % 96) + 1;
    out.push(`Demo-${plate}${String(well).padStart(2, '0')}`);
  }
  return out;
}

/** デモ用の Description */
export function demoDescriptions(count = 384) {
  const kinds = ['Reef water', 'Sediment', 'Coral polyp', 'Tank water'];
  return Array.from({ length: count }, (_, i) => `${kinds[Math.floor(i / 96) % kinds.length]} (demo)`);
}

/**
 * 384サンプルのデモ用サンプルシート CSV を生成する。
 * index は set1-1-1〜set4-1-12（i7 384件）と set1-2-1〜set4-2-12（i5 384件）を使用する。
 * @param {'i100'|'nextseq'|'miseq'} machine
 * @param {boolean} withSetNames set名列を含めるか
 */
export function buildTemplateCsv(machine, withSetNames = false, count = 384) {
  const ids = demoSampleIds(count);
  const descs = demoDescriptions(count);
  const opts = {
    sampleIds: ids.join('\n'),
    sampleNames: '',
    descriptions: descs.join('\n'),
    i7Ranges: [{ start: 'set1-1-1', end: 'set4-1-12' }],
    i5Ranges: [{ start: 'set1-2-1', end: 'set4-2-12' }],
  };
  const { rows } = buildRows(machine, opts);
  const today = formatDate(new Date());
  const params = machine === 'i100'
    ? { runName: `Demo_Template_${count}` }
    : { experimentName: `Demo_Template_${count}`, date: today, description: 'Demo template' };
  return { csv: buildCsv(machine, params, rows, withSetNames), rows, count: rows.length };
}

/** テンプレートの保存ファイル名 */
export function templateFileName(machine, count = 384) {
  return `SampleSheet_Template_${MACHINE_LABEL[machine].replace(/\s+/g, '-')}_${count}samples.csv`;
}

// ══ index 一覧の CSV 出力 ══

/** index 一覧（全768件）を CSV 文字列で返す */
export function buildIndexListCsv() {
  const header = ['Set', 'Side', 'Side_Label', 'Group', 'Well', 'Set_Name', 'Index_ID', 'Index_Sequence'];
  const lines = [header.join(',')];
  SET_NUMBERS.forEach((set) => {
    [1, 2].forEach((side) => {
      for (let g = 1; g <= GROUP_COUNT; g += 1) {
        groupIndexes(set, side, g).forEach((x, i) => {
          lines.push([
            `set${set}`, side, side === 1 ? 'Index1 (i7)' : 'Index2 (i5)',
            g, i + 1, x.label, x.id, x.seq,
          ].map(esc).join(','));
        });
      }
    });
  });
  return lines.join('\r\n') + '\r\n';
}

/** index 一覧（指定セット・指定側のみ）を CSV 文字列で返す */
export function buildIndexListCsvFor(set, side) {
  const header = ['Set_Name', 'Group', 'Well', 'Index_ID', 'Index_Sequence'];
  const lines = [header.join(',')];
  for (let g = 1; g <= GROUP_COUNT; g += 1) {
    groupIndexes(set, side, g).forEach((x, i) => {
      lines.push([x.label, g, i + 1, x.id, x.seq].map(esc).join(','));
    });
  }
  return lines.join('\r\n') + '\r\n';
}
