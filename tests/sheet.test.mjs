/**
 * SampleSheet 作成ツール — ロジック検証
 * 実行: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDate, parseSetToken, pairedSetToken, expandSetRange, expandSetRanges, groupIndexes,
  setOrdinal, ordinalToSet, toRanges, TOTAL_GROUPS,
  buildRows, buildRowsI100, buildRowsNextSeq, buildRowsMiSeq,
  buildCsv, buildCsvI100, buildCsvNextSeq, buildCsvMiSeq,
  csvFileName, splitRows, appendSuffix, dataHeader, tableHeader, makeOverrideCycles,
  buildTemplateCsv, templateFileName, demoSampleIds, buildIndexListCsv, buildIndexListCsvFor,
  BCL_HEADER, CLOUD_HEADER, DATA_HEADER_NEXTSEQ, DATA_HEADER_MISEQ, I100_COLUMNS, MACHINES,
} from '../src/sheet.js';
import { UDI_INDEX } from '../src/udi-data.js';

const R1 = { i7Start: 'set1-1-1', i7End: '', i5Start: 'set1-2-1', i5End: '' };

// ══ UDI データ・set 展開 ══
test('UDIデータ: 4セット×2側×12グループ×8件', () => {
  assert.equal(Object.keys(UDI_INDEX).length, 8);
  for (const k of Object.keys(UDI_INDEX)) {
    assert.equal(Object.keys(UDI_INDEX[k]).length, 12);
    for (let g = 1; g <= 12; g += 1) assert.equal(UDI_INDEX[k][String(g)].length, 8);
  }
});

test('set 範囲の展開（仕様の例）', () => {
  const i7 = expandSetRange('set1-1-1', 'set1-1-12');
  const i5 = expandSetRange('set1-2-1', 'set1-2-12');
  assert.equal(i7.length, 96);
  assert.deepEqual([i7[0].id, i7[0].seq], ['S762', 'TTACCGAC']);
  assert.deepEqual([i7[95].id, i7[95].seq], ['S733', 'CCACAACA']);
  assert.deepEqual([i5[0].id, i5[0].seq], ['S512', 'CGAATACG']);
  assert.deepEqual([i5[95].id, i5[95].seq], ['S561', 'GTACCACA']);
});

test('set 範囲: 省略形・空欄・異常系', () => {
  assert.equal(expandSetRange('set1-1-1', '12').length, 96);
  assert.equal(expandSetRange('set1-1-1', '').length, 8);
  assert.equal(expandSetRange('', '').length, 0);
  assert.throws(() => expandSetRange('set5-1-1', ''), /指定形式が不正/);
  assert.throws(() => expandSetRange('set1-1-13', ''), /グループ番号は 1〜12/);
  assert.throws(() => expandSetRange('set1-1-3', 'set1-1-1'), /終了 set が開始より前/);
  assert.throws(() => expandSetRange('set1-1-1', 'set1-2-3'), /同じ側/);
  assert.throws(() => parseSetToken('set1-1'), /指定形式が不正/);
});

test('セットをまたぐ範囲と全セット', () => {
  assert.equal(TOTAL_GROUPS, 48);
  assert.equal(setOrdinal({ set: 2, group: 1 }), 12);
  assert.deepEqual(ordinalToSet(47), { set: 4, group: 12 });
  const r = expandSetRange('set1-1-10', 'set2-1-3');
  assert.equal(r.length, 48);
  assert.equal(r[24].groupLabel, 'set2-1-1');
  assert.equal(expandSetRange('set1-1-1', 'set4-1-12').length, 384);
});

test('複数の範囲ブロックの連結と重複検出', () => {
  const { indexes, warnings } = expandSetRanges([
    { start: 'set1-1-1', end: 'set1-1-2' }, { start: 'set3-1-5', end: 'set3-1-5' },
  ], 'Index1 (i7)');
  assert.equal(indexes.length, 24);
  assert.equal(indexes[16].groupLabel, 'set3-1-5');
  assert.ok(warnings.some((w) => /2 個の範囲/.test(w)));
  assert.throws(() => expandSetRanges([
    { start: 'set1-1-1', end: 'set1-1-3' }, { start: 'set1-1-2', end: '' },
  ], 'Index1 (i7)'), /index が重複しています/);
  assert.deepEqual(toRanges(null, 'set1-1-1', ''), [{ start: 'set1-1-1', end: '' }]);
});

// ══ Index2 の自動対応 ══
test('pairedSetToken: i7 の set から対になる i5 の set を返す', () => {
  assert.equal(pairedSetToken('set1-1-1'), 'set1-2-1');
  assert.equal(pairedSetToken('set1-1-12'), 'set1-2-12');
  assert.equal(pairedSetToken('set3-1-5'), 'set3-2-5');
  assert.equal(pairedSetToken('set4-1-12'), 'set4-2-12');
  // 既に i5 の場合も側を 2 に保つ
  assert.equal(pairedSetToken('set2-2-3'), 'set2-2-3');
  // i7 側への逆変換
  assert.equal(pairedSetToken('set1-2-4', 1), 'set1-1-4');
  // 不正・空は null
  assert.equal(pairedSetToken(''), null);
  assert.equal(pairedSetToken('abc'), null);
  assert.equal(pairedSetToken('set9-1-1'), null);
});

test('自動対応した set 同士は同じ位置の index になる', () => {
  const i7 = expandSetRange('set2-1-3', 'set2-1-4');
  const i5 = expandSetRange(pairedSetToken('set2-1-3'), pairedSetToken('set2-1-4'));
  assert.equal(i7.length, i5.length);
  assert.equal(i7[0].groupLabel, 'set2-1-3');
  assert.equal(i5[0].groupLabel, 'set2-2-3');
});

// ══ 列定義 ══
test('dataHeader / tableHeader: 機種ごとの列構成', () => {
  assert.deepEqual(dataHeader('i100', false), BCL_HEADER);
  assert.deepEqual(dataHeader('nextseq', false), DATA_HEADER_NEXTSEQ);
  assert.deepEqual(dataHeader('miseq', false), DATA_HEADER_MISEQ);
  assert.deepEqual(dataHeader('i100', true), ['Sample_ID', 'Index', 'Index1_Set', 'Index2', 'Index2_Set']);
  assert.deepEqual(dataHeader('nextseq', true), [
    'Sample_ID', 'Sample_Name', 'Description',
    'I7_Index_ID', 'index', 'Index1_Set', 'I5_Index_ID', 'index2', 'Index2_Set',
  ]);
  assert.deepEqual(tableHeader('i100'),
    ['Sample_ID', 'Index', 'Index1_Set', 'Index2', 'Index2_Set', 'LibraryName']);
  assert.deepEqual(MACHINES, ['i100', 'nextseq', 'miseq']);
});

test('OverrideCycles の自動生成', () => {
  assert.equal(makeOverrideCycles({
    read1Cycles: '501', read2Cycles: '501', index1Cycles: '8', index2Cycles: '8',
  }), 'R1:Y501;I1:I8;I2:I8;R2:Y501');
});

// ══ 日付・接尾辞 ══
test('日付の正規化', () => {
  assert.equal(normalizeDate('2026/8/18'), '2026/8/18');
  assert.equal(normalizeDate('2026-08-18'), '2026/8/18');
  assert.throws(() => normalizeDate(''), /シーケンス日付を入力/);
  assert.throws(() => normalizeDate('2026/2/30'), /存在しない日付/);
});

test('指定範囲のサンプル名末尾に文字列を追加', () => {
  const r = appendSuffix('A\nB\nC\nD\nE', 2, 4, '_16S');
  assert.equal(r.text, 'A\nB_16S\nC_16S\nD_16S\nE');
  assert.equal(r.count, 3);
  assert.throws(() => appendSuffix('A\nB', 2, 1, '_x'), /開始行が終了行より後/);
  assert.throws(() => appendSuffix('A\nB', 1, 5, '_x'), /行数 \(2\) を超えて/);
  assert.throws(() => appendSuffix('A\nB', 1, 2, ''), /追加する文字列を入力/);
});

// ══ MiSeq i100 ══
test('i100: index・set名・LibraryName が付与される', () => {
  const { rows } = buildRowsI100({ ...R1, sampleIds: 'S1\nS2' });
  assert.equal(rows[0].Index, 'TTACCGAC');
  assert.equal(rows[0].Index2, 'CGAATACG');
  assert.equal(rows[0].Index1_Set, 'set1-1-1-1');
  assert.equal(rows[0].LibraryName, 'S1_TTACCGAC_CGAATACG');
  assert.equal(rows[0].ProjectName, 'Test Project');
});

test('i100: 添付ランシートと同じ v2 構造で出力される', () => {
  const ids = ['JUN2024-1-0_0_jgCO1', 'JUN2024-1-1_50-1_jgCO1', 'JUN2024-1-1_50-2_jgCO1'].join('\n');
  const { rows } = buildRowsI100({ ...R1, sampleIds: ids });
  const lines = buildCsvI100({}, rows, false).trim().split('\r\n');
  assert.ok(lines.every((l) => l.split(',').length === I100_COLUMNS));
  assert.equal(lines[0], '[Header],,,,');
  assert.equal(lines[1], 'FileFormatVersion,2,,,');
  assert.equal(lines[2], 'RunName,Test Run,,,');
  assert.equal(lines[3], 'InstrumentPlatform,MiSeqi100Series,,,');
  assert.equal(lines[7], '[Reads],,,,');
  assert.equal(lines[13], '[BCLConvert_Settings],,,,');
  assert.equal(lines[15], 'OverrideCycles,R1:Y501;I1:I8;I2:I8;R2:Y501,,,');
  assert.equal(lines[20], '[BCLConvert_Data],,,,');
  assert.equal(lines[21], 'Sample_ID,Index,Index2,,');
  assert.equal(lines[22], 'JUN2024-1-0_0_jgCO1,TTACCGAC,CGAATACG,,');
  assert.equal(lines[26], '[Cloud_Settings],,,,');
  assert.equal(lines[29], '[Cloud_Data],,,,');
  assert.equal(lines[30], CLOUD_HEADER.join(','));
  assert.equal(lines[31], 'JUN2024-1-0_0_jgCO1,Test Project,JUN2024-1-0_0_jgCO1_TTACCGAC_CGAATACG,,');
});

test('i100: set名ありでも全行 5 列を維持する', () => {
  const { rows } = buildRowsI100({ ...R1, sampleIds: 'S1' });
  const lines = buildCsvI100({}, rows, true).trim().split('\r\n');
  assert.ok(lines.every((l) => l.split(',').length === I100_COLUMNS));
  assert.equal(lines[21], 'Sample_ID,Index,Index1_Set,Index2,Index2_Set');
  assert.equal(lines[22], 'S1,TTACCGAC,set1-1-1-1,CGAATACG,set1-2-1-1');
});

// ══ NextSeq ══
test('NextSeq: 添付シートと同じ 7 列構造で出力される', () => {
  const { rows } = buildRowsNextSeq({
    ...R1, sampleIds: '', rowCount: 3, sampleNames: '', descriptions: 'Coral ',
  });
  const lines = buildCsvNextSeq({
    experimentName: 'MIGrunxx', date: '2026/4/28', description: 'Coral ',
  }, rows, false).trim().split('\r\n');
  assert.ok(lines.every((l) => l.split(',').length === 7));
  assert.equal(lines[0], '[Header],,,,,,');
  assert.equal(lines[1], 'Experiment Name,MIGrunxx,,,,,');
  assert.equal(lines[2], 'Date,2026/4/28,,,,,');
  assert.equal(lines[3], 'Module,GenerateFASTQ - 3.1.0,,,,,');
  assert.equal(lines[4], 'Workflow,GenerateFASTQ,,,,,');
  assert.equal(lines[5], 'Library Prep Kit,,,,,,');
  assert.equal(lines[6], 'Index Kit,,,,,,');
  assert.equal(lines[7], 'Description,Coral ,,,,,');
  assert.equal(lines[8], 'Chemistry,Amplicon,,,,,');
  assert.equal(lines[9], '[Reads],,,,,,');
  assert.equal(lines[10], '151,,,,,,');
  assert.equal(lines[11], '151,,,,,,');
  assert.equal(lines[12], ',,,,,,');
  assert.equal(lines[13], '[Settings],,,,,,');
  assert.equal(lines[14], 'AdvancedSetting1,123,,,,,');
  assert.equal(lines[15], ',,,,,,');
  assert.equal(lines[16], '[Data],,,,,,');
  assert.equal(lines[17], DATA_HEADER_NEXTSEQ.join(','));
  assert.equal(lines[18], ',,Coral,S762,TTACCGAC,S512,CGAATACG');
  assert.equal(lines[19], ',,Coral,S713,TCGTCTGA,S586,GTCCTTGA');
  // adapter 行を持たない
  assert.ok(!lines.some((l) => l.startsWith('adapter')));
});

test('NextSeq: Sample_ID あり・set名列ありでも整合する', () => {
  const { rows } = buildRowsNextSeq({ ...R1, sampleIds: 'S1\nS2', sampleNames: '', descriptions: '' });
  assert.equal(rows[0].Sample_Name, 'S1');
  const lines = buildCsvNextSeq({}, rows, true).trim().split('\r\n');
  assert.ok(lines.every((l) => l.split(',').length === 9));
  assert.equal(lines[18], 'S1,S1,,S762,TTACCGAC,set1-1-1-1,S512,CGAATACG,set1-2-1-1');
});

// ══ MiSeq ══
test('MiSeq: 6列構造と set名列', () => {
  const { rows } = buildRowsMiSeq({ ...R1, sampleIds: 'S1\nS2', descriptions: '' });
  const off = buildCsvMiSeq({}, rows, false).trim().split('\r\n');
  assert.ok(off.every((l) => l.split(',').length === 6));
  assert.equal(off[15], DATA_HEADER_MISEQ.join(','));
  assert.equal(off[16], 'S1,,S762,TTACCGAC,S512,CGAATACG');
  assert.ok(!off.some((l) => l.startsWith('Index Kit')));
  const on = buildCsvMiSeq({}, rows, true).trim().split('\r\n');
  assert.ok(on.every((l) => l.split(',').length === 8));
});

// ══ 共通入口 ══
test('buildRows / buildCsv の共通入口が機種ごとに切り替わる', () => {
  MACHINES.forEach((mc) => {
    const { rows } = buildRows(mc, { ...R1, sampleIds: 'S1\nS2', sampleNames: '', descriptions: '' });
    assert.equal(rows.length, 2);
    const csv = buildCsv(mc, {}, rows, false);
    assert.ok(csv.includes('TTACCGAC'));
  });
});

// ══ 384サンプルのテンプレート ══
test('384サンプルのテンプレートを機種ごとに生成できる', () => {
  const expect = { i100: 5, nextseq: 7, miseq: 6 };
  MACHINES.forEach((mc) => {
    const { csv, rows, count } = buildTemplateCsv(mc, false);
    assert.equal(count, 384);
    assert.equal(rows.length, 384);
    const lines = csv.trim().split('\r\n');
    assert.ok(lines.every((l) => l.split(',').length === expect[mc]),
      `${mc}: 列数が ${expect[mc]} に揃っていない`);
    // 先頭・末尾の index が全セットの端になっている
    assert.equal(rows[0].Index1_Set, 'set1-1-1-1');
    assert.equal(rows[383].Index1_Set, 'set4-1-12-8');
    assert.equal(rows[0].Index2_Set, 'set1-2-1-1');
    assert.equal(rows[383].Index2_Set, 'set4-2-12-8');
  });
});

test('テンプレート: デモ ID とファイル名', () => {
  const ids = demoSampleIds(384);
  assert.equal(ids.length, 384);
  assert.equal(ids[0], 'Demo-A01');
  assert.equal(ids[95], 'Demo-A96');
  assert.equal(ids[96], 'Demo-B01');
  assert.equal(ids[383], 'Demo-D96');
  assert.equal(new Set(ids).size, 384);
  assert.equal(templateFileName('i100'), 'SampleSheet_Template_MiSeq-i100_384samples.csv');
  assert.equal(templateFileName('nextseq'), 'SampleSheet_Template_NextSeq_384samples.csv');
  assert.equal(templateFileName('miseq'), 'SampleSheet_Template_MiSeq_384samples.csv');
});

test('テンプレート: set名列ありでも生成できる', () => {
  const { csv } = buildTemplateCsv('nextseq', true);
  const lines = csv.trim().split('\r\n');
  assert.ok(lines.every((l) => l.split(',').length === 9));
  assert.ok(lines.some((l) => l.includes('set4-1-12-8')));
});

// ══ index 一覧の CSV ══
test('index 一覧 CSV: 全768件を出力する', () => {
  const lines = buildIndexListCsv().trim().split('\r\n');
  assert.equal(lines.length, 769); // ヘッダ + 768
  assert.equal(lines[0],
    'Set,Side,Side_Label,Group,Well,Set_Name,Index_ID,Index_Sequence');
  assert.equal(lines[1], 'set1,1,Index1 (i7),1,1,set1-1-1-1,S762,TTACCGAC');
  assert.equal(lines[96], 'set1,1,Index1 (i7),12,8,set1-1-12-8,S733,CCACAACA');
  assert.equal(lines[97], 'set1,2,Index2 (i5),1,1,set1-2-1-1,S512,CGAATACG');
  assert.equal(lines[768], 'set4,2,Index2 (i5),12,8,set4-2-12-8,5-344,TTCGTGGA');
  assert.ok(lines.every((l) => l.split(',').length === 8));
});

test('index 一覧 CSV: セット・側を絞って出力できる', () => {
  const lines = buildIndexListCsvFor(2, 1).trim().split('\r\n');
  assert.equal(lines.length, 97);
  assert.equal(lines[0], 'Set_Name,Group,Well,Index_ID,Index_Sequence');
  assert.equal(lines[1], 'set2-1-1-1,1,1,P7126,CACTGTAG');
  assert.equal(lines[96], 'set2-1-12-8,12,8,P7997,TACCTGTG');
});

// ══ 共通 ══
test('CSV: カンマを含む値はクォートされる', () => {
  const { rows } = buildRowsNextSeq({ ...R1, sampleIds: 'S1', sampleNames: '', descriptions: 'water, surface' });
  assert.ok(buildCsvNextSeq({}, rows, false).includes('"water, surface"'));
});

test('ファイル名とユーティリティ', () => {
  assert.equal(csvFileName('Test Run', 'i100'), 'SampleSheet_Test_Run.csv');
  assert.equal(csvFileName('2026/8/18', 'nextseq'), 'SampleSheet_NextSeq_20260818.csv');
  assert.equal(csvFileName('2026/8/18', 'miseq'), 'SampleSheet_MiSeq_20260818.csv');
  assert.deepEqual(splitRows('a\nb\n\n'), ['a', 'b']);
});
