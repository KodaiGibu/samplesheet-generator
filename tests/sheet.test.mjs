/**
 * SampleSheet 作成ツール — ロジック検証
 * 実行: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDate, parseSetToken, expandSetRange, expandSetRanges, groupIndexes,
  setOrdinal, ordinalToSet, toRanges, TOTAL_GROUPS,
  buildRowsI100, buildRowsMiSeq, buildCsvI100, buildCsvMiSeq,
  csvFileName, splitRows, appendSuffix, dataHeader, tableHeader,
  makeOverrideCycles, BCL_HEADER, CLOUD_HEADER, DATA_HEADER_MISEQ, I100_COLUMNS,
} from '../src/sheet.js';
import { UDI_INDEX } from '../src/udi-data.js';

const I100_ARGS = {
  i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '',
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
  assert.throws(() => expandSetRange('set1-1-1', 'set1-2-3'), /同じ側/);
  assert.throws(() => expandSetRange('', 'set1-1-3'), /開始 set を入力/);
  assert.throws(() => parseSetToken('set1-1'), /指定形式が不正/);
});

// ══ 複数セットへの対応 ══
test('通し位置の相互変換', () => {
  assert.equal(TOTAL_GROUPS, 48);
  assert.equal(setOrdinal({ set: 1, group: 1 }), 0);
  assert.equal(setOrdinal({ set: 1, group: 12 }), 11);
  assert.equal(setOrdinal({ set: 2, group: 1 }), 12);
  assert.equal(setOrdinal({ set: 4, group: 12 }), 47);
  assert.deepEqual(ordinalToSet(0), { set: 1, group: 1 });
  assert.deepEqual(ordinalToSet(12), { set: 2, group: 1 });
  assert.deepEqual(ordinalToSet(47), { set: 4, group: 12 });
});

test('セットをまたぐ範囲指定（set1 → set2）', () => {
  const r = expandSetRange('set1-1-10', 'set2-1-3');
  assert.equal(r.length, 48); // set1 の 10,11,12 + set2 の 1,2,3 = 6グループ
  assert.equal(r[0].groupLabel, 'set1-1-10');
  assert.equal(r[23].groupLabel, 'set1-1-12');
  assert.equal(r[24].groupLabel, 'set2-1-1');
  assert.deepEqual([r[24].id, r[24].seq], ['P7126', 'CACTGTAG']);
  assert.equal(r[47].groupLabel, 'set2-1-3');
});

test('全セットを通した最大範囲', () => {
  const all = expandSetRange('set1-1-1', 'set4-1-12');
  assert.equal(all.length, 384); // 4セット × 96
  assert.equal(all[0].groupLabel, 'set1-1-1');
  assert.equal(all[95].groupLabel, 'set1-1-12');
  assert.equal(all[96].groupLabel, 'set2-1-1');
  assert.equal(all[383].groupLabel, 'set4-1-12');
});

test('セット跨ぎでも側の不一致はエラー', () => {
  assert.throws(() => expandSetRange('set1-1-10', 'set2-2-3'), /同じ側/);
  assert.throws(() => expandSetRange('set2-1-1', 'set1-1-5'), /終了 set が開始より前/);
});

test('複数の範囲ブロックを指定順に連結する', () => {
  const { indexes, warnings } = expandSetRanges([
    { start: 'set1-1-1', end: 'set1-1-2' },
    { start: 'set3-1-5', end: 'set3-1-5' },
  ], 'Index1 (i7)');
  assert.equal(indexes.length, 24);
  assert.equal(indexes[0].groupLabel, 'set1-1-1');
  assert.equal(indexes[15].groupLabel, 'set1-1-2');
  assert.equal(indexes[16].groupLabel, 'set3-1-5');
  assert.ok(warnings.some((w) => /2 個の範囲/.test(w)));
});

test('範囲ブロック: 空欄はスキップ、重複はエラー', () => {
  const { indexes } = expandSetRanges([
    { start: '', end: '' },
    { start: 'set1-1-1', end: '' },
    { start: '', end: '' },
  ]);
  assert.equal(indexes.length, 8);
  assert.throws(() => expandSetRanges([
    { start: 'set1-1-1', end: 'set1-1-3' },
    { start: 'set1-1-2', end: '' },
  ], 'Index1 (i7)'), /index が重複しています/);
  assert.equal(expandSetRanges([]).indexes.length, 0);
});

test('toRanges: 単一範囲と配列の両方を受け付ける', () => {
  assert.deepEqual(toRanges(null, 'set1-1-1', 'set1-1-3'),
    [{ start: 'set1-1-1', end: 'set1-1-3' }]);
  assert.deepEqual(toRanges([{ start: 'set2-1-1', end: '' }], '', ''),
    [{ start: 'set2-1-1', end: '' }]);
  assert.deepEqual(toRanges([], '', ''), []);
});

test('i100: 複数セットにまたがるシート作成', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `S${i + 1}`).join('\n');
  const { rows } = buildRowsI100({
    sampleIds: ids,
    i7Ranges: [{ start: 'set1-1-1', end: 'set2-1-3' }],
    i5Ranges: [{ start: 'set1-2-1', end: 'set2-2-3' }],
  });
  assert.equal(rows.length, 120);
  assert.equal(rows[0].Index1_Set, 'set1-1-1-1');
  assert.deepEqual([rows[95].I7_Index_ID, rows[95].Index], ['S733', 'CCACAACA']);
  assert.equal(rows[96].Index1_Set, 'set2-1-1-1');
  assert.deepEqual([rows[96].I7_Index_ID, rows[96].Index], ['P7126', 'CACTGTAG']);
  assert.deepEqual([rows[96].I5_Index_ID, rows[96].Index2], ['P5134', 'AAGCGACT']);
});

test('MiSeq: 複数の範囲ブロックを使ったシート作成', () => {
  const ids = Array.from({ length: 24 }, (_, i) => `S${i + 1}`).join('\n');
  const { rows, warnings } = buildRowsMiSeq({
    sampleIds: ids, descriptions: '',
    i7Ranges: [{ start: 'set1-1-1', end: 'set1-1-2' }, { start: 'set2-1-1', end: '' }],
    i5Ranges: [{ start: 'set1-2-1', end: 'set1-2-2' }, { start: 'set2-2-1', end: '' }],
  });
  assert.equal(rows.length, 24);
  assert.equal(rows[15].Index1_Set, 'set1-1-2-8');
  assert.equal(rows[16].Index1_Set, 'set2-1-1-1');
  assert.deepEqual([rows[16].I7_Index_ID, rows[16].index], ['P7126', 'CACTGTAG']);
  assert.ok(warnings.some((w) => /2 個の範囲/.test(w)));
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
  assert.deepEqual(dataHeader('i100', false), BCL_HEADER);
  assert.deepEqual(dataHeader('miseq', false), DATA_HEADER_MISEQ);
  assert.deepEqual(dataHeader('i100', true),
    ['Sample_ID', 'Index', 'Index1_Set', 'Index2', 'Index2_Set']);
  assert.deepEqual(dataHeader('miseq', true), [
    'Sample_ID', 'Description',
    'I7_Index_ID', 'index', 'Index1_Set', 'I5_Index_ID', 'index2', 'Index2_Set',
  ]);
  assert.deepEqual(tableHeader('i100'),
    ['Sample_ID', 'Index', 'Index1_Set', 'Index2', 'Index2_Set', 'LibraryName']);
});

test('OverrideCycles の自動生成', () => {
  assert.equal(makeOverrideCycles({
    read1Cycles: '501', read2Cycles: '501', index1Cycles: '8', index2Cycles: '8',
  }), 'R1:Y501;I1:I8;I2:I8;R2:Y501');
  assert.equal(makeOverrideCycles({
    read1Cycles: '301', read2Cycles: '301', index1Cycles: '8', index2Cycles: '8',
  }), 'R1:Y301;I1:I8;I2:I8;R2:Y301');
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
test('i100: index 割当・set名・LibraryName が付与される', () => {
  const { rows } = buildRowsI100({ ...I100_ARGS, sampleIds: 'S1\nS2' });
  assert.equal(rows[0].Index, 'TTACCGAC');
  assert.equal(rows[0].Index2, 'CGAATACG');
  assert.equal(rows[0].Index1_Set, 'set1-1-1-1');
  assert.equal(rows[0].Index2_Set, 'set1-2-1-1');
  assert.equal(rows[0].LibraryName, 'S1_TTACCGAC_CGAATACG');
  assert.equal(rows[0].ProjectName, 'Test Project');
  assert.equal(rows[1].Index1_Set, 'set1-1-1-2');
});

test('i100: index不足はエラー、余剰は警告', () => {
  const many = Array.from({ length: 9 }, (_, i) => `S${i + 1}`).join('\n');
  assert.throws(() => buildRowsI100({ ...I100_ARGS, sampleIds: many }), /Index1 \(i7\) が不足/);
  const { warnings } = buildRowsI100({ ...I100_ARGS, sampleIds: 'S1' });
  assert.ok(warnings.some((w) => /Index1 は 7件 余って/.test(w)));
});

test('i100: 添付ランシートと同じ v2 構造で出力される', () => {
  const ids = ['JUN2024-1-0_0_jgCO1', 'JUN2024-1-1_50-1_jgCO1', 'JUN2024-1-1_50-2_jgCO1'].join('\n');
  const { rows } = buildRowsI100({ ...I100_ARGS, sampleIds: ids });
  const csv = buildCsvI100({}, rows, false);
  const lines = csv.trim().split('\r\n');
  // 全行が 5 列
  assert.ok(lines.every((l) => l.split(',').length === I100_COLUMNS));
  assert.equal(lines[0], '[Header],,,,');
  assert.equal(lines[1], 'FileFormatVersion,2,,,');
  assert.equal(lines[2], 'RunName,Test Run,,,');
  assert.equal(lines[3], 'InstrumentPlatform,MiSeqi100Series,,,');
  assert.equal(lines[4], 'IndexOrientation,Forward,,,');
  assert.equal(lines[5], 'AnalysisLocation,Local,,,');
  assert.equal(lines[6], ',,,,');
  assert.equal(lines[7], '[Reads],,,,');
  assert.equal(lines[8], 'Read1Cycles,501,,,');
  assert.equal(lines[9], 'Read2Cycles,501,,,');
  assert.equal(lines[10], 'Index1Cycles,8,,,');
  assert.equal(lines[11], 'Index2Cycles,8,,,');
  assert.equal(lines[13], '[BCLConvert_Settings],,,,');
  assert.equal(lines[14], 'SoftwareVersion,4.4.6,,,');
  assert.equal(lines[15], 'OverrideCycles,R1:Y501;I1:I8;I2:I8;R2:Y501,,,');
  assert.equal(lines[16], 'FastqCompressionFormat,gzip,,,');
  assert.equal(lines[17], 'NoLaneSplitting,TRUE,,,');
  assert.equal(lines[18], 'GenerateFastqcMetrics,TRUE,,,');
  assert.equal(lines[20], '[BCLConvert_Data],,,,');
  assert.equal(lines[21], 'Sample_ID,Index,Index2,,');
  assert.equal(lines[22], 'JUN2024-1-0_0_jgCO1,TTACCGAC,CGAATACG,,');
  assert.equal(lines[23], 'JUN2024-1-1_50-1_jgCO1,TCGTCTGA,GTCCTTGA,,');
  assert.equal(lines[24], 'JUN2024-1-1_50-2_jgCO1,TTCCAGGT,CAGTGCTT,,');
  assert.equal(lines[26], '[Cloud_Settings],,,,');
  assert.equal(lines[27], 'GeneratedVersion,1.26.0.202606102337,,,');
  assert.equal(lines[29], '[Cloud_Data],,,,');
  assert.equal(lines[30], CLOUD_HEADER.join(','));
  assert.equal(lines[31],
    'JUN2024-1-0_0_jgCO1,Test Project,JUN2024-1-0_0_jgCO1_TTACCGAC_CGAATACG,,');
  assert.equal(lines[33],
    'JUN2024-1-1_50-2_jgCO1,Test Project,JUN2024-1-1_50-2_jgCO1_TTCCAGGT_CAGTGCTT,,');
});

test('i100: set名ありでも全行 5 列を維持する', () => {
  const { rows } = buildRowsI100({ ...I100_ARGS, sampleIds: 'S1' });
  const lines = buildCsvI100({}, rows, true).trim().split('\r\n');
  assert.ok(lines.every((l) => l.split(',').length === I100_COLUMNS));
  assert.equal(lines[21], 'Sample_ID,Index,Index1_Set,Index2,Index2_Set');
  assert.equal(lines[22], 'S1,TTACCGAC,set1-1-1-1,CGAATACG,set1-2-1-1');
});

test('i100: [Header]/[Reads] の値を上書きできる', () => {
  const { rows } = buildRowsI100({ ...I100_ARGS, sampleIds: 'S1', projectName: 'MyProj' });
  const lines = buildCsvI100({
    runName: 'Run_20260818', read1Cycles: '301', read2Cycles: '301',
    softwareVersion: '4.5.0',
  }, rows, false).trim().split('\r\n');
  assert.equal(lines[2], 'RunName,Run_20260818,,,');
  assert.equal(lines[8], 'Read1Cycles,301,,,');
  assert.equal(lines[14], 'SoftwareVersion,4.5.0,,,');
  assert.equal(lines[15], 'OverrideCycles,R1:Y301;I1:I8;I2:I8;R2:Y301,,,');
  assert.ok(lines.some((l) => l.startsWith('S1,MyProj,S1_TTACCGAC_CGAATACG,')));
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
  const { rows } = buildRowsI100({ ...I100_ARGS, sampleIds: 'S1', projectName: 'Proj, A' });
  assert.ok(buildCsvI100({}, rows, false).includes('"Proj, A"'));
});

test('ファイル名とユーティリティ', () => {
  assert.equal(csvFileName('Test Run', 'i100'), 'SampleSheet_Test_Run.csv');
  assert.equal(csvFileName('Run/2026', 'i100'), 'SampleSheet_Run_2026.csv');
  assert.equal(csvFileName('', 'i100'), 'SampleSheet.csv');
  assert.equal(csvFileName('2026/8/18', 'miseq'), 'SampleSheet_MiSeq_20260818.csv');
  assert.deepEqual(splitRows('a\nb\n\n'), ['a', 'b']);
});
