# PR #113 通常レビュー報告 — 早期リリース向け棚卸し

## 1. レビュー識別

- Repository: `ssaattww/RevMem`
- Pull Request: #113 `Issue #112: PR Progressの表示・確認状態・実ファイル表示を修正`
- Technical review target: `0ce2a5d0ce138d3de6e1df9659d61b34327326dd`
- Base: `main` / `c10e0d7bb202e2dbd54e8735af45bbace8829e7d`
- Branch: `codex/issue-112-pr-progress-regressions`
- Initial review findings: High 5 / Medium 3 / Low 2
- Product priority after review: **過剰対応を避け、早期リリースを優先する**

この更新では初回レビューのfinding自体は撤回しない。ただし、すべてをPR #113のリリースblockerとして扱わず、実害と今回の変更範囲を基準に「今回必須」「最小対応」「後続へ分離」に再分類する。

## 2. リリース判断

PR #113でリリース前に対応する実装範囲は、原則として `PR113-NR-002`〜`PR113-NR-005` とする。

加えて、syntax highlightingについては `PR113-NR-007` の要求を全面的なtest matrixにはせず、actual Extension Hostで `.ts` documentの `languageId === "typescript"` を確認する最小受け入れテスト1本を追加する。

`PR113-NR-001`, `PR113-NR-006`, `PR113-NR-008`, `PR113-NR-009`, `PR113-NR-010` はPR #113のリリースblockerから外し、必要に応じて後続Issue/保守作業へ分離する。

## 3. 棚卸し

| Finding | 初回Severity | 早期リリース判断 | 今回の最小対応 |
| --- | --- | --- | --- |
| `PR113-NR-001` 複数Extension Host混線の真因未確定 | High | **後続へ分離** | PR #113では追加の複数window/host調査を要求しない。実問題が再現する場合に別途root-cause調査する |
| `PR113-NR-002` stale decoration / unhandled rejection | High | **最小対応** | await後にsourceがcurrentか確認してstale publishを捨て、fire-and-forget rejectionを既存error boundaryへ接続する。大規模なAbort/generation基盤は要求しない |
| `PR113-NR-003` projection failureがcommit済みmutationをfailure扱い | High | **必須** | durable mutation結果を`applied`のまま維持し、progress失敗時も後続projectionをattemptして失敗を別報告する |
| `PR113-NR-004` PR切替後の旧working-tree node受理 | High | **必須** | 既存のcurrent-node/snapshot membership検証をworking-tree openでも通し、A→B後のA nodeを拒否する |
| `PR113-NR-005` canonical/display URI混在 | High | **必須** | identity/routing/command/session境界をcanonical URIへ統一する。テストは代表ケースへ絞る |
| `PR113-NR-006` applied操作時の二重refresh | Medium | **後続へ分離** | correctness blockerではないため今回の最適化対象にしない |
| `PR113-NR-007` actual syntax highlighting test不足 | Medium | **最小対応** | actual Extension Hostで `.ts` を開き `languageId === "typescript"` を1本確認する。全組合せmatrixは要求しない |
| `PR113-NR-008` working-tree action設計書不足 | Medium | **後続または最小文書化** | リリースを止めない。必要なら左クリックimmutable / 右クリックworking treeの区別だけ短く追記する |
| `PR113-NR-009` tasks-status未同期 | Low | **後続** | 製品動作に影響しないためリリースblockerにしない |
| `PR113-NR-010` 実装reportの証跡記述差 | Low | **後続** | 製品動作に影響しないためリリースblockerにしない |

## 4. 今回必須の修正

### 4.1 PR113-NR-003 — mutation成功とderived projection失敗を分離する

現在はdurable commit/history後のPR Progress更新がthrowすると、既に保存済みの操作までcommand failureとして返り、後続projectionも止まる。

早期リリース向けには大きなtransaction再設計を行わず、次の契約だけ満たせばよい。

1. durable mutationが成功した場合、command resultは`applied`を維持する。
2. PR Progress更新が失敗しても確認済み装飾などの後続projectionをattemptする。
3. derived projection failureは既存のOutput/error boundaryへ個別報告する。

### 4.2 PR113-NR-004 — stale working-tree nodeを拒否する

PR Aのnodeを保持したままPR Bへ切り替えた後、A nodeからAのworking-tree fileを開ける状態は誤操作につながる。

新しいgeneration frameworkは要求しない。既存providerのcurrent node membership検証を迂回せず、working-tree openでも現在表示中snapshotに属するnodeだけを受理する。

### 4.3 PR113-NR-005 — URI identityをcanonical representationへ統一する

ContentProviderだけでなく、review diffのrouting、command、pair validation、side/session resolutionでidentityとして扱うURIをcanonical representationへ統一する。

早期リリース向けtestは代表的な次の境界に絞る。

- 通常ASCII path
- 空白または日本語を含むpath
- literal `%`を含むpath

`#`、`?`、legacy、added/deleted/renamedの全直積matrixは今回の必須条件にしない。既存互換性を壊す明確な変更がある場合のみ追加する。

## 5. 最小対応

### 5.1 PR113-NR-002 — stale decoration publishを防ぐ

初回レビューではgeneration/AbortController、editor failure isolationまで要求したが、早期リリースでは過剰と判断する。

今回必要なのは次の2点に限定する。

1. `refreshReviewDiffDecorations()`開始時のsourceと、await完了後のcurrent sourceが一致しなければ結果をpublishしない。
2. fire-and-forget Promiseのrejectを既存`reportError`等へ接続し、unhandled rejectionを発生させない。

AbortControllerや汎用generation基盤は今回の必須条件にしない。

### 5.2 PR113-NR-007 — syntax highlightingの最小acceptance test

URI末尾が`.ts`であることだけでは利用者要件を直接検証していないため、actual VS Code Extension Hostでprovider経由の`.ts` documentを開き、`document.languageId === "typescript"`を確認する。

renamed/added/deletedと特殊文字の全組合せmatrixは今回要求しない。

## 6. 今回追加すべき回帰テスト

早期リリースのため、追加テストは次の5ケースを基本とする。

1. PR Progress refreshが失敗してもdurable review command resultは`applied`であり、後続decoration projectionもattemptされる。
2. PR Aから取得したnodeは、PR Bへ切替後のworking-tree openで拒否される。
3. 空白または日本語を含むpathのreview command/session routingが成功する。
4. literal `%`を含むpathのreview command/session routingが成功する。
5. actual Extension Hostで`.ts` diff documentを開き、`languageId === "typescript"`になる。

必要以上の組合せ試験や基盤刷新はPR #113の完了条件にしない。

## 7. 後続へ分離するfinding

### PR113-NR-001

初回レビューではHighとしたが、今回除去されたmodule-globalと「別VS Codeインスタンスのcontextが表示される」という現象の因果関係は確立されていない。実際の2 window / 2 Extension Host再現まで要求するとPR #113のscopeが大きく拡大する。

したがって、PR #113では現在確認できているruntime ownership修正を維持し、複数windowで問題が残る場合は別Issueで実共有境界を特定する。未再現の原因調査を早期リリースのblockerにはしない。

### PR113-NR-006

二重refreshは性能・競合増幅の問題だが、今回確認したcorrectness defectを修正した後の早期リリースを止める理由にはしない。負荷が実害になる場合に後続でrefresh ownershipを整理する。

### PR113-NR-008〜010

設計書、task tracker、既存実装reportの整合性は保守上有用だが、今回のユーザー操作の正しさを直接左右しない。リリースblockerから除外する。

## 8. リリース判定基準

PR #113は、次を満たせば初回レビューの全10 findingを完了させなくてもリリース候補として再評価できる。

- `PR113-NR-003`, `PR113-NR-004`, `PR113-NR-005` が修正済み。
- `PR113-NR-002` のstale publishとunhandled rejectionが最小修正済み。
- `.ts` actual documentの`languageId`確認テストが成功。
- 上記修正の回帰テストが成功。
- PR current HEAD SHAとworkflow runの`head_sha`が一致するCIがsuccess。

`PR113-NR-001`, `006`, `008`, `009`, `010`の未完了だけを理由にPR #113をblockしない。

## 9. CI / TDD証跡

初回技術レビュー対象 `0ce2a5d0ce138d3de6e1df9659d61b34327326dd` と一致するCI run `33931083888` はsuccessだった。

レビューreport追加後のHEAD `98524447f8a141213e89b8769f31513362e82859` と一致するCI run `33936409654` もsuccessだった。

Issue #112の最初のtest-only commit `b1c5462235ea101d68756bc991fbae0366207b01` はexact-head CI run `33699551653` でfailureとなり、failure diagnostic artifact `ci-failure-diagnostics-33699551653-1`（artifact ID `9873016053`）が保存されているため、test-first / Redの時系列は確認済みである。

この棚卸し更新後はPR HEADが変わるため、次の実装修正時には新しいcurrent HEADと一致するworkflow runのみをCI判定対象とする。

## 10. 結論

初回レビューの10 findingは調査結果として保持するが、早期リリースのためPR #113のblocking scopeを縮小する。

**今回のblocking scope:** `PR113-NR-002`〜`PR113-NR-005` + 最小`languageId` acceptance test。

**後続scope:** `PR113-NR-001`, `PR113-NR-006`, `PR113-NR-008`, `PR113-NR-009`, `PR113-NR-010`。

この方針では、誤ったファイルを開く、保存済み操作を失敗扱いする、有効なファイル名でreview commandが壊れる、古い装飾が再表示される、といった直接的なユーザー影響を先に除去し、原因未確定の複数host調査、性能最適化、文書整備はリリース後へ回す。