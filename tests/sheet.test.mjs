/**
 * SampleSheet 作成ツール — ロジック検証
 * 実行: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDate, parseSetToken, expandSetRange, groupIndexes,
  buildRowsI100, buildRowsMiSeq, buildCsvI100, buildCsvMiSeq,
  csvFileName, splitRows, appendSuffix, dataHeader, tableHeader,
  DATA_HEADER_I100, DATA_HEADER_MISEQ,
} from '../src/sheet.js';
import { UDI_INDEX } from '../src/udi-data.js';

const I100_ARGS = {
  sampleNames: '', descriptions: '',
  i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '', sampleProject: '',
};

// ══ UDI データ ══
test('UDIデータ: 4セット×2側×12グループ×8件', () => {
  const keys = Object.keys(UDI_INDEX);
  assert.equal(keys.length, 8);
  for (const k of keys) {
    assert.equal(Object.keys(UDI_INDEX[k]).length, 12);
    for (let g = 1; g <= 12; g += 1) assert.equal(UDI_INDEX[k][String(g)].length, 8);
  }
});

test('開始/終了を別指定した set 範囲の展開（仕様の例）', () => {
  const i7 = expandSetRange('set1-1-1', 'set1-1-12');
  const i5 = expandSetRange('set1-2-1', 'set1-2-12');
  assert.equal(i7.length, 96);
  assert.equal(i5.length, 96);
  assert.deepEqual([i7[0].id, i7[0].seq], ['S762', 'TTACCGAC']);
  assert.deepEqual([i7[95].id, i7[95].seq], ['S733', 'CCACAACA']);
  assert.deepEqual([i5[0].id, i5[0].seq], ['S512', 'CGAATACG']);
  assert.deepEqual([i5[95].id, i5[95].seq], ['S561', 'GTACCACA']);
});

test('set 範囲: 終了の省略形・終了空欄', () => {
  assert.equal(expandSetRange('set1-1-1', '12').length, 96);
  assert.equal(expandSetRange('set1-1-1', '').length, 8);
  assert.equal(expandSetRange('', '').length, 0);
  assert.equal(expandSetRange('set2-1-3', 'set2-1-5').length, 24);
});

test('set 範囲: 異常系', () => {
  assert.throws(() => expandSetRange('set5-1-1', ''), /指定形式が不正/);
  assert.throws(() => expandSetRange('set1-1-13', ''), /グループ番号は 1〜12/);
  assert.throws(() => expandSetRange('set1-1-3', 'set1-1-1'), /終了 set が開始より前/);
  assert.throws(() => expandSetRange('set1-1-1', 'set1-2-3'), /同じセット・同じ側/);
  assert.throws(() => expandSetRange('', 'set1-1-3'), /開始 set を入力/);
  assert.throws(() => parseSetToken('set1-1'), /指定形式が不正/);
});

test('groupIndexes は set名ラベル付きで8件返す', () => {
  const g = groupIndexes(1, 1, 3);
  assert.equal(g.length, 8);
  assert.equal(g[0].label, 'set1-1-3-1');
  assert.equal(g[7].label, 'set1-1-3-8');
  assert.equal(g[0].groupLabel, 'set1-1-3');
});

// ══ 列定義 ══
test('dataHeader: set名列の有無を切り替えられる', () => {
  assert.deepEqual(dataHeader('i100', false), DATA_HEADER_I100);
  assert.deepEqual(dataHeader('miseq', false), DATA_HEADER_MISEQ);
  assert.deepEqual(dataHeader('i100', true), [
    'Sample_ID', 'Sample_Name', 'Description',
    'I7_Index_ID', 'index', 'Index1_Set', 'I5_Index_ID', 'index2', 'Index2_Set', 'Sample_Project',
  ]);
  assert.deepEqual(dataHeader('miseq', true), [
    'Sample_ID', 'Description',
    'I7_Index_ID', 'index', 'Index1_Set', 'I5_Index_ID', 'index2', 'Index2_Set',
  ]);
  assert.deepEqual(tableHeader('i100'), dataHeader('i100', true));
});

// ══ 日付 ══
test('日付の正規化', () => {
  assert.equal(normalizeDate('2026/8/18'), '2026/8/18');
  assert.equal(normalizeDate('2026-08-18'), '2026/8/18');
  assert.throws(() => normalizeDate(''), /シーケンス日付を入力/);
  assert.throws(() => normalizeDate('2026.8.18'), /YYYY\/M\/D/);
  assert.throws(() => normalizeDate('2026/2/30'), /存在しない日付/);
});

// ══ 接尾辞付与 ══
test('指定範囲のサンプル名末尾に文字列を追加', () => {
  const src = 'A\nB\nC\nD\nE';
  const r = appendSuffix(src, 2, 4, '_16S');
  assert.equal(r.text, 'A\nB_16S\nC_16S\nD_16S\nE');
  assert.equal(r.count, 3);
  assert.equal(appendSuffix(src, 1, 5, '_x').count, 5);
});

test('接尾辞付与: 複数回適用してもベースラインは不変', () => {
  const base = 'A\nB\nC';
  const step1 = appendSuffix(base, 1, 2, '_16S').text;
  const step2 = appendSuffix(step1, 3, 3, '_ITS').text;
  assert.equal(step2, 'A_16S\nB_16S\nC_ITS');
  // UI は base を保持し、「元に戻す」で一括復元する
  assert.equal(base, 'A\nB\nC');
});

test('接尾辞付与: 異常系', () => {
  assert.throws(() => appendSuffix('', 1, 1, '_x'), /リストが空/);
  assert.throws(() => appendSuffix('A\nB', 2, 1, '_x'), /開始行が終了行より後/);
  assert.throws(() => appendSuffix('A\nB', 1, 5, '_x'), /行数 \(2\) を超えて/);
  assert.throws(() => appendSuffix('A\nB', 0, 1, '_x'), /1 以上/);
  assert.throws(() => appendSuffix('A\nB', 1, 2, ''), /追加する文字列を入力/);
});

// ══ MiSeq i100 ══
test('i100: Sample_Name は未入力なら Sample_ID を反映、個別修正は優先', () => {
  const { rows } = buildRowsI100({ ...I100_ARGS, sampleIds: 'A\nB\nC', sampleNames: 'A\nB_mod\n' });
  assert.equal(rows[0].Sample_Name, 'A');
  assert.equal(rows[1].Sample_Name, 'B_mod');
  assert.equal(rows[2].Sample_Name, 'C');
});

test('i100: index 割当と set名が付与される', () => {
  const { rows } = buildRowsI100({ ...I100_ARGS, sampleIds: 'S1\nS2', descriptions: 'w1\nw2' });
  assert.deepEqual([rows[0].I7_Index_ID, rows[0].index], ['S762', 'TTACCGAC']);
  assert.deepEqual([rows[0].I5_Index_ID, rows[0].index2], ['S512', 'CGAATACG']);
  assert.equal(rows[0].Index1_Set, 'set1-1-1-1');
  assert.equal(rows[0].Index2_Set, 'set1-2-1-1');
  assert.equal(rows[1].Index1_Set, 'set1-1-1-2');
});

test('i100: 行数不一致・index不足はエラー、余剰は警告', () => {
  assert.throws(() => buildRowsI100({ ...I100_ARGS, sampleIds: 'S1\nS2', descriptions: 'only one' }),
    /行数が不一致/);
  const many = Array.from({ length: 9 }, (_, i) => `S${i + 1}`).join('\n');
  assert.throws(() => buildRowsI100({ ...I100_ARGS, sampleIds: many }), /Index1 \(i7\) が不足/);
  const { warnings } = buildRowsI100({ ...I100_ARGS, sampleIds: 'S1' });
  assert.ok(warnings.some((w) => /Index1 は 7件 余って/.test(w)));
});

test('i100: CSV 構造が添付シートと一致する（set名なし）', () => {
  const { rows } = buildRowsI100({
    ...I100_ARGS,
    sampleIds: 'JUN2024-1-0_0_jgCO1\nJUN2024-1-1_50-1_jgCO1',
    descriptions: 'Okinawa coast water\nOkinawa coast water',
  });
  const lines = buildCsvI100({ date: '2026/8/18' }, rows, false).split('\r\n');
  assert.equal(lines[0], '[Header],,,,,,,');
  assert.equal(lines[2], 'Date,2026/8/18,,,,,,');
  assert.equal(lines[3], 'Module,GenerateFASTQ - 3.1.0,,,,,,');
  assert.equal(lines[4], 'Workflow,GenerateFASTQ,,,,,,');
  assert.equal(lines[6], 'Index Kit,,,,,,,');
  assert.equal(lines[8], 'Chemistry,Amplicon,,,,,,');
  assert.equal(lines[13], 'adapter,CTGTCTCTTATACACATCT,,,,,,');
  assert.equal(lines[14], 'AdvancedSetting1,123,,,,,,');
  assert.equal(lines[15], '[Data],,,,,,,');
  assert.equal(lines[16], DATA_HEADER_I100.join(','));
  assert.equal(lines[17],
    'JUN2024-1-0_0_jgCO1,JUN2024-1-0_0_jgCO1,Okinawa coast water,S762,TTACCGAC,S512,CGAATACG,');
});

test('i100: set名ありの CSV（10列・区切り行も10列）', () => {
  const { rows } = buildRowsI100({ ...I100_ARGS, sampleIds: 'S1' });
  const lines = buildCsvI100({ date: '2026/8/18' }, rows, true).trim().split('\r\n');
  assert.ok(lines.every((l) => l.split(',').length === 10));
  assert.equal(lines[0], '[Header],,,,,,,,,');
  assert.equal(lines[16], dataHeader('i100', true).join(','));
  assert.equal(lines[17], 'S1,S1,,S762,TTACCGAC,set1-1-1-1,S512,CGAATACG,set1-2-1-1,');
});

// ══ MiSeq（従来機・UDI set 指定）══
test('MiSeq: i100 と同じ set 指定で割り当てられる', () => {
  const { rows } = buildRowsMiSeq({
    sampleIds: 'S1\nS2', descriptions: '',
    i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '',
  });
  assert.deepEqual([rows[0].I7_Index_ID, rows[0].index], ['S762', 'TTACCGAC']);
  assert.deepEqual([rows[0].I5_Index_ID, rows[0].index2], ['S512', 'CGAATACG']);
  assert.equal(rows[0].Index1_Set, 'set1-1-1-1');
  assert.equal(rows[1].Index2_Set, 'set1-2-1-2');
  // Sample_Name / Sample_Project は持たない
  assert.equal(rows[0].Sample_Name, undefined);
  assert.equal(rows[0].Sample_Project, undefined);
});

test('MiSeq: 96サンプルの範囲指定', () => {
  const ids = Array.from({ length: 96 }, (_, i) => `S${i + 1}`).join('\n');
  const { rows, warnings } = buildRowsMiSeq({
    sampleIds: ids, descriptions: '',
    i7Start: 'set1-1-1', i7End: 'set1-1-12', i5Start: 'set1-2-1', i5End: 'set1-2-12',
  });
  assert.equal(rows.length, 96);
  assert.deepEqual([rows[95].I7_Index_ID, rows[95].index], ['S733', 'CCACAACA']);
  assert.deepEqual([rows[95].I5_Index_ID, rows[95].index2], ['S561', 'GTACCACA']);
  assert.equal(rows[95].Index1_Set, 'set1-1-12-8');
  assert.equal(warnings.length, 0);
});

test('MiSeq: CSV 構造が添付シートと一致する（6列・Index Kit 行なし）', () => {
  const { rows } = buildRowsMiSeq({
    sampleIds: 'S1\nS2', descriptions: '',
    i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '',
  });
  const lines = buildCsvMiSeq({
    date: '', experimentName: 'Coral_bacteria-240701',
    module: 'GenerateFASTQ - 2.0.0', libraryPrepKit: 'Nextera DNA',
    description: 'Coral associated bacteria',
  }, rows, false).split('\r\n');
  assert.equal(lines[0], '[Header],,,,,');
  assert.equal(lines[1], 'Experiment Name,Coral_bacteria-240701,,,,');
  assert.equal(lines[2], 'Date,,,,,');
  assert.equal(lines[3], 'Module,GenerateFASTQ - 2.0.0,,,,');
  assert.equal(lines[4], 'Workflow,GenerateFASTQ,,,,');
  assert.equal(lines[5], 'Library Prep Kit,Nextera DNA,,,,');
  assert.equal(lines[6], 'Description,Coral associated bacteria,,,,');
  assert.equal(lines[7], 'Chemistry,Amplicon,,,,');
  assert.equal(lines[8], '[Reads],,,,,');
  assert.equal(lines[11], '[Settings],,,,,');
  assert.equal(lines[14], '[Data],,,,,');
  assert.equal(lines[15], DATA_HEADER_MISEQ.join(','));
  assert.equal(lines[16], 'S1,,S762,TTACCGAC,S512,CGAATACG');
  assert.ok(!lines.some((l) => l.startsWith('Index Kit')));
});

test('MiSeq: set名ありの CSV（8列）', () => {
  const { rows } = buildRowsMiSeq({
    sampleIds: 'S1', descriptions: '',
    i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '',
  });
  const lines = buildCsvMiSeq({ date: '2026/8/18' }, rows, true).trim().split('\r\n');
  assert.ok(lines.every((l) => l.split(',').length === 8));
  assert.equal(lines[15], dataHeader('miseq', true).join(','));
  assert.equal(lines[16], 'S1,,S762,TTACCGAC,set1-1-1-1,S512,CGAATACG,set1-2-1-1');
});

// ══ 共通 ══
test('CSV: カンマを含む値はクォートされる', () => {
  const { rows } = buildRowsI100({ ...I100_ARGS, sampleIds: 'S1', descriptions: 'water, surface' });
  assert.ok(buildCsvI100({ date: '2026/8/18' }, rows, false).includes('"water, surface"'));
});

test('ファイル名とユーティリティ', () => {
  assert.equal(csvFileName('2026/8/18', 'i100'), 'SampleSheet_MiSeq-i100_20260818.csv');
  assert.equal(csvFileName('2026/8/18', 'miseq'), 'SampleSheet_MiSeq_20260818.csv');
  assert.deepEqual(splitRows('a\nb\n\n'), ['a', 'b']);
});
