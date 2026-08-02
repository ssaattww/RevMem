# T502 レビュー指摘対応 report r2

## 対象

- PR: #37
- 指摘: `T502-REV-003 high`
- verification report: `reports/issue-1-t502-fix-verification-20260802221000.md`

## 原因

通常エディタ装飾modelは`PullRequestDiffSnapshot`のcontext/base/head identityだけを確認し、hunk統計、座標、重複、完全性を検証していなかった。このため`additions > 0`かつ`hunks: []`のincomplete snapshotを変更なしとして扱い、other-contextまたはGlobal装飾を表示できた。

## TDD

### Red

- test commit: `5e1af9b97a39e4fa1fd2c5af314fd4d95d8a33f8`
- workflow run: `30749763351`
- conclusion: failure
- 追加ケース:
  - additions統計が存在するのにhunkが空
  - addition座標が重複

### 実装

`createNormalEditorDecorationModel`のPR差分証拠判定で、T301のauthoritative validatorである`calculatePullRequestDiffProgress`を再利用した。

- identity一致後にsnapshot全体をvalidation
- status/path matrix、統計、hunk body/header、座標、重複、line extent、state identityを検証
- validation例外時はlower-priority layerをfail-closed
- current contextのcertain rangeだけは維持
- validator用除外policyは明示的空設定とし、除外fileでも構造validationを省略しない

### Green

- implementation HEAD: `bd0c322e268770ae40da5496704ff7323eb9b65d`
- exact-head workflow run: `30749879026`
- conclusion: success

成功工程:

- Build
- Contract typecheck
- Architecture validation / negative contract
- Lint
- Unit tests
- T502 focused tests: 7 / 7
- T503 focused tests
- Temporary Git integration
- Mock GitHub integration
- VS Code Extension Host

## 診断artifact

実装途中のHEAD `163825f8f3d1b89fe12f3650cf2115a3ef210495`では、既存正常系fixtureのzero-count insertion anchor誤りを検出した。

- run: `30749813082`
- artifact: `8834065218`
- 対応: validatorを緩和せず、fixtureの`oldStart`を設計contractどおり`0`へ修正

## 変更file

- `src/application/editor-decoration/normal-editor-decoration-model.ts`
- `test/unit/global-review-mapping-display-priority.test.ts`

## 未対応

なし。`T502-REV-003`の同一reviewerによるclosure verification待ち。

mergeは実施していない。
