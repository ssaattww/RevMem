# PR #115 実装・検証 report

## 対象と結論

- Repository: `ssaattww/RevMem`
- PR: #115
- Branch: `refactor/source-layout-ci-vsix-version`
- Base/main: `dbaee5dc84b2a98f9da895616dddfda810dbb143`
- Base Git tree: `f99ea5f6106f20b48a6226cbf82616a4ba520cac`
- 今回の再開時HEAD: `fb704d9641330009a215af75abe7bd5291b95f45`
- 検証済みtechnical HEAD: `afa25c7e691690149b234fd8ead9ec8d69e1e992`
- Technical HEADのcommit/push: 完了
- Technical HEADの正式CI: `pull_request` run **34032769138** / job **101485280913**、`completed / success`
- 検証経路: **remote_ci_only**。ローカルでは補助的な実行が可能だが、repository指定依存関係によるfull gateは実行できない。

指定された2点の実装は、この1つのPRに反映した。全CIゲートの成功と、ダウンロードした実VSIXの版番号・起動先・source ZIPを確認した。独立レビューは実施しておらず、mergeも行っていない。

このreportとhandoffを保存するとPR HEADが変わる。本書が記録する成功は上記technical HEADに対する証拠であり、後続HEADの成功を代用しない。文書公開後の最終HEAD、対応するPR CI run、最終成果物、コメントの保存結果はPR本文・完了コメントに記録する。文書生成時点のpublication状態は `commit_pending / push_pending / ci_wait_pending`、administrative parentはtechnical HEADである。未生成の自分自身のcommit SHAは本書へ記入しない。

## 要求・根拠・非対象

ユーザー要求は、(1) `src`直下のタスク番号付きソースを適切な責務のフォルダ・名前にすること、(2) PR CI成果物のVSIX版を分岐元mainの版＋PR HEAD先頭7桁にすること、の2点。小さい論理単位でpushし、GitHub操作はコネクタを使用する。

根拠はユーザー指示、`AGENTS.md`、アップロード済みworker Skills、`doc/design/source-layout-and-ci-vsix-version.md`、PR #115の開始記録。詳細設計・移動表は同design、利用者向け変更はREADMEと`Design/BreakingChanges.md`に保存済み。

Review stateのschema、command ID、設定既定値、公開symbol名、レビュー状態同期の振る舞いは変更しない。main/release用`.github/workflows/release-vsix.yml`の版管理は変更しない。テスト名のT番号やテスト内の仮想fixture名は移動対象ではない。

## 実装

### 1. Production sourceの配置

旧`src/t*.ts` 20件を削除し、同じ実装を以下の責務へ移した。task-named互換モジュールは残していない。

| 責務 | 移動先 |
| --- | --- |
| 文書open/startup lifecycle | `src/application/global-understanding/document-open-lifecycle.ts`、`startup-document-observation.ts` |
| repository URI解決 | `src/application/repository-path/repository-root-uri.ts` |
| 選択context依存projection、repository判定 | `src/application/review-context/projection-refresh.ts`、`repository-resolution.ts` |
| PR review projection、repository選択 | `src/application/review-contexts/pull-request-review-projection-notifier.ts`、`pull-request-review-projection-sync.ts`、`repository-selection-cancellation.ts`、`repository-selection.ts` |
| 拡張機能composition | `src/composition/extension.ts` |
| Current Context Git composition | `src/composition/current-context/git-context-inspection.ts` |
| Global composition/source | `src/composition/global-understanding/global-understanding-composition.ts`、`global-understanding-source.ts` |
| Local base/head composition | `src/composition/local-git/local-base-head-runtime.ts` |
| PR composition | `src/composition/pull-request/new-pull-request-global-composition.ts`、`owner-pull-request-synchronization.ts`、`pull-request-review-runtime-base.ts`、`pull-request-review-runtime.ts` |
| Review Contexts composition | `src/composition/review-contexts/review-contexts-runtime.ts` |
| Current Context表示identity | `src/ui/current-context/root-scoped-candidate-identity.ts` |

`package.json.main`は`./dist/composition/extension.js`。既存`src/extension.ts`はbase activationとして残る。呼び出し側、動的import、test helper、sourceを直接読むテスト、型契約fixture、path-scoped ESLint設定を追従した。

分岐元source archiveのGit treeを再計算し、GitHub上のmain tree `f99ea5f6106f20b48a6226cbf82616a4ba520cac`との一致を確認した。そのsourceと移動後sourceを照合した結果、productionの差分23件は20件の移動と3件の既存caller更新であり、module参照パス置換以外の差分はなかった。GitHubのbase/technical HEAD比較でも20件がrenameとして認識された。technical HEADの差分は文書保存前で74 files、+687/-235。

### 2. CI VSIXの版と出所

`tools/resolve-ci-vsix-version.mjs`がPR HEADとbaseの一意なmerge-baseを求め、そのfirst-parent ancestry上の最寄りの有効なversion tagを使う。tagがなければ分岐点の`package.json.version`を使う。PR側manifestや後続mainの未取り込みcommit、run number、GitHubの一時merge SHAは版の根拠にしない。

版はbase versionに`+`とHEAD先頭7桁を付加する。既存build metadataがある場合は`.`と7桁を追加する。先頭ゼロを保持し、不正SHA、不正版、checkoutとHEADの不一致、曖昧な分岐点・同一点の異なる版tagは拒否する。分岐点はCI eventのHEAD/baseから計算するため、mainのmergeやrebaseを取り込んだ場合は分岐点が変わり得る。

CIはPR HEAD自体をfull-historyでcheckoutする。`vsce package`へ版と`--no-git-tag-version --no-update-package-json`を渡し、tracked manifestの変更がないことを検査する。成果物名、`extension/package.json.version`、`extension.vsixmanifest`のIdentity Versionを一致させ、package entryの存在も検査する。source ZIPは同じHEADを`git archive`したもの、`version.json`にはfull HEAD/base/branch-point SHAと版の出所を保存する。

## 今回の再開で追加したcommit

| Commit | 変更と保存内容の確認 |
| --- | --- |
| `b0748d431a8da37a928f9eea86054a5127bc681c` | T607の3行のimport先だけを変更。full blob `40780050c972948b3803d991d34f9ecaef1e36f1`を計算値・保存値で照合 |
| `7c301da8e0beba1e13cbac2cee9c4c641aa03400` | T610のimportと8箇所のsource-reading path、計13行だけを変更。full blob `da3eddd8a6af9886984d4d9dca0c0adfadb9e76f`を照合 |
| `afa25c7e691690149b234fd8ead9ec8d69e1e992` | ESLint設定から削除済み旧ファイルの指定1行を除去。移動先の既存ruleは保持。blob `9a683d7367509a8b7a6a0a376331e6504a7bd566` |

各commitを別々にpushした。大きいテストファイルは全文blobのhash一致を確認してからtree/commitへ使用した。未アップロードblobを指定した422はblob作成で解消し、コネクタ全体の書き込み不可とは扱っていない。force push、CIを利用したコード書き換え、別PRへの分割は行っていない。

## TDDと失敗診断

開始時点のPR記録には配置契約3件を実装前に追加してRedを確認したことが記録されている。今回の再開では、当時current HEADだった`fb704d9641330009a215af75abe7bd5291b95f45`に一致するrun **34030676487**の失敗を直接確認した。tooling 15件は成功したが、Unit内のTypeScript compileがT607/T610の旧importとその派生診断で失敗していた。失敗後に上記2ファイルの参照だけを更新した。

診断artifact **9988489010**、`ci-failure-diagnostics-34030676487-1`をコネクタ経由で取得した。SHA256は`5de3605cc6c55ce9aed5418c7b0d6b1920efe569efb4d6b6877a61e73d237e27`。artifact metadataのfull head SHAとPR HEADを照合した。

`.github/workflows/ci.yml`には開始時から診断保存が存在したため、重複workflowは追加していない。`tools/run-ci-command.mjs`がcommand result JSON、stdout、stderr、combined logを記録し、失敗時は環境情報、git status、generated-file一覧、source/test/型fixtureなどを保存する。新しい版解決・VSIX作成・source archive・manifest検査も同じrunnerで実行する。

## 検証結果

### 正式CI

technical HEAD `afa25c7e691690149b234fd8ead9ec8d69e1e992`とrun `head_sha`が一致する`pull_request` run **34032769138**、job **101485280913**が**success**で完了した。CI定義blobは`3d63fcaa957fbfc09587a5e53bf151ec029f3f34`。

成功したゲートは、依存関係導入、Build、contract typecheck、architecture positive/negative、lint、unit/tooling、T602/T603、T403/T404/T405/T406、Issue #106/PR108、T304、T502/T503/T504/T505、T506（Extension Hostを含む）、T604/T605/T606、T609とExtension Host、T610、temporary Git、mock GitHub、VS Code Extension Host、版解決、packaging、manifest検査、成果物upload。

実行commandの正本は上記blobのworkflowと同HEADのpackage scriptsである。中間HEADの成功やpush eventのrunを最終PR HEADの成功として流用しない。

### 実成果物の照合

artifact **9989235604**、`review-range-user-validation-0.1.52-pre+afa25c7`をコネクタ経由でダウンロードした。SHA256は`48ad531e475ab9ee4334a34fd3e8c564b10945a017504447a42cda02cd9aee4d`。

確認済みの内容:

```text
version:              0.1.52-pre+afa25c7
baseVersionSource:    tag:0.1.52-pre
headSha:              afa25c7e691690149b234fd8ead9ec8d69e1e992
baseSha/branchPoint:   dbaee5dc84b2a98f9da895616dddfda810dbb143
package entry:        ./dist/composition/extension.js
VSIX package version: 0.1.52-pre+afa25c7
VSIX Identity Version:0.1.52-pre+afa25c7
```

同名VSIX、同版のsource ZIP、version.jsonの3ファイルを確認した。VSIX内にentryファイルが存在する。source側のtracked versionは元の`0.0.1-pre`のままで、旧20ファイルは存在せず、T607/T610のsource blobも上記hashと一致した。

### ローカル補助検証と制約

ローカルNodeはv22.16.0。`npm ci`は完了せず、短い再確認の`npm ping`で`registry.npmjs.org`への`EAI_AGAIN`を観測した。CI指定のNode24/依存関係による正式build、typecheck、full local gateの成功とはしていない。

| 補助確認 | 結果 | 証拠の限界 |
| --- | --- | --- |
| `node --test test/tooling/*.test.mjs` | 15/15成功 | 一時Git repositoryを使う版・配置・CI配線契約 |
| T610のemitted JSを参照追従して実行 | 44/44成功 | 診断artifactからの再現で、正式compile成功の代用ではない |
| T607を同条件で変更前/後に実行 | 両方17/20、同じ3件失敗 | CI対象外suite。下記heldとして区別 |
| source archiveのGit tree再計算 | main treeと一致 | baseline出所を確認 |
| production全ファイルの比較 | 20移動＋3callerのmodule path変更のみ | 独立レビューではなく実装者の差分検査 |

初回補助実行で発生した`.github/workflows/ci.yml`のENOENTは、failure artifactにhidden fileが含まれないローカルsnapshotの不足だった。取得済みworkflowと同一blobを補って再実行した。repository側の欠損ではない。

## Held・未実施・リスク

**H1: CI対象外T607の既存失敗。** `t607-performance-incremental-ui.test.ts`の次の3件は、main treeと一致する変更前sourceを一時transpileした実行と、移動後の補助実行で同じく失敗した。

- production VS Code Global runtime fences partial publication on invalidate and dispose
- production Global runtime supersedes old/new refreshes and gives each feedback operation one terminal
- IFR002 runs the actual Global source/recalculator and Review Contexts provider without stale publication

前2件は`OperationCancelledError`、後者はReview Contexts側のassertion失敗。baselineの一時transpileにはTypeScript5.8.3を使用した。これは指定full CIの失敗ではなく、今回のpath-only修正より前にも同条件で再現した補助検証の残件である。原因の全面調査・振る舞い修正はこの2点の依頼に含めず、テストを削除・弱体化して成功扱いにはしていない。担当・次の対応判断は利用者に残す。

**未実施:** 独立レビュー、Windows/Remote実機への手動インストール操作、Marketplace公開は実施していない。Ubuntu CIのExtension Host検証と実VSIX内検査を、これらの実施証拠としては扱わない。

**意図的に未変更:** `tasks/tasks-status.md`は別タスクの管理記録であり、指定された専用管理Skillsを使わず変更していない。release workflow、tracked package version、state schema、public command/setting/symbol、T607の既存assertion、過去のreport/handoffは保持した。

## 公開と次の操作

保存先は本reportおよび`handoffs/pr-115-source-layout-ci-vsix-version-20260906.yaml`。文書公開後のcurrent HEADに一致するPR CIを再確認し、実成果物の版を検証してからPR本文・簡易reportコメントに記録する。これは独立レビュー後のattestationではなく、実装reportの通常保存である。

ユーザーが次のレビューとmergeを判断する。workerはmergeしない。
