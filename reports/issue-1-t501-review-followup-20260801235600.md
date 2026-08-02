# T501 レビュー指摘対応レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T501
- Pull Request: #32
- Branch: `task/t501-global-state-repository`
- Base: `main`
- mode: review follow-up
- source finding report: `reports/issue-1-t501-review-20260801234800.md`
- reviewed implementation HEAD: `04675c68f648859ae90d483d138d950bc15527d4`
- 対応開始HEAD: `96791b60c09ad2429857f9825e84acb6bc4910c6`

## 対応対象

### T501-R1-P1

- source severity: `medium`
- origin: `introduced_by_change`
- disposition: `addressed`
- location: `src/application/repository-global-state/repository-global-state-repository.ts`
- 要求: range同一でも永続化対象metadata差分またはfile entry作成がある場合はno-opとして破棄しないこと。

## TDD

### Red

先に次の回帰testを追加した。

- rangeが同一でも`currentPath`がtargetと異なる場合はcommit/historyを行う
- 0行fileでcontext/Global双方にfile entryが存在しない場合は、空rangeのfile entry作成をcommit/historyする

Red HEAD:

- `deccbfe4cedc7485034988b2e9028487f5a21dd6`
- CI run: `30704930163`
- conclusion: `failure`
- failed step: `Unit tests`
- diagnostic artifact: `8820018482`
- artifact name: `ci-failure-diagnostics-30704930163-1`

追加2ケースが既存のrange-only `hasSemanticChange()`により`no-op`となることを確認した。

### 実装中の診断失敗

初回修正ではtransactionの再帰readonly snapshotをmutable contract型で受けたためBuildが失敗した。

- HEAD: `e57314565bf00a46e47fa689b9b5314e8892bd39`
- CI run: `30705100120`
- conclusion: `failure`
- failed step: `Build`
- diagnostic artifact: `8820067379`
- 原因: `previousPaths`、`reviewed`等のreadonly配列をmutable field型へ代入できないTypeScript型不一致

比較関数の入力型を`ReviewStateTransaction`のexpected snapshotから導出する形へ修正した。

### Green

- implementation HEAD: `6920ffb42fcec7084000d2f80d97e8d04e9eff09`
- CI run: `30705148733`
- conclusion: `success`

成功したgate:

- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

CI判定には各HEADと完全一致するrunだけを使用し、別SHAのrunは代用していない。

## 実装内容

`hasSemanticChange()`をrangeだけの比較から、target fileの永続化対象state比較へ変更した。

Context fileで比較するfield:

- `schemaVersion`
- `fileId`
- `currentPath`
- `previousPaths`
- `revisionId`
- `modifiedReviewed`
- `originalReviewedByDiff`
- `contentHash`
- `lineCount`

Global fileで比較するfield:

- `fileId`
- `currentPath`
- `revisionId`
- `reviewed`
- `contentHash`

`updatedAt`だけが異なる場合は従来どおりsemantic no-opとする。expectedまたはnextのfile entryが片側だけ存在する場合はsemantic changeとしてcommitする。

## 変更ファイル

- `test/unit/repository-global-state-repository.test.ts`
  - metadata差分とfile entry作成のRed testを追加
- `src/application/repository-global-state/repository-global-state-repository.ts`
  - target fileの完全な永続化対象metadata比較へ変更
- `reports/issue-1-t501-review-followup-20260801235600.md`
  - 本レポート

## 意図的に変更していない範囲

- `doc/design/vscode-review-range-tracker-design.md`: 既存のatomic context/Global更新とno-op方針の範囲内であり恒久仕様変更なし
- `.github/workflows/ci.yml`: 必要なfailure diagnostics artifactが既に保存される
- `tasks/tasks-status.md`、`tasks/phases-status.md`: review通過前の進捗同期は行わない
- T502以降のGlobal mapping、表示優先順位、理解率、UI
- merge

## 残存リスク

- 本workerは自身の修正に対する独立review verdictを出していない。
- source finding `T501-R1-P1`は同じnormal reviewerによるfix verificationが必要。
- report/handoff追加後はPR HEADが変わるため、最終HEADと一致するCIを別途確認する。

## 次のアクション

- 最終PR HEADと一致するCIを確認する。
- PRへ簡易対応報告を投稿する。
- 同じnormal reviewerが`T501-R1-P1`（medium）のfix verificationを実施する。
- mergeは利用者が行う。
