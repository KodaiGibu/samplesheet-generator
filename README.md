# SampleSheet作成ツール（GenerateFASTQ）

**MiSeq i100** と **MiSeq** の GenerateFASTQ 用 SampleSheet CSV を作成する Web ツールです。
機種ごとにタブを切り替えて使用します。index はどちらも UDI index の **set 指定**で割り当てます。

- ビルド不要の静的サイト（HTML + CSS + バニラ JavaScript、外部依存ゼロ）
- 処理はすべてブラウザ内で完結し、サンプル情報はサーバーに送信されません

## 機種ごとの違い

| | MiSeq i100 | MiSeq |
|---|---|---|
| Index | UDI index（set 指定） | UDI index（set 指定） |
| [Data] 列数 | 8列（set名ありで10列） | 6列（set名ありで8列） |
| [Data] 列構成 | Sample_ID, Sample_Name, Description, I7_Index_ID, index, I5_Index_ID, index2, Sample_Project | Sample_ID, Description, I7_Index_ID, index, I5_Index_ID, index2 |
| Index Kit 行 | あり | なし |
| Module 既定値 | `GenerateFASTQ - 3.1.0` | `GenerateFASTQ - 2.0.0` |

Workflow・Chemistry・adapter・AdvancedSetting1・[Reads] の既定値は両機種で共通です。

## Index の指定方法（set 記法）

**1つの set ラベル（例 `set1-1-3`）= 8連チューブ1本分 = 8 index** です。
開始 set と終了 set を **別々の入力欄** に指定します。

| 開始 set | 終了 set | 展開される index |
|---|---|---|
| `set1-1-1` | `set1-1-12` | 96 件 |
| `set1-1-1` | `12` | 96 件（終了は番号だけでも可） |
| `set1-1-1` | （空欄） | 8 件（開始グループのみ） |
| `set1-1-10` | `set2-1-3` | 48 件（**セットをまたぐ指定**） |
| `set1-1-1` | `set4-1-12` | 384 件（全4セット） |

`setN-M-K` の各要素は **N**: セット番号（1〜4）、**M**: `1`=i7 / `2`=i5、**K**: グループ番号（1〜12）です。
1セット = 12グループ × 8 index = 96 index、全4セットで 768 index を収録しています。

### 複数セットの指定

1枚のサンプルシートで複数のセットを使う場合、次の2通りの方法があります。

**1. 連続した範囲はセットをまたいで直接指定**

開始と終了のセット番号が異なる場合、`set1-1-12` の次を `set2-1-1` として連続的に展開します。
例えば `set1-1-10` 〜 `set2-1-3` と指定すると、set1 の 10・11・12 と set2 の 1・2・3 の
計6グループ（48 index）が順に割り当てられます。側（i7 どうし / i5 どうし）が一致していれば、
`set1-1-1` 〜 `set4-1-12` のように全4セットを通した指定も可能です。

**2. 連続しないセットは範囲ブロックを追加**

「＋ 範囲を追加」ボタンで入力行を増やすと、離れたセットを組み合わせられます。
例えば 範囲1 に `set1-1-1`〜`set1-1-2`、範囲2 に `set3-1-5` を指定すると、
set1 の 16 index に続けて set3 の 8 index が割り当てられます（指定した順に連結）。

各範囲行には展開される index 件数が表示され、範囲どうしで同じ index が重複した場合は
エラーとして検出されます。不要な行は行末の「×」で削除できます。

**指定例**: Index1 に `set1-1-1`〜`set1-1-12`、Index2 に `set1-2-1`〜`set1-2-12` を指定すると、
i7 は S762:TTACCGAC 〜 S733:CCACAACA、i5 は S512:CGAATACG 〜 S561:GTACCACA が
先頭のサンプルから順に割り当てられます。

## set名列の出力

結果表には **Index1_Set / Index2_Set** の列が常に表示され、各サンプルがどの set の
どのウェルの index を使っているかを `set1-1-3-5`（set-側-グループ-ウェル位置）の形式で確認できます。

CSV に含めるかどうかは **「CSVにset名列を出力する」チェックボックス**で切り替えます。

- **OFF（既定）**: 装置が読む標準の列構成のまま出力（i100 = 8列 / MiSeq = 6列）
- **ON**: `index` の直後に `Index1_Set`、`index2` の直後に `Index2_Set` を挿入（i100 = 10列 / MiSeq = 8列）

結果表の set名列は、出力対象のときは緑、対象外のときはグレーで表示されます。

## 入力項目

### [Header] / [Settings]（両タブ共通）

| 項目 | 既定値 |
|---|---|
| シーケンス日付 | （未入力・i100 は必須） |
| Experiment Name | 空白 |
| Workflow | `GenerateFASTQ` |
| Library Prep Kit | 空白 |
| Index Kit（i100 のみ） | 空白 |
| Description | 空白 |
| Chemistry | `Amplicon` |
| adapter | `CTGTCTCTTATACACATCT` |
| AdvancedSetting1 | `123` |
| [Reads] | `301` / `301` |

日付は `YYYY/M/D` 形式で出力します。`2026-08-18` と入力しても `2026/8/18` に正規化されます。

### [Data]

| 項目 | 入力方法 |
|---|---|
| Sample_ID | リストを貼り付け（1行1件） |
| Sample_Name（i100 のみ） | Sample_ID 入力時に自動で同じ値が入り、その後に個別修正が可能 |
| Description | リストを貼り付け（1行1件）／全行への一括入力ボタンあり |
| Sample_Project（i100 のみ） | 既定は空白 |

各入力欄の左には **行番号** が表示され、スクロールに追従します。

## サンプル名の末尾に文字列を追加

行範囲を指定して、末尾に任意の文字列をまとめて追加できます。

- **対象**: Sample_Name / Sample_ID / Description（MiSeq タブは Sample_ID / Description）
- **行**: 開始行 〜 終了行（入力欄の行番号を参照）
- **追加する文字列**: 例 `_16S`

例えば行 1〜8 に `_16S` を追加すると `Demo-Reef-01` → `Demo-Reef-01_16S` になります。

**「付与前に戻す」** は、その列に対して **最初に追加を行う前の状態** へまとめて戻します。
複数回追加していても一度の操作で元の状態に復元されます（1操作ずつの取り消しではありません）。

## 出力

- **CSV出力**: `SampleSheet_MiSeq-i100_YYYYMMDD.csv` / `SampleSheet_MiSeq_YYYYMMDD.csv`（CRLF 改行、BOM なし）
- **クリップボードにコピー**: CSV 全文をコピー
- **CSVプレビュー**: 保存前に生成内容を確認

## 検証機能

作成時に以下を自動チェックします。不足や行数不一致はエラー、その他は結果表の下に「確認事項」として表示されます。

- Index の件数がサンプル数に足りているか（不足はエラー）
- 複数の範囲ブロック間で index が重複していないか（重複はエラー）
- Sample_ID と Description の行数一致（不一致はエラー）
- Index の余剰（警告）
- Sample_ID の重複（警告）
- index / index2 の組み合わせ重複（警告）

## ディレクトリ構成

```
.
├── index.html              # UI（MiSeq i100 / MiSeq / index 一覧 の3タブ）
├── assets/
│   ├── styles.css
│   └── favicon.svg
├── src/
│   ├── udi-data.js         # UDI index データ（xlsx から生成・自動生成物）
│   ├── sheet.js            # set展開・行構築・CSV生成のロジックコア
│   └── app.js              # UI レイヤー
├── tests/
│   └── sheet.test.mjs      # ロジック検証（30件）
├── .github/workflows/test.yml
├── vercel.json
├── package.json
├── .gitignore
└── LICENSE
```

## ローカルでの確認

ES Modules を使うため、`file://` で直接開かずローカルサーバー経由で開いてください。

```bash
npm run dev            # npx serve .  → http://localhost:3000
# または
python -m http.server 8000
```

テスト（Node.js 18 以上）:

```bash
npm test
```

## GitHub → Vercel へのデプロイ

```bash
cd samplesheet-generator-web
git init
git add .
git commit -m "feat: SampleSheet作成ツール（MiSeq i100 / MiSeq 対応）"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/samplesheet-generator-web.git
git push -u origin main
```

1. [vercel.com](https://vercel.com) にログイン → **Add New… → Project**
2. 対象リポジトリを **Import**
3. Framework Preset は **Other**（`vercel.json` によりビルドは実行されません）
4. Root Directory はリポジトリ直下のまま → **Deploy**

## 検証済み項目（`npm test` / 全30件）

- UDI データの構造（4セット × 2側 × 12グループ × 8件 = 768 index）
- 開始/終了を別指定した set 範囲の展開結果が仕様の例と一致
- セットをまたぐ範囲展開（set1-1-10 〜 set2-1-3 = 48件、set1-1-1 〜 set4-1-12 = 384件）
- 複数の範囲ブロックの連結順序、空欄のスキップ、範囲間の index 重複検出
- 複数セットにまたがるシート作成（97件目が set2-1-1-1 / P7126 になること）
- set名列の有無による列構成の切り替え（i100: 8列⇔10列、MiSeq: 6列⇔8列）
- MiSeq i100 / MiSeq の CSV 構造が既存シートと一致（区切り行のカンマ数も含む）
- 接尾辞付与の対象行・件数と異常系、複数回適用してもベースラインが不変であること
- 日付の正規化と異常系、Sample_Name の自動反映と個別修正の優先

## ライセンス

MIT License
