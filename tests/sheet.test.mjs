/**
 * SampleSheet 作成ツール — ロジック検証
 * 実行: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDate, parseSetToken, expandSetRange, groupIndexes,
  buildRowsI100, buildRowsMiSeq, buildCsvI100, buildCsvMiSeq,
  csvFileName, splitRows, appendSuffix, sliceNextera,
  DATA_HEADER_I100, DATA_HEADER_MISEQ, NEXTERA_I7, NEXTERA_I5,
} from '../src/sheet.js';
import { UDI_INDEX } from '../src/udi-data.js';

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

test('groupIndexes はラベル付きで8件返す', () => {
  const g = groupIndexes(1, 1, 1);
  assert.equal(g.length, 8);
  assert.equal(g[0].label, 'set1-1-1-1');
  assert.equal(g[7].label, 'set1-1-1-8');
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

test('接尾辞付与: 異常系', () => {
  assert.throws(() => appendSuffix('', 1, 1, '_x'), /リストが空/);
  assert.throws(() => appendSuffix('A\nB', 2, 1, '_x'), /開始行が終了行より後/);
  assert.throws(() => appendSuffix('A\nB', 1, 5, '_x'), /行数 \(2\) を超えて/);
  assert.throws(() => appendSuffix('A\nB', 0, 1, '_x'), /1 以上/);
  assert.throws(() => appendSuffix('A\nB', 1, 2, ''), /追加する文字列を入力/);
});

// ══ MiSeq i100 ══
test('i100: Sample_Name は未入力なら Sample_ID を反映、個別修正は優先', () => {
  const { rows } = buildRowsI100({
    sampleIds: 'A\nB\nC', sampleNames: 'A\nB_mod\n', descriptions: '',
    i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '', sampleProject: '',
  });
  assert.equal(rows[0].Sample_Name, 'A');
  assert.equal(rows[1].Sample_Name, 'B_mod');
  assert.equal(rows[2].Sample_Name, 'C');
});

test('i100: index 割当と行数チェック', () => {
  const { rows } = buildRowsI100({
    sampleIds: 'S1\nS2', sampleNames: '', descriptions: 'w1\nw2',
    i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '', sampleProject: '',
  });
  assert.deepEqual([rows[0].I7_Index_ID, rows[0].index], ['S762', 'TTACCGAC']);
  assert.deepEqual([rows[0].I5_Index_ID, rows[0].index2], ['S512', 'CGAATACG']);
  assert.throws(() => buildRowsI100({
    sampleIds: 'S1\nS2', sampleNames: '', descriptions: 'only one',
    i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '', sampleProject: '',
  }), /行数が不一致/);
});

test('i100: index 不足はエラー、余剰は警告', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `S${i + 1}`).join('\n');
  assert.throws(() => buildRowsI100({
    sampleIds: ids, sampleNames: '', descriptions: '',
    i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '', sampleProject: '',
  }), /Index1 \(i7\) が不足/);
  const { warnings } = buildRowsI100({
    sampleIds: 'S1', sampleNames: '', descriptions: '',
    i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '', sampleProject: '',
  });
  assert.ok(warnings.some((w) => /Index1 は 7件 余って/.test(w)));
});

test('i100: CSV 構造が添付シートと一致する', () => {
  const { rows } = buildRowsI100({
    sampleIds: 'JUN2024-1-0_0_jgCO1\nJUN2024-1-1_50-1_jgCO1',
    sampleNames: '', descriptions: 'Okinawa coast water\nOkinawa coast water',
    i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '', sampleProject: '',
  });
  const lines = buildCsvI100({ date: '2026/8/18' }, rows).split('\r\n');
  assert.equal(lines[0], '[Header],,,,,,,');
  assert.equal(lines[2], 'Date,2026/8/18,,,,,,');
  assert.equal(lines[3], 'Module,GenerateFASTQ - 3.1.0,,,,,,');
  assert.equal(lines[4], 'Workflow,GenerateFASTQ,,,,,,');
  assert.equal(lines[6], 'Index Kit,,,,,,,');
  assert.equal(lines[8], 'Chemistry,Amplicon,,,,,,');
  assert.equal(lines[9], '[Reads],,,,,,,');
  assert.equal(lines[13], 'adapter,CTGTCTCTTATACACATCT,,,,,,');
  assert.equal(lines[14], 'AdvancedSetting1,123,,,,,,');
  assert.equal(lines[15], '[Data],,,,,,,');
  assert.equal(lines[16], DATA_HEADER_I100.join(','));
  assert.equal(lines[17],
    'JUN2024-1-0_0_jgCO1,JUN2024-1-0_0_jgCO1,Okinawa coast water,S762,TTACCGAC,S512,CGAATACG,');
});

// ══ MiSeq（従来機）══
test('MiSeq: Nextera index は 24 / 6 件', () => {
  assert.equal(NEXTERA_I7.length, 24);
  assert.equal(NEXTERA_I5.length, 6);
  assert.deepEqual(NEXTERA_I7[0], ['N701', 'TAAGGCGA']);
  assert.deepEqual(NEXTERA_I7[23], ['N729', 'TCGACGTC']);
  assert.deepEqual(NEXTERA_I5[0], ['S508', 'CTAAGCCT']);
  assert.deepEqual(NEXTERA_I5[5], ['S516', 'CCTAGAGT']);
});

test('MiSeq: 添付シートと同じ割当（i7巡回 × i5送り）', () => {
  const ids = Array.from({ length: 48 }, (_, i) => `S${i + 1}`).join('\n');
  const { rows } = buildRowsMiSeq({
    sampleIds: ids, descriptions: '',
    i7Start: 'N701', i7End: 'N729', i5Start: 'S508', i5End: 'S516',
  });
  // 1件目 = N701 / S508
  assert.deepEqual([rows[0].I7_Index_ID, rows[0].index], ['N701', 'TAAGGCGA']);
  assert.deepEqual([rows[0].I5_Index_ID, rows[0].index2], ['S508', 'CTAAGCCT']);
  // 24件目 = N729 / S508
  assert.deepEqual([rows[23].I7_Index_ID, rows[23].index], ['N729', 'TCGACGTC']);
  assert.equal(rows[23].I5_Index_ID, 'S508');
  // 25件目で i5 が次へ送られる
  assert.deepEqual([rows[24].I7_Index_ID, rows[24].index], ['N701', 'TAAGGCGA']);
  assert.deepEqual([rows[24].I5_Index_ID, rows[24].index2], ['S510', 'CGTCTAAT']);
  // 48件目 = N729 / S510
  assert.equal(rows[47].I7_Index_ID, 'N729');
  assert.equal(rows[47].I5_Index_ID, 'S510');
});

test('MiSeq: 組み合わせ不足はエラー', () => {
  const ids = Array.from({ length: 200 }, (_, i) => `S${i + 1}`).join('\n');
  assert.throws(() => buildRowsMiSeq({
    sampleIds: ids, descriptions: '',
    i7Start: 'N701', i7End: 'N729', i5Start: 'S508', i5End: 'S516',
  }), /組み合わせが不足/);
});

test('MiSeq: index 範囲の切り出しと異常系', () => {
  assert.equal(sliceNextera(NEXTERA_I7, 'N701', 'N707', 'i7').length, 7);
  assert.equal(sliceNextera(NEXTERA_I5, '', '', 'i5').length, 6);
  assert.throws(() => sliceNextera(NEXTERA_I7, 'N999', '', 'i7'), /開始 ID が見つかりません/);
  assert.throws(() => sliceNextera(NEXTERA_I7, 'N707', 'N701', 'i7'), /終了 ID が開始より前/);
});

test('MiSeq: CSV 構造が添付シートと一致する（6列）', () => {
  const { rows } = buildRowsMiSeq({
    sampleIds: 'S1\nS2', descriptions: '',
    i7Start: 'N701', i7End: 'N729', i5Start: 'S508', i5End: 'S516',
  });
  const lines = buildCsvMiSeq({
    date: '', experimentName: 'Coral_bacteria-240701',
    module: 'GenerateFASTQ - 2.0.0', libraryPrepKit: 'Nextera DNA',
    description: 'Coral associated bacteria',
  }, rows).split('\r\n');
  assert.equal(lines[0], '[Header],,,,,');
  assert.equal(lines[1], 'Experiment Name,Coral_bacteria-240701,,,,');
  assert.equal(lines[2], 'Date,,,,,');
  assert.equal(lines[3], 'Module,GenerateFASTQ - 2.0.0,,,,');
  assert.equal(lines[4], 'Workflow,GenerateFASTQ,,,,');
  assert.equal(lines[5], 'Library Prep Kit,Nextera DNA,,,,');
  assert.equal(lines[6], 'Description,Coral associated bacteria,,,,');
  assert.equal(lines[7], 'Chemistry,Amplicon,,,,');
  assert.equal(lines[8], '[Reads],,,,,');
  assert.equal(lines[9], '301,,,,,');
  assert.equal(lines[11], '[Settings],,,,,');
  assert.equal(lines[12], 'adapter,CTGTCTCTTATACACATCT,,,,');
  assert.equal(lines[13], 'AdvancedSetting1,123,,,,');
  assert.equal(lines[14], '[Data],,,,,');
  assert.equal(lines[15], DATA_HEADER_MISEQ.join(','));
  assert.equal(lines[16], 'S1,,N701,TAAGGCGA,S508,CTAAGCCT');
  // Index Kit 行を持たない
  assert.ok(!lines.some((l) => l.startsWith('Index Kit')));
});

// ══ 共通 ══
test('CSV: カンマを含む値はクォートされる', () => {
  const { rows } = buildRowsI100({
    sampleIds: 'S1', sampleNames: '', descriptions: 'water, surface',
    i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '', sampleProject: '',
  });
  assert.ok(buildCsvI100({ date: '2026/8/18' }, rows).includes('"water, surface"'));
});

test('ファイル名とユーティリティ', () => {
  assert.equal(csvFileName('2026/8/18', 'i100'), 'SampleSheet_MiSeq-i100_20260818.csv');
  assert.equal(csvFileName('2026/8/18', 'miseq'), 'SampleSheet_MiSeq_20260818.csv');
  assert.deepEqual(splitRows('a\nb\n\n'), ['a', 'b']);
});
