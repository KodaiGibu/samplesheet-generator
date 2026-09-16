/**
 * SampleSheet 作成ツール — ロジックコア
 *
 * 対応機種:
 *   - MiSeq i100 : UDI index（set 指定）、[Data] 8列
 *   - MiSeq      : Nextera index（N7xx / S5xx）、[Data] 6列
 *
 * 依存なしの ES Module。ブラウザ / Node の両方から import 可能。
 */
import { UDI_INDEX, GROUP_SIZE, GROUP_COUNT } from './udi-data.js';
import { NEXTERA_I7, NEXTERA_I5, nexteraPos } from './nextera-data.js';

export const APP_TITLE = 'SampleSheet作成ツール（GenerateFASTQ）';

// ══ 既定値 ══

/** MiSeq i100 用の既定値 */
export const DEFAULTS_I100 = {
  module: 'GenerateFASTQ - 3.1.0',
  workflow: 'GenerateFASTQ',
  libraryPrepKit: '',
  indexKit: '',
  description: '',
  chemistry: 'Amplicon',
  adapter: 'CTGTCTCTTATACACATCT',
  advancedSetting1: '123',
  sampleProject: '',
  reads: ['301', '301'],
};

/** MiSeq（従来機）用の既定値。i100 を基準に、Module のみ従来機の値とする */
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

/** [Data] のヘッダ（機種ごとに列構成が異なる） */
export const DATA_HEADER_I100 = [
  'Sample_ID', 'Sample_Name', 'Description',
  'I7_Index_ID', 'index', 'I5_Index_ID', 'index2', 'Sample_Project',
];
export const DATA_HEADER_MISEQ = [
  'Sample_ID', 'Description', 'I7_Index_ID', 'index', 'I5_Index_ID', 'index2',
];

export { GROUP_SIZE, GROUP_COUNT, NEXTERA_I7, NEXTERA_I5 };

// ══ 日付 ══

/** Date → "YYYY/M/D"（月日はゼロ埋めしない） */
export function formatDate(d) {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 日付入力の正規化。"2026/8/18" "2026-08-18" "2026/08/18" を受け付け "2026/8/18" を返す。
 * @throws {Error} 形式不正・存在しない日付
 */
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

// ══ set 指定（MiSeq i100）══

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

/** 指定グループ（8連1本）の index 8 件を返す */
export function groupIndexes(set, side, group) {
  const key = `set${set}-${side}`;
  const table = UDI_INDEX[key];
  if (!table) throw new Error(`未知のセットです: ${key}`);
  const arr = table[String(group)];
  if (!arr) throw new Error(`未知のグループです: ${key}-${group}`);
  return arr.map(([id, seq], i) => ({ id, seq, label: `${key}-${group}-${i + 1}` }));
}

/**
 * 開始 set と終了 set を別々に受け取り、その範囲の index を展開する。
 * 終了側は "set1-1-12" でも "12" でも可。終了が空なら開始のみ（8件）。
 * @param {string} startToken 例 "set1-1-1"
 * @param {string} endToken   例 "set1-1-12" / "12" / ""
 * @returns {{id:string, seq:string, label:string}[]}
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
  if (a.set !== b.set || a.side !== b.side) {
    throw new Error(`${labelForError} の開始と終了は同じセット・同じ側で指定してください（${s} / ${e}）。`);
  }
  if (b.group < a.group) {
    throw new Error(`${labelForError} の終了 set が開始より前です（${s} / ${e}）。`);
  }
  const out = [];
  for (let g = a.group; g <= b.group; g += 1) out.push(...groupIndexes(a.set, a.side, g));
  return out;
}

// ══ 行のリスト入力 ══

/** 改行区切りのテキストを配列へ（末尾の空行のみ除去） */
export function splitRows(text) {
  const t = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (t === '') return [];
  return t.split('\n').map((s) => s.trim());
}

// ══ サンプル名への接尾辞付与 ══

/**
 * 指定行範囲の値の末尾に文字列を追加する。
 * @param {string} text   改行区切りのリスト
 * @param {number} from   開始行（1始まり・含む）
 * @param {number} to     終了行（1始まり・含む）
 * @param {string} suffix 追加する文字列
 * @returns {{text:string, count:number}}
 */
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

// ══ サンプル表の組み立て（MiSeq i100）══

/**
 * @returns {{rows:Object[], warnings:string[]}}
 * @throws {Error}
 */
export function buildRowsI100({
  sampleIds, sampleNames, descriptions,
  i7Start, i7End, i5Start, i5End, sampleProject,
}) {
  const ids = splitRows(sampleIds).filter((s) => s !== '');
  if (!ids.length) throw new Error('Sample_ID を入力してください。');

  const names = splitRows(sampleNames);
  const descs = splitRows(descriptions);
  const i7 = expandSetRange(i7Start, i7End, 'Index1 (i7)');
  const i5 = expandSetRange(i5Start, i5End, 'Index2 (i5)');

  if (!i7.length) throw new Error('Index1 (i7) の set を指定してください。');
  if (!i5.length) throw new Error('Index2 (i5) の set を指定してください。');
  if (i7.length < ids.length) {
    throw new Error(`Index1 (i7) が不足しています（サンプル ${ids.length}件 に対し ${i7.length}件）。`);
  }
  if (i5.length < ids.length) {
    throw new Error(`Index2 (i5) が不足しています（サンプル ${ids.length}件 に対し ${i5.length}件）。`);
  }
  if (descs.length && descs.length !== ids.length) {
    throw new Error(`Sample_ID (${ids.length}行) と Description (${descs.length}行) の行数が不一致。`);
  }

  const warnings = [];
  if (i7.length > ids.length) warnings.push(`Index1 は ${i7.length - ids.length}件 余っています（先頭から順に割当）。`);
  if (i5.length > ids.length) warnings.push(`Index2 は ${i5.length - ids.length}件 余っています（先頭から順に割当）。`);
  checkDuplicateIds(ids, warnings);

  const rows = ids.map((id, i) => ({
    Sample_ID: id,
    Sample_Name: names[i] !== undefined && names[i] !== '' ? names[i] : id,
    Description: descs[i] ?? '',
    I7_Index_ID: i7[i].id,
    index: i7[i].seq,
    I5_Index_ID: i5[i].id,
    index2: i5[i].seq,
    Sample_Project: sampleProject ?? '',
  }));
  checkDuplicateIndexPairs(rows, warnings);
  return { rows, warnings };
}

// ══ サンプル表の組み立て（MiSeq / Nextera）══

/**
 * Nextera index の割当。
 *   I7 を開始位置から終了位置まで巡回し、1巡するごとに I5 を次へ送る。
 * @returns {{rows:Object[], warnings:string[]}}
 */
export function buildRowsMiSeq({
  sampleIds, descriptions, i7Start, i7End, i5Start, i5End,
}) {
  const ids = splitRows(sampleIds).filter((s) => s !== '');
  if (!ids.length) throw new Error('Sample_ID を入力してください。');
  const descs = splitRows(descriptions);
  if (descs.length && descs.length !== ids.length) {
    throw new Error(`Sample_ID (${ids.length}行) と Description (${descs.length}行) の行数が不一致。`);
  }

  const i7 = sliceNextera(NEXTERA_I7, i7Start, i7End, 'Index1 (i7)');
  const i5 = sliceNextera(NEXTERA_I5, i5Start, i5End, 'Index2 (i5)');
  const capacity = i7.length * i5.length;
  if (ids.length > capacity) {
    throw new Error(`index の組み合わせが不足しています（サンプル ${ids.length}件 に対し ` +
      `i7 ${i7.length}件 × i5 ${i5.length}件 = ${capacity}通り）。`);
  }

  const warnings = [];
  if (capacity > ids.length) {
    warnings.push(`index の組み合わせは ${capacity - ids.length}通り 余っています（i7 を巡回し i5 を送る順で割当）。`);
  }
  checkDuplicateIds(ids, warnings);

  const rows = ids.map((id, i) => {
    const a = i7[i % i7.length];
    const b = i5[Math.floor(i / i7.length)];
    return {
      Sample_ID: id,
      Description: descs[i] ?? '',
      I7_Index_ID: a[0],
      index: a[1],
      I5_Index_ID: b[0],
      index2: b[1],
    };
  });
  checkDuplicateIndexPairs(rows, warnings);
  return { rows, warnings };
}

/** Nextera リストを ID の範囲で切り出す */
export function sliceNextera(list, startId, endId, label) {
  const s = String(startId ?? '').trim();
  const e = String(endId ?? '').trim();
  const from = s === '' ? 0 : nexteraPos(list, s);
  if (from < 0) throw new Error(`${label} の開始 ID が見つかりません: "${s}"`);
  const to = e === '' ? list.length - 1 : nexteraPos(list, e);
  if (to < 0) throw new Error(`${label} の終了 ID が見つかりません: "${e}"`);
  if (to < from) throw new Error(`${label} の終了 ID が開始より前です（${s} / ${e}）。`);
  return list.slice(from, to + 1);
}

// ══ 共通チェック ══

function checkDuplicateIds(ids, warnings) {
  const seen = new Map();
  ids.forEach((id, i) => {
    if (seen.has(id)) warnings.push(`Sample_ID の重複: "${id}"（行 ${seen.get(id) + 1} と ${i + 1}）`);
    else seen.set(id, i);
  });
}
function checkDuplicateIndexPairs(rows, warnings) {
  const combo = new Map();
  rows.forEach((r, i) => {
    const k = `${r.index}/${r.index2}`;
    if (combo.has(k)) warnings.push(`index の組み合わせが重複: ${k}（行 ${combo.get(k) + 1} と ${i + 1}）`);
    else combo.set(k, i);
  });
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

/** MiSeq i100 用 SampleSheet CSV（[Data] 8列・Index Kit 行あり） */
export function buildCsvI100(params, rows) {
  const p = { ...DEFAULTS_I100, ...params };
  const n = DATA_HEADER_I100.length;
  const lines = [
    padLine(['[Header]'], n),
    padLine(['Experiment Name', p.experimentName ?? ''], n),
    padLine(['Date', p.date], n),
    padLine(['Module', p.module], n),
    padLine(['Workflow', p.workflow], n),
    padLine(['Library Prep Kit', p.libraryPrepKit], n),
    padLine(['Index Kit', p.indexKit], n),
    padLine(['Description', p.description], n),
    padLine(['Chemistry', p.chemistry], n),
    padLine(['[Reads]'], n),
    ...p.reads.map((r) => padLine([r], n)),
    padLine(['[Settings]'], n),
    padLine(['adapter', p.adapter], n),
    padLine(['AdvancedSetting1', p.advancedSetting1], n),
    padLine(['[Data]'], n),
    DATA_HEADER_I100.map(esc).join(','),
    ...rows.map((r) => DATA_HEADER_I100.map((k) => esc(r[k])).join(',')),
  ];
  return lines.join('\r\n') + '\r\n';
}

/** MiSeq（従来機）用 SampleSheet CSV（[Data] 6列・Index Kit 行なし） */
export function buildCsvMiSeq(params, rows) {
  const p = { ...DEFAULTS_MISEQ, ...params };
  const n = DATA_HEADER_MISEQ.length;
  const lines = [
    padLine(['[Header]'], n),
    padLine(['Experiment Name', p.experimentName ?? ''], n),
    padLine(['Date', p.date], n),
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
    DATA_HEADER_MISEQ.map(esc).join(','),
    ...rows.map((r) => DATA_HEADER_MISEQ.map((k) => esc(r[k])).join(',')),
  ];
  return lines.join('\r\n') + '\r\n';
}

/** 保存ファイル名 */
export function csvFileName(dateStr, machine) {
  const tag = machine === 'miseq' ? 'MiSeq' : 'MiSeq-i100';
  const m = String(dateStr).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return `SampleSheet_${tag}.csv`;
  const p2 = (x) => String(x).padStart(2, '0');
  return `SampleSheet_${tag}_${m[1]}${p2(m[2])}${p2(m[3])}.csv`;
}
