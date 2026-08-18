# Issue #66 Global Understanding / PR Progress 修正レポート

## 概要

Issue #66 では、通常エディタで確認済みにした際に背景装飾は更新される一方、以下の表示が更新されない実機症状を調査・修正した。

- Git working tree 上の未追跡ファイルで Global Understanding が `missing` のままになる。
- 選択中 PR の通常エディタで確認済みにしても PR Progress の分子へ反映されない。
- contributed `PR Progress` View が実 GitHub PR の分母・分子を表示せず、空または `0/0` のままになる。

純粋な未追跡ファイルは対象 PR の diff に存在しないため、PR Progress の分母へ追加しない。PR Progress は設計どおり対象 PR の追加・削除行のみを数える。

## 診断 artifact workflow

作業開始時に `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を確認した。

既存 CI は失敗時に以下を artifact として保存している。

- 各 command の標準出力
- 各 command の標準エラー
- combined log
- result metadata
- environment / git status / generated file list
- `src/`, `test/`, `tools/`, generated output、主要設定ファイル

したがって Issue #66 のための workflow 追加は不要だった。

## 原因

### 1. Global Understanding の `missing`

`GlobalUnderstandingFileProgress.state === "missing"` は、現在ファイル snapshot 自体は集計対象に存在するが、同じ `currentPath` の Global state が見つからない場合に発生する。

Windows semantics では通常エディタ側の review-state identity が repository-relative path を小文字化する。一方、`T505GlobalUnderstandingSource` は filesystem enumeration と open-document evidence の path casing を保持していた。

例:

- persisted Global: `src/untracked.ts`
- Global evidence: `Src/Untracked.ts`

この差により同一 Windows filesystem file が別 path として照合され、背景装飾は保存済み state から表示できても Global Understanding は `missing` になった。

### 2. PR Progress 分子の file identity 不一致

GitHub PR diff snapshot の file ID は PR diff 側の path identity を使う一方、選択中 PR の通常エディタ session は既存 persisted state の file ID、または `repository-file:<hash>` を使う。

`calculatePullRequestDiffProgress` は diff の `fileId` で PR context state を参照するため、同じ logical path の確認済み state が別 file ID に保存されていると 0 行として扱われていた。

### 3. dedicated PR Progress View の runtime source 不一致

contributed `reviewRange.prProgress` View は base extension の `LocalBaseHeadRuntime.progress` に固定されていた。これは T306/local base-head runtime 用であり、T405 の実 GitHub PR runtime (`PullRequestReviewRuntime`) とは別だった。

Review Contexts 内では PR progress を計算できても、専用 `PR Progress` View は実 GitHub PR の snapshot に切り替わらず、分母・分子が更新されなかった。

## TDD

### 初回 RED harness correction

- HEAD: `75193368d09ce7db85425325f0b8f63a2ffe372f`
- exact-head CI: `32195859664`
- 結果: failure
- 原因: 新規回帰テストの未使用引数による lint failure
- diagnostic artifact: `9345813620`

これは挙動 RED ではなく test harness 修正として扱った。

### 挙動 RED

- HEAD: `b509d5bbeb997ae42a05aee9579bd108b02ba6d9`
- exact-head CI: `32196008193`
- job: `95900052176`
- 結果: failure
- diagnostic artifact: `9345866755`

狙った4回帰がすべて失敗した。

1. Windows Global path identity
   - actual: `Src/Untracked.ts`
   - expected: `src/untracked.ts`
2. PR progress persisted identity
   - actual: `0/2`
   - expected: `1/2`
3. GitHub PR runtime に dedicated progress tree source が存在しない
4. production composition が dedicated PR Progress View を GitHub PR runtime に接続していない

## 実装

### Global evidence path canonicalization

`src/t505-global-understanding-source.ts`

- filesystem candidate path を current filesystem semantics で canonicalize。
- Windows では canonical repository-relative path を小文字化。
- open-document evidence と immutable PR HEAD evidence も同じ path identity に統一。
- case-fold 後に重複する candidate/open/PR evidence は fail closed。
- PR exclusion policy の評価は元の validated path に対して行い、既存 policy semantics を変更しない。

### PR diff と persisted review-state identity の統合

`src/t405-pull-request-review-runtime.ts`

- persisted Context/Global state を canonical logical path で検索し、既存 file ID を authoritative identity として再利用。
- progress 計算時は persisted state を変更せず、PR diff の raw file ID へ calculation-only alias を作成して既存 core calculatorへ渡す。
- diff session も canonical path で persisted file ID を解決するため、通常エディタと PR diff editor が同じ state を共有する。
- Windows PR path も同じ case-insensitive canonical identity を使う。
- 同一 canonical path に複数 persisted file ID が存在する曖昧状態は fail closed。

### GitHub PR progress tree projection

`src/t405-pull-request-review-runtime.ts`

- `PullRequestReviewRuntime.progress` と `activateProgress(contextId)` を追加。
- immutable PR snapshot + persisted PR context から T304 `PullRequestProgressTreeDataProvider` snapshot を生成。
- binary と invalid UTF-8 は line review unsupported として既存 T304 category semantics を維持。
- active PR state 更新後は同じ context を再計算できる `refreshActiveProgress()` を追加。

### contributed PR Progress View の source switch

`src/ui/pr-progress/vscode-pull-request-progress-tree.ts`

- Tree View が最初に登録された default local base/head source を保持しつつ、選択中 GitHub PR source に切り替えられる runtime switch を追加。
- `setPullRequestProgressSource()` / `refreshPullRequestProgressTree()` を production composition boundary として追加。
- PR context を離れた場合は default source へ戻るため、既存 T306 local base/head acceptance を維持。

`src/t305-extension.ts`

- Current Context が登録済み PR の場合、`PullRequestReviewRuntime.progress` を dedicated PR Progress View の active source に設定し `activateProgress()`。
- branch/workspace 等へ切り替えた場合は GitHub PR source を解除。
- review-state command、live edit mapping、exclude policy 変更後にも active PR progress を再計算・Tree refresh。
- PR Progress 更新失敗は専用 UI error boundary で可視化。

## 回帰テスト

`test/unit/issue-66-global-pr-progress.test.ts` を追加し、default Unit suite へ接続した。

検証対象:

1. Windows path casing が異なっても Global state が `current` と判定される。
2. PR progress が canonical path で通常エディタ由来の persisted file identity を解決し `1/2` を返す。
3. PR diff session が同じ persisted file ID を再利用する。
4. GitHub PR runtime が dedicated T304 progress source を生成する。
5. production composition が selected GitHub PR source を dedicated View へ切り替える。

## 中間検証

HEAD `36158c0347fc70ec7b2765b6addc14afbe4ccd50` の exact-head CI `32196717569` では Build/typecheck/architecture/lint が成功し、Issue #66 の最初の3回帰も成功した。残った1 failure は source-switch実装前の旧composition assertionであり、diagnostic artifact `9346106650` を保存した。

## Technical Green

- HEAD: `ddc02c2c8a1f286d878f43c49a40a3300c8bbd3d`
- exact-head CI: `32196772424`
- conclusion: **success**

成功した工程:

- Build
- Contract typecheck
- Architecture validation / negative contract
- Lint
- Unit tests（Issue #66 回帰を含む）
- T602 / T603
- T403 / T404 / T405
- T304 PR progress tree
- T502 / T503 / T504 / T505
- T506 Global multi-context integration
- Temporary Git integration
- Mock GitHub integration
- VS Code Extension Host

CI判定には各時点で対象HEADと `head_sha` が一致する workflow run だけを使用した。

## 変更範囲

Production:

- `src/t305-extension.ts`
- `src/t405-pull-request-review-runtime.ts`
- `src/t505-global-understanding-source.ts`
- `src/ui/pr-progress/vscode-pull-request-progress-tree.ts`

Tests:

- `test/unit/issue-66-global-pr-progress.test.ts`
- `test/unit/core-contracts.test.ts`

Workflow / design:

- `.github/workflows/ci.yml`: 変更なし。既存 diagnostic artifact contract で十分。
- `doc/design/vscode-review-range-tracker-design.md`: 変更なし。PR Progress は対象 PR diff 行のみ、Global は repository current lines という既存設計の範囲内。
- `tasks/tasks-status.md`: 変更なし。ファイル自身が task/progress-management manager 経由のみ更新を許可しており、このworkerのwrite boundary外。

## 残留事項

- pure working-tree untracked file は対象PR diffに存在しないため PR Progress の分母には含まれない。これは不具合ではなく現行設計。
- merge はユーザーが実施するため、このworkerでは行わない。

## PR

- PR: #68 `Fix #66 Global and PR progress projections`
- Branch: `fix/issue-66-global-untracked-missing`
- Base: `main`
