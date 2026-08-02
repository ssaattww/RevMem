# T304 Fix Verification 指摘対応 R2 レポート

## 1. 対象

- Repository: `ssaattww/RevMem`
- Pull Request: #38
- Task: T304 PR Progress Tree View
- Branch: `task/t304-pr-progress-tree`
- Fix verification対象HEAD: `580671ab642cfa43216d06118af7b3b0fb6061c8`
- Fix verification evidence HEAD: `9b29b978505255790594eaa412bc7374c6f08cba`
- Fix verification report: `reports/issue-1-t304-fix-verification-20260802221700.md`
- 対応finding:
  - `T304-R1-P1 / high`
  - `T304-R1-P2 / high`
  - `T304-R2-P1 / medium`
- 既にclosedのfinding: `T304-R1-P3 / medium`
- 技術実装HEAD: `4139b7538b0051ec21f30de1c9ddffff86469cd3`

## 2. 作業開始時の診断workflow確認

`.github/workflows/ci.yml`には作業開始時点で次のfailure diagnosticsが存在したため、workflow追加は不要だった。

- 各commandの標準出力・標準エラーを`2>&1 | tee test-output/ci/*.log`へ保存
- Node/npm/runner/SHA/ref、Git status、生成物一覧を保存
- `test-output/`、`dist/`、`test-dist/`、`src/`、`test/`、`tools/`、`type-fixtures/`、manifest、lockfile、設定、workflowをfailure artifactへ保存

本対応のRed runでも同workflowによるartifactを確認した。

## 3. Finding対応

### 3.1 T304-R1-P1 — added/deletedの不存在side

#### 問題

従来の`PullRequestProgressTreeDiffTarget`はadded fileのoriginal側とdeleted fileのmodified側を、存在しないcommit/pathの通常Git documentとして表現していた。T302 content providerでは`missing-file`となり、TreeからT303 controllerへそのまま渡してdiffを開けなかった。

#### 対応

- Treeのdiff sideを次のdiscriminated unionへ変更した。
  - `present`: 対象revisionに実在するGit blob
  - `absent`: 対象revisionにfileが存在せず、immutable empty documentとして表示するside
- added file:
  - original=`absent`
  - modified=`present`
- deleted file:
  - original=`present`
  - modified=`absent`
- diff documentのrevision sourceへ`empty`を追加した。
- `ReviewDiffUriCodec`は`empty` sourceをcanonical URIとしてencode/decodeする。
- `ReviewDiffEditorController`はabsent sideを`revisionSource: "empty"`へ変換する。
- `RevisionTextContentProvider`は`empty` descriptorに対して外部sourceを呼ばず、決定的に空文字列を返す。
- revisionにはcomparisonのfull base/head SHAを保持し、context・side・path・revisionのURI identityを維持する。

#### 回帰test

Tree選択から`ReviewDiffEditorController`、URI codec、`RevisionTextContentProvider`まで接続したtestを追加した。

- added: `""` → `"added\n"`
- deleted: `"deleted\n"` → `""`
- external Git content sourceはpresent sideだけで呼ばれる
- nonexistent pathをGit sourceへ問い合わせない

### 3.2 T304-R1-P2 — encoding対象外とT301進捗の整合

#### 問題

T301のraw resultはencoding対象外を知らず、変更行を持つfileには`totalLineCount = additions + deletions`を返す。一方、従来のT304 providerはunsupported fileの入力countが既に0であることを要求したため、raw T301 resultをそのまま受け取れなかった。

#### 対応

`PullRequestProgressTreeDataProvider.replaceSnapshot`をauthoritative projection境界とした。

1. `snapshot.progress`はraw validated T301 resultとして受理する。
2. raw file/aggregate count・ratioの整合を先に検証する。
3. `lineReviewabilityByFileId`を適用する。
4. binary、invalid encoding、unsupported encodingのfileをeffective progressでは次へ変換する。
   - `reviewedLineCount = 0`
   - `totalLineCount = 0`
   - `progress = 1`
5. rawの`additions`、`deletions`、path、status、exclusion reasonは保持する。
6. reviewable fileだけからeffective aggregateの分子・分母・率を再計算する。
7. `getEffectiveProgress()`でT305/Status Bar等が同じauthoritative effective progressを利用できる。

これによりcallerがT301 resultを改変せず、T304 projectionがline-review availabilityを唯一の追加証拠としてPR分母を決定する。

#### 回帰test

- invalid UTF-8 file: additions 2、deletions 1、raw total 3
- reviewable file: raw/effective total 2、reviewed 1
- encoding対象外node:
  - additions 2、deletions 1を表示用に保持
  - reviewed 0、total 0、progress 1
  - 理由を表示
- effective aggregate:
  - reviewed 1
  - total 2
  - progress 0.5

### 3.3 T304-R2-P1 — public consumer contract fixture

次を行う`type-fixtures/contracts/t304-pr-progress-tree.fixture.ts`を追加し、contract tsconfigへ登録した。

- `src/ui/pr-progress` public barrelからsnapshot、reviewability、present/absent side、diff target、host、providerをimport
- 正常snapshot、unsupported reason、present/absent diff targetをconsumer側でconstruct
- `replaceSnapshot`と`getEffectiveProgress`をconsumer APIとして使用
- compile-time rejectionを固定:
  - snapshot identity欠落
  - 未知reviewability discriminant
  - unsupported reason欠落
  - absent sideのpath欠落

`typecheck:contracts`は本fixtureを実行し、技術HEADのCIで成功した。

## 4. TDD証跡

### Red

- Test/fixture最終HEAD: `ec493bc682bdb7d5a181c75055e382707e92aeaa`
- Exact-head workflow run: `30750333643`
- Job: `91503128102`
- Conclusion: failure
- Failed step: Contract typecheck
- 主なfailure:
  - `PullRequestProgressTreeDiffSide`に`kind`が存在しない
  - `PullRequestProgressTreeDataProvider.getEffectiveProgress`が存在しない
- Diagnostic artifact:
  - ID: `8834227607`
  - Name: `ci-failure-diagnostics-30750333643-1`

テスト・fixtureを先に追加し、production未実装による失敗を確認した。

### Green

- 技術実装HEAD: `4139b7538b0051ec21f30de1c9ddffff86469cd3`
- Exact-head workflow run: `30750518751`
- Job: `91503639040`
- Conclusion: success

成功step:

- Install dependencies
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T304 PR progress tree tests
- T503 repository enumeration tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

別SHAのworkflow runは代用していない。

## 5. Commit単位

- `d90be30d75674e0759ccf18714a3f2259f6ba802`: remaining behavior findingの失敗test
- `f1ac579d5503436e5082da2bed09205c13e2ed1c`: T304 public consumer fixture
- `ec493bc682bdb7d5a181c75055e382707e92aeaa`: fixture discovery
- `01266694ef73744e124b95bca6b0e8e37482797c`: empty revision source contract
- `f7cf66872dd88ea4a06b26f787834acac13cce55`: empty source URI codec
- `3eebcf47709580e1c2c6bb55555f421fbc212bd8`: empty content provider
- `a9cd50ce8240bb21a56c13459d93f3b10348ff4e`: present/absent diff editor side
- `9911007f3b3eecc77ecdc2c93958eb85b1698dc4`: diff editor public exports
- `e11a0fe12f33ed2471d12bc98bafa8ac86813148`: effective progress projectionとabsent Tree side
- `4139b7538b0051ec21f30de1c9ddffff86469cd3`: T304 public barrel同期

## 6. 変更ファイル

- `src/application/diff-document/contracts.ts`
- `src/application/diff-document/review-diff-uri-codec.ts`
- `src/application/diff-document/revision-text-content-provider.ts`
- `src/ui/diff-editor/review-diff-editor-controller.ts`
- `src/ui/diff-editor/index.ts`
- `src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`
- `src/ui/pr-progress/index.ts`
- `test/unit/pull-request-progress-tree.test.ts`
- `type-fixtures/contracts/t304-pr-progress-tree.fixture.ts`
- `type-fixtures/contracts/tsconfig.json`
- 本report
- R2 handoff
- 前回follow-up report/handoffの訂正

## 7. Finding disposition

| Finding | Source severity | 対応状態 |
|---|---:|---|
| T304-R1-P1 | high | absent sideをimmutable empty documentとしてTree→T303→T302経路へ接続。closure verification待ち |
| T304-R1-P2 | high | raw T301 resultとreviewabilityからeffective progressをauthoritatively projection。closure verification待ち |
| T304-R1-P3 | medium | 前回verificationでclosed済み。変更なし |
| T304-R2-P1 | medium | public consumer fixtureを追加しcontract typecheck成功。closure verification待ち |

## 8. 訂正

前回report `reports/issue-1-t304-review-followup-20260802220800.md`とhandoffは、HEAD `580671ab...`のP1/P2を`addressed`と記録していた。しかしfix verificationで両findingはpartial/openと判定された。

本対応では前回証跡を削除・書換えず、訂正追記を行い、R2で残存部分を修正した事実を別reportとして保持する。

## 9. 対象外・held

- T305のVS Code TreeItem/event、Activity Bar、Current Context、Status Bar wiring
- T402のPR metadata/diff取得、encoding判定source、cache、refresh source
- 独立最終review
- merge
- `tasks/tasks-status.md`更新
  - repository指定のprogress management skillが本worker環境にないため直接更新していない

## 10. 次のaction

同じ通常reviewerが、技術HEAD以降の提出HEADについて次をverificationする。

- `T304-R1-P1` closure
- `T304-R1-P2` closure
- `T304-R2-P1` closure
- P3 closed状態の維持
- final PR HEADと一致するCI

通常findingが全てclosedするまで独立最終reviewへ進めない。mergeは行わない。
