/**
 * SampleSheet 作成ツール — ロジックコア
 *
 * MiSeq / i100 の GenerateFASTQ 用 SampleSheet CSV を生成する。
 * 依存なしの ES Module。ブラウザ / Node の両方から import 可能。
 */
import { UDI_INDEX, GROUP_SIZE, GROUP_COUNT } from './udi-data.js';

// ══ 既定値 ══
export const APP_TITLE = 'SampleSheet作成ツール（GenerateFASTQ）';
export const DEFAULTS = {
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

/** [Data] セクションのヘッダ（列順は固定） */
export const DATA_HEADER = [
  'Sample_ID', 'Sample_Name', 'Description',
  'I7_Index_ID', 'index', 'I5_Index_ID', 'index2', 'Sample_Project',
];

/** CSV の総列数（[Header] 等の行はこの列数までカンマで埋める） */
export const CSV_COLUMNS = DATA_HEADER.length;

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

// ══ set 指定のパース ══

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
 * set 指定文字列を展開して index の配列を返す。
 * 対応する記法:
 *   - 単独      : "set1-1-1"
 *   - 範囲      : "set1-1-1~set1-1-12" （~ ～ - all OK）、"set1-1-1-12" のような省略形も可
 *   - 複数指定  : カンマ / タブ / 空白 / 改行区切りで併記
 * @returns {{id:string, seq:string, label:string}[]}
 */
export function expandSetSpec(spec) {
  const text = String(spec).trim();
  if (text === '') return [];
  // 区切り: 改行・カンマ・タブ・全角読点・空白
  const tokens = text.split(/[\r\n,、\t ]+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const raw of tokens) {
    // 範囲記法（~ ～ .. の前後）
    const rangeParts = raw.split(/[~～]|\.\./).map((s) => s.trim()).filter(Boolean);
    if (rangeParts.length === 2) {
      const a = parseSetToken(rangeParts[0]);
      // 終端は "set1-1-12" でも "12" でも受け付ける
      const b = /^\d{1,2}$/.test(rangeParts[1])
        ? { ...a, group: Number(rangeParts[1]) }
        : parseSetToken(rangeParts[1]);
      if (a.set !== b.set || a.side !== b.side) {
        throw new Error(`範囲指定は同じセット・同じ側で指定してください: "${raw}"`);
      }
      if (b.group < a.group) throw new Error(`範囲の終端が開始より小さいです: "${raw}"`);
      if (b.group > GROUP_COUNT) throw new Error(`グループ番号は 1〜${GROUP_COUNT} です: "${raw}"`);
      for (let g = a.group; g <= b.group; g += 1) out.push(...groupIndexes(a.set, a.side, g));
      continue;
    }
    if (rangeParts.length > 2) throw new Error(`範囲指定が不正です: "${raw}"`);
    const one = parseSetToken(raw);
    out.push(...groupIndexes(one.set, one.side, one.group));
  }
  return out;
}

/** 指定グループ（8連1本）の index 8 件を返す */
export function groupIndexes(set, side, group) {
  const key = `set${set}-${side}`;
  const table = UDI_INDEX[key];
  if (!table) throw new Error(`未知のセットです: ${key}`);
  const arr = table[String(group)];
  if (!arr) throw new Error(`未知のグループです: ${key}-${group}`);
  return arr.map(([id, seq], i) => ({
    id, seq, label: `${key}-${group}-${i + 1}`,
  }));
}

// ══ 行のリスト入力 ══

/** 改行区切りのテキストを配列へ（末尾の空行のみ除去し、途中の空行は空文字として保持） */
export function splitRows(text) {
  const t = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (t === '') return [];
  return t.split('\n').map((s) => s.trim());
}

// ══ サンプル表の組み立て ══

/**
 * 入力から [Data] セクションの行配列を構築する。
 * @returns {{rows:Object[], warnings:string[]}}
 * @throws {Error} 件数不一致などの致命的エラー
 */
export function buildRows({ sampleIds, sampleNames, descriptions, i7Spec, i5Spec, sampleProject }) {
  const ids = splitRows(sampleIds).filter((s) => s !== '');
  if (!ids.length) throw new Error('Sample_ID を入力してください。');

  const names = splitRows(sampleNames);
  const descs = splitRows(descriptions);
  const i7 = expandSetSpec(i7Spec);
  const i5 = expandSetSpec(i5Spec);

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

  // Sample_ID の重複チェック
  const seen = new Map();
  ids.forEach((id, i) => {
    if (seen.has(id)) warnings.push(`Sample_ID の重複: "${id}"（行 ${seen.get(id) + 1} と ${i + 1}）`);
    else seen.set(id, i);
  });

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

  // index の組み合わせ重複チェック
  const combo = new Map();
  rows.forEach((r, i) => {
    const k = `${r.index}/${r.index2}`;
    if (combo.has(k)) warnings.push(`index の組み合わせが重複: ${k}（行 ${combo.get(k) + 1} と ${i + 1}）`);
    else combo.set(k, i);
  });

  return { rows, warnings };
}

// ══ CSV 生成 ══

/** CSV の 1 セル分のエスケープ */
function esc(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 指定セルを CSV_COLUMNS 列までカンマで埋めて 1 行にする */
function padLine(cells) {
  const a = cells.map(esc);
  while (a.length < CSV_COLUMNS) a.push('');
  return a.join(',');
}

/**
 * SampleSheet CSV 文字列を生成する。
 * @returns {string} CRLF 区切りの CSV
 */
export function buildCsv(params, rows) {
  const p = { ...DEFAULTS, ...params };
  const lines = [
    padLine(['[Header]']),
    padLine(['Experiment Name', p.experimentName ?? '']),
    padLine(['Date', p.date]),
    padLine(['Module', p.module]),
    padLine(['Workflow', p.workflow]),
    padLine(['Library Prep Kit', p.libraryPrepKit]),
    padLine(['Index Kit', p.indexKit]),
    padLine(['Description', p.description]),
    padLine(['Chemistry', p.chemistry]),
    padLine(['[Reads]']),
    ...p.reads.map((r) => padLine([r])),
    padLine(['[Settings]']),
    padLine(['adapter', p.adapter]),
    padLine(['AdvancedSetting1', p.advancedSetting1]),
    padLine(['[Data]']),
    DATA_HEADER.map(esc).join(','),
    ...rows.map((r) => DATA_HEADER.map((k) => esc(r[k])).join(',')),
  ];
  return lines.join('\r\n') + '\r\n';
}

/** 保存ファイル名: SampleSheet_YYYYMMDD.csv */
export function csvFileName(dateStr) {
  const m = String(dateStr).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return 'SampleSheet.csv';
  const p2 = (n) => String(n).padStart(2, '0');
  return `SampleSheet_${m[1]}${p2(m[2])}${p2(m[3])}.csv`;
}

// ══ 8連チューブ色分け（DNA希釈計算ツールと同じ規則）══
export const STRIP_SIZE = GROUP_SIZE;
export const STRIP_COLORS = ['#e3f2fd', '#fff9c4'];
export const WARN_COLOR = '#ffd6d6';

export function stripTag(rowIdx, useStrip) {
  if (useStrip) return `strip${Math.floor(rowIdx / STRIP_SIZE) % 2}`;
  return 'normal';
}
export function stripGroup(rowIdx) {
  return Math.floor(rowIdx / STRIP_SIZE) + 1;
}
