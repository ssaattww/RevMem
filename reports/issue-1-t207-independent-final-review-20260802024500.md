# T207 独立最終レビュー

## メタデータと対象 identity

- report type: independent final review report
- review mode: `independent final review`（T207 reviewer 2/2、今回 1 回だけ）
- reviewer independence: T207 の実装、review follow-up、通常 review / fix verification に参加していない fresh reviewer。nested agent は使用していない
- repository: `ssaattww/RevMem`
- issue/task: Issue #1 / T207 temporary Git repository 統合試験
- branch: `task/t207-git-history-integration`
- base: `de21d050b3f82438c1962d0326664057fb8ee1d2`
- reviewed implementation HEAD: `388daee5764472fe01f47bbf2a8ad5b450c7d7fe`
- reviewed range: `de21d050b3f82438c1962d0326664057fb8ee1d2..388daee5764472fe01f47bbf2a8ad5b450c7d7fe`
- reserved report path: `reports/issue-1-t207-independent-final-review-20260802024500.md`
- persistence mode: repository report / failed-review handoff。technical verdict は上記 implementation HEAD にだけ適用し、report-attestation commit は許可しない
- verdict: `fail`
- report_attestation_allowed: `false`

## 目的・scope・authority

- T207 終了条件、`tasks/tasks-status.md:218-224` の AC-07〜AC-10 / AC-12、`tasks/phases-status.md:28-34` の P2 終了条件、`doc/design/vscode-review-range-tracker-design.md` rev4 の確実性原則、変更追従、file-state snapshot、rename/copy/delete、branch context、Global、履歴、integration test 方針を authority とした。
- base..HEAD の全 15 changed file と全差分を確認した。production 変更は `document-review-state-session-provider.ts`、`git-context-revision-mapper.ts`、`git-file-state-transition.ts`、`validated-git-file-state-transition.ts`。test / workflow contract、temporary-directory helper、reports、tracking も確認した。
- 通常 review、review follow-up、fix verification は finding continuity と validation evidence として読んだが、結論を追認せず独立に production path と test oracle を評価した。
- 対象外: finding 修正、Issue #28 修正、他 report / tracking / design / workflow / implementation の変更、commit、push、PR、merge、release、2 回目の独立 review。

## Required findings

### T207-IFR-P1 — high — introduced_by_change

- location: `src/core/git-diff/validated-git-file-state-transition.ts:392-419`（関連 contract: `src/application/review-context/git-context-revision-mapper.ts:666-680`）
- description: `validateFullTextEvidence()` は T207 fix で source `FileReviewState.lineCount` との比較を削除した。new 側は VS Code `lineCount` と optional physical count を二重検証する一方、old 側は取得本文を hunk 再構築へ使うだけで、保存 snapshot の editor line count と一致することを確認しない。
- impact: design 10.3.3 の「old/new 完全文が revision、path、line count、hunk と一致する場合だけ無視設定の同値性を認める」に反する。stale / legacy / 不整合な source snapshot を証拠として受理し、`ignoreWhitespaceChanges` または `ignoreEolChanges` 使用時に確認済み範囲を誤って継承できるため、AC-07 / AC-08 / AC-10 と確実性原則を破る。
- evidence: focused read-only probe で source state `lineCount=2`、実際の `oldText="a"`（VS Code line count 1）、1 行 whitespace rename diff を与えたところ、例外にならず `accepted=true`、reviewed `[0,1)` が維持された。新規 `textDocumentLineCount()` は new metadata にだけ適用され、old state lookup 自体が現在の関数から消えている。
- required action: old path の source state を一意に解決し、`textDocumentLineCount(oldText) === oldState.lineCount` を必須にする。必要なら physical count は別 evidence として扱い、不一致時は transition を reject または保守的に未確認化する。terminal EOL、empty、no-terminal と stale old lineCount の Red/Green assertion を追加し、同じ通常 reviewer が確認する。

### T207-IFR-P2 — high — introduced_by_change

- location: `src/adapters/document-review-state/document-review-state-session-provider.ts:538-580`（downstream: `src/core/review-state/review-state-service.ts:319-345`、oracle gap: `test/integration/t207-git-history.integration.test.ts:211-228,275-298`）
- description: branch 復元で context と owner-wide Global に同じ current path の別 file ID があると、新ロジックは context ID を即時返し、Global の競合 entry を移行・削除・reject しない。後続 review transaction は target ID の Global entry を spread-add するため、同じ path を持つ 2 file ID を完全 snapshot に保存できる。
- impact: branch / rename / copy / delete 後の Global identity と reviewed range が target session から不可視になり、その後の mark/unmark が別 ID だけを更新する。古い Global range の残留、同一 path の重複 identity、別 context での再採用を許し、context / Global の一貫性、AC-12、state/history/restart 整合、確実性原則を破る。履歴は target ID の操作だけを記録するため、残留 Global entry と audit evidence も対応しない。
- evidence: focused read-only probe で context `{A -> same.txt}`、Global `{B -> same.txt}` を入力すると resolver は `A` を選択した。その session 相当の `markReviewedRanges()` は成功し、next Global keys は `[B,A]`、両 entry の `currentPath` は `same.txt`、reviewed は B=`[1,2)`、A=`[0,1)` と分裂した。T207 integration test は branch 復元後の context ranges と restart 後の context file を assert するが、Global の key/path 一意性、Global ranges、操作後の persisted complete snapshot、対応 history event を assert していない。
- required action: context / Global の path-to-ID 不一致を atomic mapping / reconciliation で 1 つの stable identity へ統合するか、確実に統合できない場合は reject / 未確認化する。旧 Global key を残したまま target key を追加してはならない。同一 path 別 ID の branch 往復から mark/unmark、restart、history までを production composition test で固定し、通常 reviewer が本 finding を確認する。

## Coverage dispositions

- requirement / design / AC-07〜AC-10 / AC-12 conformance: `checked_finding`（P1、P2）
- correctness and edge cases: `checked_finding`（stale old lineCount、context/Global identity collision）
- scope discipline / unrelated changes: `checked_no_finding`
- complete changed-file set and direct dependencies: `checked_finding`
- API / data / persistence / configuration / workflow / compatibility: `checked_finding`（internal metadata API の JSDoc は妥当、breaking external API はなし。ただし persisted identity invariant が P2 で破れる）
- error handling and failure diagnostics: `checked_finding`（P1/P2 とも reject すべき不整合を成功扱い）
- security / secret handling: `checked_no_finding`
- tests and assertion effectiveness: `checked_finding`（主要 lifecycle は実行されるが、P1/P2 の negative oracle と Global complete-snapshot assertion がない）
- current-HEAD CI: `checked_no_finding`（run `30704500271`、head SHA=`388daee5764472fe01f47bbf2a8ad5b450c7d7fe`、completed/success。configured gate の成功は P1/P2 の未収録 case を否定しない）
- reports / tracking accuracy: `checked_finding`（通常 finding の closure 証跡自体は保持されているが、独立 finding により blocker なし / pre-freeze 完了主張は受理不能）
- regression / maintainability: `checked_finding`
- coding standards: `checked_no_finding`。変更 public API `GitNewFileStateInput.physicalLineCount` は JSDoc、命名、visibility を確認。nested-agent 禁止により reviewer 自身が検査した
- breaking changes record: `not_applicable`（外部 contract / format の意図した破壊的変更なし）
- held: Issue #28 の Windows POSIX fixture failures。既知 owner 保持・T207 本筋外の non-blocking held
- unexplored: 必須 criterion なし

## Validation assessment

- `npm run test:t207`: 1/1 pass（frozen HEAD、reviewer focused run）。scenario は edit/commit mapping、branch 分離、unique rename、copy 非継承、delete、restart、主要 history payload を通るが、上記 negative / Global invariants は検証しない。
- `git diff --check de21d050b3f82438c1962d0326664057fb8ee1d2..388daee5764472fe01f47bbf2a8ad5b450c7d7fe`: pass。
- exact-head CI: run `30704500271`、completed/success。full configured suite は再実行せず matching CI を再利用した。
- focused probes: P1 は不一致 old lineCount の full-text evidence が accepted、P2 は同一 path の Global key 重複が transaction output に生成されることを確認した。どちらも repository source を変更しない read-only probe。
- Issue #28: held。Windows local full unit の既知 POSIX fixture failure は T207 finding に昇格せず、matching Linux CI success と区別した。

## Verdict・remaining risks・next action

- verdict: `fail`。required/open findings=`T207-IFR-P1` high、`T207-IFR-P2` high。verdict-blocking unexplored はない。
- report_attestation_allowed: `false`。passing verdict ではないため、この report を administrative attestation commit として扱ってはならない。
- remaining risks: CI と T207 happy-path scenario は成功しているが、無視設定下の stale source evidence と branch 往復後の Global identity split を検出しない。Issue #28 は別 owner の held のまま。
- next action: frozen state を無効化し、P1/P2 を修正して focused / related / configured validation と新 exact-head CI を取得する。その後は finding identity / severity を保持して通常 reviewer 1/2 だけが fix verification する。本独立 reviewer を再利用せず、T207 の 2 回目の独立 review は絶対に行わない。
- merge boundary: 本 review は merge / release を許可せず、実行していない。
