/**
 * Nextera index データ（従来 MiSeq 用）
 * 出典: SamplesheetCoral16S 240701.xlsx で使用されている index
 *
 * 従来 MiSeq のサンプルシートでは
 *   - I7（N7xx）を先頭から順に巡回させ、
 *   - 1巡ごとに I5（S5xx）を次へ送る
 * という割り当てになっている。
 */

/** Index1 / i7（N7xx）: 24 件 */
export const NEXTERA_I7 = [
  ['N701', 'TAAGGCGA'],
  ['N702', 'CGTACTAG'],
  ['N703', 'AGGCAGAA'],
  ['N704', 'TCCTGAGC'],
  ['N705', 'GGACTCCT'],
  ['N706', 'TAGGCATG'],
  ['N707', 'CTCTCTAC'],
  ['N710', 'CGAGGCTG'],
  ['N711', 'AAGAGGCA'],
  ['N712', 'GTAGAGGA'],
  ['N714', 'GCTCATGA'],
  ['N715', 'ATCTCAGG'],
  ['N716', 'ACTCGCTA'],
  ['N718', 'GGAGCTAC'],
  ['N719', 'GCGTAGTA'],
  ['N720', 'CGGAGCCT'],
  ['N721', 'TACGCTGC'],
  ['N722', 'ATGCGCAG'],
  ['N723', 'TAGCGCTC'],
  ['N724', 'ACTGAGCG'],
  ['N726', 'CCTAAGAC'],
  ['N727', 'CGATCAGT'],
  ['N728', 'TGCAGCTA'],
  ['N729', 'TCGACGTC'],
];

/** Index2 / i5（S5xx）: 6 件 */
export const NEXTERA_I5 = [
  ['S508', 'CTAAGCCT'],
  ['S510', 'CGTCTAAT'],
  ['S511', 'TCTCTCCG'],
  ['S513', 'TCGACTAG'],
  ['S515', 'TTCTAGCT'],
  ['S516', 'CCTAGAGT'],
];

/** ID から配列を引く */
export function nexteraSeq(list, id) {
  const hit = list.find(([k]) => k === id);
  return hit ? hit[1] : null;
}

/** ID の位置（見つからなければ -1） */
export function nexteraPos(list, id) {
  return list.findIndex(([k]) => k === id);
}
