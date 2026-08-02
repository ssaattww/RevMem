# T601 実装レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Task: `T601`
- Pull Request: `#33`
- Branch: `task/t601-non-git-snapshots`
- Base: `main`
- 実装検証対象HEAD: `2913e0b6de46a03dea31176dd975587d208dd408`
- 実装範囲: Git未導入・非Git workspace向けの圧縮snapshot、行差分による確認範囲追従、保守的な未確認化、保持期限・容量上限
- Merge: 実施していない

## 要件と方針

- RevMemの実装方針に従い、テストを先に追加してRedを確認してから実装した。
- CI失敗時は既存workflowがテスト結果、標準出力、標準エラー、生成物、source、設定を診断artifactへ保存することを開始時に確認した。
- snapshotはgzip圧縮し、payload SHA-256をsnapshot IDとして整合性確認に使用する。
- 行追従は行単位LCS mappingを使用し、一意に証明できない重複行変更では確認済み状態を推測せず全て未確認とする。
- snapshot欠落、破損、期限切れは全て未確認として扱う。
- 保存件数と圧縮byte上限は古いsnapshotから削除して制限する。

## 変更ファイル

- `src/application/non-git-snapshots/index.ts`
  - 圧縮snapshotの保存・復元、hash検証、期限判定、容量整理を実装。
  - 行単位mappingと曖昧性判定を実装。
  - storageを抽象化し、provider再生成後も同じ永続storage境界から復元できる契約を追加。
- `src/adapters/workspace-review-state/snapshot-tracking-workspace-review-state-session-provider.ts`
  - workspace session open時に直前snapshotを探索し、現在内容へ確認済み範囲をmappingするproviderを追加。
  - mapping成功後はContext/Globalを同一transactionで更新する。
  - command commit成功後に新snapshotを保存するcommitter wrapperを追加。
- `src/adapters/workspace-review-state/index.ts`
  - snapshot tracking providerをexport。
- `test/unit/non-git-snapshot-tracker.test.ts`
  - 圧縮round-trip、挿入行mapping、重複行曖昧性、欠落・破損・期限切れ、件数・容量整理を検証。
  - workspace provider再生成試験をfocused suiteへ接続。
- `test/unit/workspace-non-git-snapshot-tracking.test.ts`
  - providerを再生成した後、保存済みsnapshotから編集後の確認範囲を復元することを検証。
- `package.json`
  - `test:t601`を追加し、T601 core testを通常unit suiteへ追加。

## TDD証跡

### Red 1: 未実装module

- HEAD: `8f3c9cf9de9c3d878c5b5abaa745370dc66237d1`
- CI run: `30704317868`
- 結果: failure
- 原因: `non-git-snapshots` module未実装
- 診断artifact: `8819828408` (`ci-failure-diagnostics-30704317868-1`)

### Red 2: 実装初期compile

- CI run: `30704370120`
- 結果: failure
- 原因: 既存interval moduleの参照先誤り
- 診断artifact: `8819843862`

### Red 3: lint

- CI run: `30704416209`
- 結果: failure
- 原因: unused parameter、`prefer-const`
- 診断artifact: `8819858933`

### Red 4: core behavior

- CI run: `30704600364`
- 結果: failure
- 原因: 重複行曖昧性を検出できず、容量fixtureが単一snapshot上限を下回っていなかった
- 診断artifact: `8819917213`

### Red 5: provider境界

- HEAD: `85bc009321333c5c6db3d8977e39e0475d7172c4`
- CI run: `30704938885`
- 結果: failure
- 原因: provider restart test追加時点でsnapshot tracking provider未接続
- 診断artifact: `8820020395`

### Red 6: provider test wiring

- CI run: `30705080410`
- 結果: failure
- 原因: test fixture lint
- 診断artifact: `8820061533`

### Red 7: readonly fixture type

- HEAD: `002cfcdd917a4efeb15764ea1d4e2b1022d7f93c`
- CI run: `30705126118`
- 結果: failure
- 原因: readonly transaction snapshotをmutable repository contractへ代入していた
- 診断artifact: `8820076529`

### Red 8: provider behavior

- HEAD: `a76f7d668d88a8795acf60a672ae2bf52040756f`
- CI run: `30705343607`
- 結果: failure
- 原因: test clockが同一timestampを返し、同時刻snapshotの選択がfixture上不定になった
- 診断artifact: `8820141837`

## Green検証

- 実装検証対象HEAD: `2913e0b6de46a03dea31176dd975587d208dd408`
- CI run: `30705395644`
- 結果: success
- 成功gate:
  - Build
  - Contract typecheck
  - Architecture validation
  - Architecture negative contract
  - ESLint
  - Unit tests
  - Temporary Git integration tests
  - Mock GitHub integration tests
  - VS Code Extension Host tests
- unit suiteでは352件中352件成功。
- T601試験では圧縮snapshot、unique mapping、曖昧mapping、欠落・破損・期限切れ、保持制限、provider再生成後mappingが成功した。

## 意図的に変更していない範囲

- Git repositoryのrevision mappingは既存T203〜T205の責務であり変更していない。
- JSON Lines履歴はT206の責務でありschemaや保存規則を変更していない。
- task status fileは専用manager経由のみ更新可能と明記されているため、本workerから変更していない。
- mergeは利用者の責務であり実施していない。

## 残存リスク

- `NonGitSnapshotStorage`は抽象境界であり、hostが再起動を跨ぐstorage実装を注入する必要がある。今回のprovider再生成試験はstorage境界を保持した再生成を検証している。
- 重複行数が変化する編集は安全性を優先して全確認範囲を未確認化するため、保持できる行が存在しても保守的に失われる場合がある。
- LCSの計算量は行数積に依存するため、非常に大きい文書の上限・timeoutは後続の性能検証対象となる。

## 次のアクション

- PR #33を通常reviewへ渡す。
- review完了後もworkerはmergeせず、利用者がmergeを判断する。
