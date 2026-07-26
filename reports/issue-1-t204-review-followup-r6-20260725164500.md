# T204 レビュー対応 R6

## 対象

- Pull Request: #24
- レビュー: `reports/issue-1-t204-review-r6-20260725163000.md`
- 対応前HEAD: `7cd8694336a82e569d121897e5e41bfc52f74bb0`

## 対応

- unchanged fileを含む全`modifiedReviewed`について、safe integer、非負、非空半開区間、lineCount上限、sort、非重複、非隣接を検証
- `originalReviewedByDiff`について、空diff ID、negative、NaN/Infinity、非safe integer、空・逆転区間、overlap、duplicate、unsorted、adjacentを拒否
- `schemaVersion: 1`を必須化
- `fileId`、`currentPath`、`revisionId`、`updatedAt`の非空を検証
- `previousPaths`の空文字、重複、currentPath重複を拒否
- 空`contentHash`を拒否
- currentPathのsnapshot内一意性を公開API境界で検証

## TDD

- Red: `cc9eb8fc0bfd83e332ec91897e883f110bbb0e31`
- Green: `309d7cd609cb48f33633fb6fccedeb0208fc2938`
- テスト期待値修正: `076d0aba9b69b464d07f3a4acd0907884cfc5c97`

最初のGreen CI run `30147764550`は、空intervalで実装が`invalid interval`を返したのにテストが`canonical`のみを期待したためUnitで失敗した。workflowの診断artifact `8616585735`から原因を確認し、例外contractに合わせてテスト期待値を修正した。

修正後HEAD `076d0aba9b69b464d07f3a4acd0907884cfc5c97`に紐づくCI run `30147832091`はsuccess。

- Build: success
- Lint: success
- Unit: success
- Temporary Git integration: success
- Mock GitHub integration: success
- VS Code Extension Host: success

## 残作業

- R6対応差分の再レビュー
- 最終レビュー通過後のtask/phase進捗同期

マージは行わない。
