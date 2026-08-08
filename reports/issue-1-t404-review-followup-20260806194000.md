# T404 通常レビュー指摘対応レポート

## 対象

- Pull Request: #48
- Findings: T404-R001〜T404-R008
- Merge: 未実施

## 対応

- R001/R005: 独自`GitHubPullRequestContextLayer` range/path modelとroot直下JSON storeを撤去し、既存`ReviewContextState`、`FileReviewState`、`RepositoryGlobalState`を唯一のauthoritative stateとした。
- R002/R007: Node独自read-modify-write/rename実装を撤去し、T104のsame-storage-root serialization、full-snapshot CAS、flush/atomic replacementを持つ`FileSystemReviewStateRepository`へ接続した。
- R003: metadata-only更新とrevision transitionを分離した。revision変更時は`PullRequestRevisionMapper`のcomplete mapped snapshotを必須とし、identity/revision不一致をfail closedにした。
- R004: GitHub.com owner/repository case、`.git`、HTTPS default portをcanonical化し、Enterprise non-default port/caseを保持するidentity contractを追加した。
- R006: closed/merged時に状態をstore側で強制変更する処理を撤去した。lifecycleはauthoritative PR descriptorへ保存し、表示既定と明示的再有効化はT405 UI policyに委ねられる。
- R008: testsをauthoritative file ID、previous paths、modified/original reviewed ranges、Global保持、mapper必須、fail-closed、canonical identityへ更新し、`core-contracts.test.ts`経由で標準unit/full regressionへ接続した。

## TDD

レビュー指摘を固定するtest変更をproduction統合より先に設計し、authoritative state contractに沿う形へ置換した。旧testのcaller snapshot再送による偽の継続証明は削除した。

## 検証

- build
- contract typecheck
- architecture validation / negative contract
- lint
- standard unit suite（T404 testを含む）
- T404 dedicated suite
- Git/GitHub/VS Code regression

最終HEADに一致するCI runのみを最終判定に使用する。別SHAのrunは代用しない。

## 変更境界

T405のReview Contexts View、明示的layer表示切替UI、context削除表示は実装していない。T404は既存永続化基盤へのPR context lifecycle/revision統合までを担当する。
