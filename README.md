# SampleSheet作成ツール（GenerateFASTQ）

MiSeq / i100 の **GenerateFASTQ 用 SampleSheet CSV** を作成する Web ツールです。
UDI index を `set` 名で指定するだけで、I7/I5 の Index_ID と配列が自動で割り当てられます。

- ビルド不要の静的サイト（HTML + CSS + バニラ JavaScript、外部依存ゼロ）
- 処理はすべてブラウザ内で完結し、サンプル情報はサーバーに送信されません
- UI は DNA希釈計算ツール（MiSeq用）v2.2 Web版と同じ配色・構成

## 入力項目

### [Header] / [Settings]

| 項目 | 既定値 |
|---|---|
| シーケンス日付 | （未入力・必須） |
| Experiment Name | 空白 |
| Module | `GenerateFASTQ - 3.1.0` |
| Workflow | `GenerateFASTQ` |
| Library Prep Kit | 空白 |
| Index Kit | 空白 |
| Description | 空白 |
| Chemistry | `Amplicon` |
| adapter | `CTGTCTCTTATACACATCT` |
| AdvancedSetting1 | `123` |
| [Reads] | `301` / `301` |

日付は `YYYY/M/D` 形式で出力します。`2026-08-18` や `2026/08/18` と入力しても `2026/8/18` に正規化されます。

### [Data]

| 項目 | 入力方法 |
|---|---|
| Sample_ID | リストを貼り付け（1行1件） |
| Sample_Name | Sample_ID 入力時に自動で同じ値が入り、その後に個別修正が可能 |
| Description | リストを貼り付け（1行1件）／「全行に一括入力」ボタンあり |
| Sample_Project | 既定は空白 |

## Index の指定方法（set 記法）

`UDI index for runsheet.xlsx` の構造をそのまま扱います。
**1つの set ラベル（例 `set1-1-3`）= 8連チューブ1本分 = 8 index** です。

| 記法 | 意味 |
|---|---|
| `set1-1-1` | set1 の Index1(i7) 第1グループ → 8 index |
| `set1-1-1~set1-1-12` | 第1〜第12グループ → 96 index |
| `set1-1-1~12` | 上と同じ（終端の省略形） |
| `set1-1-1, set1-1-5` | 複数グループを併記（カンマ・空白・改行区切り） |

区切り文字は `~` `～` `..`、複数指定はカンマ／タブ／空白／改行のいずれでも動作します。

**指定例**: Index1 に `set1-1-1~set1-1-12`、Index2 に `set1-2-1~set1-2-12` を入力すると、
i7 は S762:TTACCGAC 〜 S733:CCACAACA、i5 は S512:CGAATACG 〜 S561:GTACCACA が
先頭のサンプルから順に割り当てられます。

`setN-M-K` の各要素は次のとおりです。

- **N**: UDI index セット番号（1〜4）
- **M**: `1` = Index1 / i7、`2` = Index2 / i5
- **K**: グループ番号（1〜12）

1セット = 12グループ × 8 index = 96 index、全4セットで 768 index を収録しています。

## 出力

- **CSV出力**: `SampleSheet_YYYYMMDD.csv` としてダウンロード（CRLF 改行、全行 8 列、BOM なし）
- **クリップボードにコピー**: CSV 全文をコピー
- **CSVプレビュー**: 保存前に生成内容を確認

## 検証機能

作成時に以下を自動チェックします。件数不足や行数不一致はエラー、その他は結果表の下に「確認事項」として表示されます。

- Index の件数がサンプル数に足りているか（不足はエラー）
- Sample_ID と Description の行数一致（不一致はエラー）
- Index の余剰件数（警告）
- Sample_ID の重複（警告）
- index / index2 の組み合わせ重複（警告）

## ディレクトリ構成

```
.
├── index.html              # UI（シート作成タブ + UDI index 一覧タブ）
├── assets/
│   ├── styles.css
│   └── favicon.svg
├── src/
│   ├── udi-data.js         # UDI index データ（xlsx から生成・手動編集不可）
│   ├── sheet.js            # set展開・行構築・CSV生成のロジックコア
│   └── app.js              # UI レイヤー
├── tests/
│   └── sheet.test.mjs      # ロジック検証（14件）
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
git commit -m "feat: SampleSheet作成ツール（GenerateFASTQ）"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/samplesheet-generator-web.git
git push -u origin main
```

1. [vercel.com](https://vercel.com) にログイン → **Add New… → Project**
2. 対象リポジトリを **Import**
3. Framework Preset は **Other**（`vercel.json` によりビルドは実行されません）
4. Root Directory はリポジトリ直下のまま → **Deploy**

## 検証済み項目（`npm test` / 全14件）

- UDI データの構造（4セット × 2側 × 12グループ × 8件 = 768 index）
- `set1-1-1~set1-1-12` / `set1-2-1~set1-2-12` の展開結果が仕様の例と一致
- 既存 SampleSheet（`SampleSheet-Generate FastQ-i100testRun.csv`）の先頭10件と index 割当が一致
- 生成 CSV の 16 行のヘッダ構造・列数・データ行がサンプルと一致
- 日付の正規化と異常系（存在しない日付・不正形式）
- Sample_Name の自動反映と個別修正の優先
- set 記法の異常系（範囲逆転・セット跨ぎ・範囲外グループ）

## ライセンス

MIT License
