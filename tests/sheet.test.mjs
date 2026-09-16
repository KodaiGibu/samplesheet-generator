/**
 * SampleSheet 作成ツール — ロジック検証
 * 実行: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDate, parseSetToken, expandSetSpec, groupIndexes,
  buildRows, buildCsv, csvFileName, splitRows, stripTag, stripGroup, DATA_HEADER,
} from '../src/sheet.js';
import { UDI_INDEX } from '../src/udi-data.js';

test('UDIデータ: 4セット×2側×12グループ×8件', () => {
  const keys = Object.keys(UDI_INDEX);
  assert.equal(keys.length, 8);
  for (const k of keys) {
    assert.equal(Object.keys(UDI_INDEX[k]).length, 12);
    for (let g = 1; g <= 12; g += 1) assert.equal(UDI_INDEX[k][String(g)].length, 8);
  }
});

test('set1-1-1〜12 / set1-2-1〜12 の展開（仕様の例）', () => {
  const i7 = expandSetSpec('set1-1-1~set1-1-12');
  const i5 = expandSetSpec('set1-2-1~set1-2-12');
  assert.equal(i7.length, 96);
  assert.equal(i5.length, 96);
  assert.deepEqual([i7[0].id, i7[0].seq], ['S762', 'TTACCGAC']);
  assert.deepEqual([i7[95].id, i7[95].seq], ['S733', 'CCACAACA']);
  assert.deepEqual([i5[0].id, i5[0].seq], ['S512', 'CGAATACG']);
  assert.deepEqual([i5[95].id, i5[95].seq], ['S561', 'GTACCACA']);
});

test('サンプルCSVの先頭10件と一致する', () => {
  const i7 = expandSetSpec('set1-1-1~set1-1-12');
  const i5 = expandSetSpec('set1-2-1~set1-2-12');
  const expect7 = [['S762', 'TTACCGAC'], ['S713', 'TCGTCTGA'], ['S736', 'TTCCAGGT'], ['S709', 'TACGGTCT'],
    ['S732', 'AAGACCGT'], ['S774', 'CAGGTTCA'], ['S747', 'TAGGAGCT'], ['S794', 'TACTCCAG'],
    ['S729', 'AGTGACCT'], ['S777', 'AGCCTATC']];
  const expect5 = [['S512', 'CGAATACG'], ['S586', 'GTCCTTGA'], ['S543', 'CAGTGCTT'], ['S575', 'TCCATTGC'],
    ['S550', 'GTCGATTG'], ['S506', 'ATAACGCC'], ['S524', 'GCCTTAAC'], ['S590', 'GGTATAGG'],
    ['S591', 'TCTAGGAG'], ['S526', 'TGCGTAAC']];
  expect7.forEach((e, i) => assert.deepEqual([i7[i].id, i7[i].seq], e));
  expect5.forEach((e, i) => assert.deepEqual([i5[i].id, i5[i].seq], e));
});

test('set 展開: 単独・カンマ区切り・省略範囲・全角チルダ', () => {
  assert.equal(expandSetSpec('set1-1-1').length, 8);
  assert.equal(expandSetSpec('set1-1-1, set1-1-2').length, 16);
  assert.equal(expandSetSpec('set1-1-1～set1-1-3').length, 24);
  assert.equal(expandSetSpec('set1-1-1~3').length, 24);
  assert.equal(expandSetSpec('set2-1-1\nset2-1-2').length, 16);
  assert.equal(expandSetSpec('').length, 0);
});

test('set 展開: 異常系', () => {
  assert.throws(() => expandSetSpec('set5-1-1'), /set の指定形式が不正/);
  assert.throws(() => expandSetSpec('set1-1-13'), /グループ番号は 1〜12/);
  assert.throws(() => expandSetSpec('set1-1-3~set1-1-1'), /範囲の終端が開始より小さい/);
  assert.throws(() => expandSetSpec('set1-1-1~set1-2-3'), /同じセット・同じ側/);
  assert.throws(() => parseSetToken('set1-1'), /指定形式が不正/);
});

test('groupIndexes はラベル付きで8件返す', () => {
  const g = groupIndexes(1, 1, 1);
  assert.equal(g.length, 8);
  assert.equal(g[0].label, 'set1-1-1-1');
  assert.equal(g[7].label, 'set1-1-1-8');
});

test('日付の正規化', () => {
  assert.equal(normalizeDate('2026/8/18'), '2026/8/18');
  assert.equal(normalizeDate('2026-08-18'), '2026/8/18');
  assert.equal(normalizeDate(' 2026/08/18 '), '2026/8/18');
  assert.throws(() => normalizeDate(''), /シーケンス日付を入力/);
  assert.throws(() => normalizeDate('2026.8.18'), /YYYY\/M\/D/);
  assert.throws(() => normalizeDate('2026/2/30'), /存在しない日付/);
});

test('Sample_Name は未入力なら Sample_ID を反映、個別修正は優先', () => {
  const { rows } = buildRows({
    sampleIds: 'A\nB\nC',
    sampleNames: 'A\nB_mod\n',
    descriptions: '',
    i7Spec: 'set1-1-1',
    i5Spec: 'set1-2-1',
    sampleProject: '',
  });
  assert.equal(rows[0].Sample_Name, 'A');
  assert.equal(rows[1].Sample_Name, 'B_mod');
  assert.equal(rows[2].Sample_Name, 'C');
});

test('buildRows: index 割当と Description 行数チェック', () => {
  const { rows } = buildRows({
    sampleIds: 'S1\nS2',
    sampleNames: '',
    descriptions: 'Okinawa coast water\nOkinawa coast water',
    i7Spec: 'set1-1-1',
    i5Spec: 'set1-2-1',
    sampleProject: '',
  });
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].I7_Index_ID, rows[0].index], ['S762', 'TTACCGAC']);
  assert.deepEqual([rows[0].I5_Index_ID, rows[0].index2], ['S512', 'CGAATACG']);
  assert.equal(rows[0].Description, 'Okinawa coast water');
  assert.throws(() => buildRows({
    sampleIds: 'S1\nS2', sampleNames: '', descriptions: 'only one',
    i7Spec: 'set1-1-1', i5Spec: 'set1-2-1', sampleProject: '',
  }), /行数が不一致/);
});

test('buildRows: index 不足はエラー、余剰は警告', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `S${i + 1}`).join('\n');
  assert.throws(() => buildRows({
    sampleIds: ids, sampleNames: '', descriptions: '',
    i7Spec: 'set1-1-1', i5Spec: 'set1-2-1', sampleProject: '',
  }), /Index1 \(i7\) が不足/);

  const { warnings } = buildRows({
    sampleIds: 'S1', sampleNames: '', descriptions: '',
    i7Spec: 'set1-1-1', i5Spec: 'set1-2-1', sampleProject: '',
  });
  assert.ok(warnings.some((w) => /Index1 は 7件 余っています/.test(w)));
});

test('buildRows: Sample_ID と index 組合せの重複を警告', () => {
  const { warnings } = buildRows({
    sampleIds: 'S1\nS1', sampleNames: '', descriptions: '',
    i7Spec: 'set1-1-1', i5Spec: 'set1-2-1', sampleProject: '',
  });
  assert.ok(warnings.some((w) => /Sample_ID の重複/.test(w)));
});

test('CSV の構造がサンプルと一致する', () => {
  const { rows } = buildRows({
    sampleIds: 'JUN2024-1-0_0_jgCO1\nJUN2024-1-1_50-1_jgCO1',
    sampleNames: '',
    descriptions: 'Okinawa coast water\nOkinawa coast water',
    i7Spec: 'set1-1-1', i5Spec: 'set1-2-1', sampleProject: '',
  });
  const csv = buildCsv({ date: '2026/8/18' }, rows);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '[Header],,,,,,,');
  assert.equal(lines[1], 'Experiment Name,,,,,,,');
  assert.equal(lines[2], 'Date,2026/8/18,,,,,,');
  assert.equal(lines[3], 'Module,GenerateFASTQ - 3.1.0,,,,,,');
  assert.equal(lines[4], 'Workflow,GenerateFASTQ,,,,,,');
  assert.equal(lines[5], 'Library Prep Kit,,,,,,,');
  assert.equal(lines[6], 'Index Kit,,,,,,,');
  assert.equal(lines[7], 'Description,,,,,,,');
  assert.equal(lines[8], 'Chemistry,Amplicon,,,,,,');
  assert.equal(lines[9], '[Reads],,,,,,,');
  assert.equal(lines[10], '301,,,,,,,');
  assert.equal(lines[11], '301,,,,,,,');
  assert.equal(lines[12], '[Settings],,,,,,,');
  assert.equal(lines[13], 'adapter,CTGTCTCTTATACACATCT,,,,,,');
  assert.equal(lines[14], 'AdvancedSetting1,123,,,,,,');
  assert.equal(lines[15], '[Data],,,,,,,');
  assert.equal(lines[16], DATA_HEADER.join(','));
  assert.equal(lines[17],
    'JUN2024-1-0_0_jgCO1,JUN2024-1-0_0_jgCO1,Okinawa coast water,S762,TTACCGAC,S512,CGAATACG,');
  assert.equal(lines[18],
    'JUN2024-1-1_50-1_jgCO1,JUN2024-1-1_50-1_jgCO1,Okinawa coast water,S713,TCGTCTGA,S586,GTCCTTGA,');
});

test('CSV: カンマを含む値はクォートされる', () => {
  const { rows } = buildRows({
    sampleIds: 'S1', sampleNames: '', descriptions: 'water, surface',
    i7Spec: 'set1-1-1', i5Spec: 'set1-2-1', sampleProject: '',
  });
  const csv = buildCsv({ date: '2026/8/18' }, rows);
  assert.ok(csv.includes('"water, surface"'));
});

test('ファイル名とユーティリティ', () => {
  assert.equal(csvFileName('2026/8/18'), 'SampleSheet_20260818.csv');
  assert.deepEqual(splitRows('a\nb\n\n'), ['a', 'b']);
  assert.equal(stripTag(0, true), 'strip0');
  assert.equal(stripTag(8, true), 'strip1');
  assert.equal(stripTag(3, false), 'normal');
  assert.equal(stripGroup(0), 1);
  assert.equal(stripGroup(8), 2);
});
