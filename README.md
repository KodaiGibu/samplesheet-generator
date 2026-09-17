# SampleSheet作成ツール

**MiSeq i100 / NextSeq / MiSeq** のサンプルシート CSV を作成する Web ツールです。
機種ごとにタブを切り替えて使用し、index はいずれも UDI index の **set 指定**で割り当てます。

- ビルド不要の静的サイト（HTML + CSS + バニラ JavaScript、外部依存ゼロ）
- 処理はすべてブラウザ内で完結し、サンプル情報はサーバーに送信されません

## 機種ごとの違い

| | MiSeq i100 | NextSeq | MiSeq |
|---|---|---|---|
| フォーマット | SampleSheet v2 | 従来形式 | 従来形式 |
| セクション | `[Header]` `[Reads]` `[BCLConvert_Settings]` `[BCLConvert_Data]` `[Cloud_Settings]` `[Cloud_Data]` | `[Header]` `[Reads]` `[Settings]` `[Data]` | `[Header]` `[Reads]` `[Settings]` `[Data]` |
| CSV 列数 | 全行 5 列（固定） | 7 列（set名ありで 9 列） | 6 列（set名ありで 8 列） |
| データ列 | `Sample_ID, Index, Index2` ほか | `Sample_ID, Sample_Name, Description, I7_Index_ID, index, I5_Index_ID, index2` | `Sample_ID, Description, I7_Index_ID, index, I5_Index_ID, index2` |
| Index Kit 行 | — | あり | なし |
| adapter 行 | — | なし | あり |
| Module 既定値 | — | `GenerateFASTQ - 3.1.0` | `GenerateFASTQ - 2.0.0` |
| [Reads] 既定値 | 501 / 501 | 151 / 151 | 301 / 301 |

MiSeq i100 は `FileFormatVersion 2` / `InstrumentPlatform MiSeqi100Series` で出力し、
`OverrideCycles` を空欄にすると `R1:Y{Read1};I1:I{Index1};I2:I{Index2};R2:Y{Read2}` を自動生成します。
`[Cloud_Data]` の **LibraryName** は `Sample_ID_Index_Index2` の形式で自動生成されます。

## Index の指定方法（set 記法）

**1つの set ラベル（例 `set1-1-3`）= 8連チューブ1本分 = 8 index** です。
開始 set と終了 set を別々の入力欄に指定します。

`setN-M-K` の各要素は **N**: セット番号（1〜4）、**M**: `1`=i7 / `2`=i5、**K**: グループ番号（1〜12）です。
1セット = 12グループ × 8 index = 96 index、全4セットで 768 index を収録しています。

### 入力方法の切り替え（プルダウン / 手動入力）

Index セクション上部のラジオボタンで、2つの入力方法を切り替えられます。

**プルダウンで選択（既定）**

48個の set（4セット × 12グループ）から選択します。選択肢には先頭〜末尾の Index_ID が併記されるため、
どの index が使われるか選ぶ前に確認できます。

| 選択肢の表示例 |
|---|
| `set1-1-1（S762〜S794）` |
| `set2-1-1（P7126〜P7152）` |
| `set4-1-12（7-386〜7-393）` |

終了 set で **「（開始のみ・8 index）」** を選ぶと、開始 set の 8 index だけになります。

**手動入力**

テキストボックスに直接入力します。プルダウンにはない `12` のような**番号だけの省略指定**が使えます
（例: 開始 `set1-1-1` / 終了 `12` → `set1-1-12` と解釈）。

両モードの値は内部で同期しているため、**途中で切り替えても入力内容は保持されます**。
手動入力した値がプルダウンの選択肢に存在すればその項目が選択され、存在しない場合（省略指定など）は
テキスト側に保持されたままになります。

### 範囲指定のパターン

| 開始 set | 終了 set | 展開される index |
|---|---|---|
| `set1-1-1` | `set1-1-12` | 96 件 |
| `set1-1-1` | `12`（手動入力のみ） | 96 件 |
| `set1-1-1` | （開始のみ） | 8 件 |
| `set1-1-10` | `set2-1-3` | 48 件（セットをまたぐ指定） |
| `set1-1-1` | `set4-1-12` | 384 件（全4セット） |

連続しないセットを組み合わせる場合は「＋ 範囲を追加」で行を増やしてください。
各範囲行には展開件数が表示され、範囲間で index が重複した場合はエラーになります。

### Index2 の自動入力

**「Index2 を自動入力」**（既定 ON）を有効にしていると、Index1 を選択・入力した時点で
対応する Index2 の set が自動で入ります。側（M）だけを `1` → `2` に置き換えるため、
セット番号とグループ番号はそのまま維持されます。

| Index1 | Index2 に自動入力される値 |
|---|---|
| `set1-1-1` | `set1-2-1` |
| `set3-1-5` | `set3-2-5` |

自動入力された行は淡い緑で表示されます。**自動入力後に手で書き換えることも可能**で、
一度手修正した欄は以後 Index1 を変更しても上書きされません。

## 384サンプルのテンプレート出力

各機種タブの **「384サンプルのテンプレート出力」** ボタンで、
384サンプル分のデモデータを記載したサンプルシートをダウンロードできます。

- Sample_ID: `Demo-A01`〜`Demo-D96`（4プレート × 96）
- Index1: `set1-1-1`〜`set4-1-12`（i7 384件） / Index2: `set1-2-1`〜`set4-2-12`（i5 384件）
- ファイル名: `SampleSheet_Template_MiSeq-i100_384samples.csv` など

## index 一覧の CSV 出力

「index 一覧」タブから、収録している UDI index を CSV で出力できます。

| ボタン | 出力内容 |
|---|---|
| 表示中のセットをCSV出力 | 選択中のセット・側のみ 96 件 |
| 全index（768件）をCSV出力 | 全4セット × i7/i5 の 768 件 |

## set名列の出力

結果表には **Index1_Set / Index2_Set** の列が常に表示され、各サンプルがどの set の
どのウェルの index を使っているかを `set1-1-3-5`（set-側-グループ-ウェル位置）の形式で確認できます。
CSV に含めるかどうかは「CSVにset名列を出力する」チェックボックスで切り替えます。

## サンプル名の末尾に文字列を追加

行範囲を指定して、末尾に任意の文字列をまとめて追加できます。入力欄の左には **行番号** が表示されます。
**「付与前に戻す」** は、その列に対して最初に追加を行う前の状態へまとめて戻します。

## 検証機能

作成時に以下を自動チェックします。不足や行数不一致はエラー、その他は「確認事項」として表示されます。

- Index の件数がサンプル数に足りているか（不足はエラー）
- 複数の範囲ブロック間で index が重複していないか（重複はエラー）
- Sample_ID と Description の行数一致（不一致はエラー）
- Index の余剰、Sample_ID の重複、index の組み合わせ重複（警告）

## ディレクトリ構成

```
.
├── index.html              # UI（MiSeq i100 / NextSeq / MiSeq / index 一覧 の4タブ）
├── assets/
│   ├── styles.css
│   └── favicon.svg
├── src/
│   ├── udi-data.js         # UDI index データ（xlsx から生成・自動生成物）
│   ├── sheet.js            # set展開・行構築・CSV生成・テンプレートのロジックコア
│   └── app.js              # UI レイヤー
├── tests/
│   └── sheet.test.mjs      # ロジック検証（28件）
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
git commit -m "feat: SampleSheet作成ツール（set プルダウン選択対応）"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/samplesheet-generator-web.git
git push -u origin main
```

1. [vercel.com](https://vercel.com) にログイン → **Add New… → Project**
2. 対象リポジトリを **Import**
3. Framework Preset は **Other**（`vercel.json` によりビルドは実行されません）
4. Root Directory はリポジトリ直下のまま → **Deploy**

## 検証済み項目（`npm test` / 全28件）

- UDI データの構造（4セット × 2側 × 12グループ × 8件 = 768 index）
- `setOptions` によるプルダウン選択肢（side ごとに 48 件・ラベル・すべて展開可能なこと）
- `isValidSetToken` による妥当性判定、プルダウン値からのシート作成
- `pairedSetToken` による Index2 の自動対応と、対応先がプルダウンに存在すること
- set 範囲の展開、セット跨ぎ、複数範囲の連結と重複検出
- 各機種の CSV 構造が添付シートと一致（i100 の v2 構造、NextSeq 7列、MiSeq 6列）
- 384サンプルテンプレート、index 一覧 CSV（全768件・セット単位96件）

## ライセンス

MIT License
