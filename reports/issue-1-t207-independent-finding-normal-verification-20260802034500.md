# T207 独立finding通常reviewer限定verification

## メタデータと対象identity

- report type: verification report / normal reviewer finding verification
- reviewer: T207通常reviewer 1/2。T207実装、独立finding修正、独立最終reviewには参加していない
- source review: `reports/issue-1-t207-independent-final-review-20260802024500.md`
- source reviewed implementation HEAD: `388daee5764472fe01f47bbf2a8ad5b450c7d7fe`
- follow-up evidence: `reports/issue-1-t207-independent-review-followup-20260802031000.md`
- pre-rebase verified fix HEAD: `538b6331965c02413f47bb74071b1b3b72adfc1e`
- reviewed fix HEAD: `697c4f123a2f71577d285de7a03f90ecc6b6d4f7`
- original verification range: `388daee5764472fe01f47bbf2a8ad5b450c7d7fe..538b6331965c02413f47bb74071b1b3b72adfc1e`
- rebase identity evidence: T206 merge後にT207をmainへrebase。`git diff --quiet 538b6331965c02413f47bb74071b1b3b72adfc1e 697c4f123a2f71577d285de7a03f90ecc6b6d4f7`はexit 0で、reviewed fix treeは同一
- branch: `task/t207-git-history-integration`
- reserved report path: `reports/issue-1-t207-independent-finding-normal-verification-20260802034500.md`
- persistence mode: repository file。独立最終review report-attestationではない
- verdict: `pass_with_held`

## Scopeとboundary

- 対象: source findings `T207-IFR-P1` high、`T207-IFR-P2` highのrequired action、対応production/test差分、focused evidence、exact-head CI。
- 対象外: 新規広域review、新規finding、独立review再実施、Issue #28修正、無関係な変更、実装、他report/tracking、commit、push、PR、merge。
- write boundary: 本レポートだけを更新した。別担当の未追跡reportには触れていない。

## Finding dispositions

### T207-IFR-P1 — high — closed

- origin/location: source independent review `T207-IFR-P1`。修正=`src/core/git-diff/validated-git-file-state-transition.ts:392-440`、test=`test/unit/git-file-state-transition-r3.test.ts:230-311`および既存full-text evidence fixtures。
- source problem: ignore whitespace/EOL時、old full textをsource `FileReviewState.lineCount`と照合せず、staleなsource evidenceでも確認済みrangeを継承できた。
- required action evidence: `validateFullTextEvidence()`はold pathからsource stateを一意なcurrent path lookupで解決し、未解決ならrejectする。`textDocumentLineCount(oldText) !== sourceState.lineCount`も必ずrejectしてからhunk、complete reconstruction、EOL signatureを検証する。new側のVS Code lineCountとoptional physical line countの別検証も維持する。
- test evidence: terminal EOL=`lineCount 2`、empty=`1`、no-terminal=`1`の正常source evidenceをacceptし、`oldText="line"`にstale source `lineCount=2`を与えるcaseとsource state未解決caseをrejectする。関連fixtureのsource state lineCountもVS Code contractへ同期された。
- validation evidence: focused transition/T207 test、T204/T205/T206、compile、lint、architecture正負、diff checkが成功。exact-head CIのunitを含む全configured gateも成功した。
- impact closure: staleまたはpath未解決のold full-text evidenceでreviewed rangeを継承する経路は閉じられ、design 10.3.3のold path/lineCount要求を満たす。
- disposition: `closed`。source severity highを維持し、reclassification/erratumなし。

### T207-IFR-P2 — high — closed

- origin/location: source independent review `T207-IFR-P2`。修正=`src/adapters/document-review-state/document-review-state-session-provider.ts:530-717,719-755,758-839`、test=`test/integration/t207-git-history.integration.test.ts:276-380,447-457`。
- source problem: Contextとowner-wide Globalに同一path・別file IDがあるとContext IDだけを選び、旧Global keyを残したまま後続mark/unmarkが別keyを追加できた。
- required action evidence: writable Git openはrevision一致確認後、通常のfile mapping/stale判定前に`reconcilePersistedGitFileIdentity()`を実行する。Context/Global各layer内の複数path候補はrejectする。Context IDと異なる単一Global IDがある場合、完全snapshot CASで旧Global keyを削除しContext stable IDへ統合する。revisionが一致し、hashが矛盾しない場合だけnormalized Global rangesを有効lineCount内で移管し、不一致時は空rangeへ保守的に未確認化する。CAS競合時は最新snapshotを再読込し、revisionを再検証して再計画する。stale cleanupのCAS retryにも同reconciliationを適用する。
- test evidence: production filesystem repositoryへlegacy split `{Context canonical ID -> fixture.txt, Global legacy ID -> fixture.txt}`を保存し、provider open後に同pathのGlobal keyがContext target ID 1件だけとなりrangesが移管されることを確認する。続くmark/unmark後のpersisted complete snapshot、provider/repository再生成後のkey/path一意性とranges、対応するmarked/unmarked history payloadを確認する。
- validation evidence: focused P1/P2 testと`test:t207`、関連T204/T205/T206、compile、lint、architecture正負、diff checkが成功。exact-head CIのTemporary Git T207および全configured gateも成功した。
- impact closure: 同一path別IDの残留と後続transactionによるGlobal key重複をatomic reconciliationで除去し、branch/restart/state/historyのsource impactを解消した。
- disposition: `closed`。source severity highを維持し、reclassification/erratumなし。

## Coverage dispositions

- source finding identity/severity continuity: `checked_no_finding`（P1/P2 highを維持してclosed）
- required action conformance: `checked_no_finding`
- correctness/sibling cases explicitly required by source findings: `checked_no_finding`
- fix changed files/direct dependencies: `checked_no_finding`
- persistence/CAS/data compatibility: `checked_no_finding`
- failure diagnostics/conservative behavior: `checked_no_finding`
- tests/assertion effectiveness: `checked_no_finding`
- exact-head CI: `checked_no_finding`
- security/secrets: `not_applicable`
- held: Issue #28 Windows POSIX fixture failure。既存owner保持のnon-blocking held
- unexplored: 限定verificationの必須criterionなし
- new broad review/new findings: 明示された対象外のため実施していない

## Validation assessment

- follow-up focused evidence: `npm run compile:test && node --test test-dist/test/unit/git-file-state-transition-r3.test.js test-dist/test/integration/t207-git-history.integration.test.js`、`npm run test:t207`、`test:t204`、`test:t205`、`test:t206`、compile、lint、architecture正負、`git diff --check`は成功。
- pre-rebase exact-head CI: run `30705230208`、head SHA=`538b6331965c02413f47bb74071b1b3b72adfc1e`、completed/success。
- rebased exact-head CI: runs `30705390897`、`30705398134`、head SHA=`697c4f123a2f71577d285de7a03f90ecc6b6d4f7`、いずれもcompleted/success。build、contract typecheck、architecture正負、lint、unit、Temporary Git（T207収録）、GitHub mock、VS Code Extension Hostの全configured gate成功。
- full suiteはreviewer側で再実行せず、matching CIを再利用した。
- Markdown focused lintはrepository wiringがないためunsupportedであり、passへ変換していない。

## Verdict・remaining risks・next action

- verdict: `pass_with_held`。
- required/open findings: なし。closed=`T207-IFR-P1` high、`T207-IFR-P2` high。
- held/non-blocking: Issue #28のみ。
- remaining risks: tree-equivalent rebaseとexact-head CIによる行政的identity同期後、技術verdictはreviewed fix HEAD `697c4f123a2f71577d285de7a03f90ecc6b6d4f7`に適用する。本verificationは失敗した独立review findingの通常reviewer限定確認であり、独立reviewの再実施でもreport attestationでもない。
- next action: 親は本reportを含む必要な非final変更を同期し、ユーザー指定どおり2回目の独立reviewを行わず、既定の提出前gateへ進む。後続Git commitが生じた場合、このverdictは新内容へ自動継承されない。
- merge boundary: mergeを許可せず、実行していない。
