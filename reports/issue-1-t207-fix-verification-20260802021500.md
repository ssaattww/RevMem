# T207 通常review fix verificationレポート

## メタデータと対象identity

- report type: normal review / fix verification
- reviewer: T207 initial normal reviewer 1/2と同一担当。実装・fixには参加していない
- repository: `ssaattww/RevMem`
- branch: `task/t207-git-history-integration`
- initial reviewed HEAD: `19d3130ed83a72471dc0cabde512b7388d682c2c`
- intermediate fix HEAD: `49fb847fff45dcec6540e155ff8f4af46b388fbc`（CI failureにより最終targetではない）
- reviewed fix HEAD: `8f81942fba517397ceb17bbfac8c0fd87be6c268`
- fix range: `19d3130ed83a72471dc0cabde512b7388d682c2c..8f81942fba517397ceb17bbfac8c0fd87be6c268`
- source review: `reports/issue-1-t207-review-20260802013500.md`
- follow-up evidence: `reports/issue-1-t207-review-followup-20260802015000.md`
- reserved report path: `reports/issue-1-t207-fix-verification-20260802021500.md`
- verdict: `pass_with_held`

## Scopeとboundary

- 対象: source findings `T207-R1-P1` high、`T207-R1-P2` high、`T207-R1-P3` mediumの修正差分、直接影響、test assertions、focused evidence、exact-HEAD CI。
- 対象外: 新しい広域review、独立最終review、Issue #28修正、T206以前、実装、他report/tracking変更、commit、push、PR、merge。
- write boundary: 本レポートだけを更新した。

## Finding dispositions

### T207-R1-P1 — high — closed

- origin/location: initial review `T207-R1-P1`。`src/application/review-context/git-context-revision-mapper.ts:28-35,652-681`、`src/core/git-diff/git-file-state-transition.ts:24-38`、`src/core/git-diff/validated-git-file-state-transition.ts:264-330`、`test/integration/t207-git-history.integration.test.ts:25,91-192,274-298`。
- source problem: Git mapperがemptyを0行、terminal EOL本文をphysical行数として永続化し、productionのVS Code `TextDocument.lineCount`と不一致になって次回openで確認済みstateをstale削除した。test helperも誤規約を複製していた。
- fix evidence: persisted/editor用`lineCountOf`はVS Code規約へ復帰し、Git full-text用`physicalLineCountOf`を分離した。`GitNewFileStateInput`はVS Code lineCountと任意のphysicalLineCountを別fieldで扱い、`newText`がある場合はVS Code lineCountを必ず検証し、physical metadataがあれば追加検証する。intermediate HEADのCIで既存line-count rejectionが欠落した問題は、最終HEADで二重contractとunit fixtureを修正して解消した。
- assertion evidence: T207 scenarioはterminal EOL、no terminal EOL、empty textについてmapping直後とprovider/repository再生成後のrangeとlineCountを確認する。transition unitはVS Code count不一致をrejectし、terminal EOL=`lineCount 2 / physical 1`、empty=`lineCount 1 / physical 0`の正常caseを確認する。
- impact closure: mapping後のsame open/restartでcontentHashが同じ通常text/empty fileを誤ってstale扱いしないため、source impactは解消した。
- required action disposition: 完了。severityはhighのまま維持し、reclassificationなし。

### T207-R1-P2 — high — closed

- origin/location: initial review `T207-R1-P2`。`test/integration/t207-git-history.integration.test.ts:78-349`、関連production fix=`src/adapters/document-review-state/document-review-state-session-provider.ts:530-581`。
- source problem: 元scenarioは変更部分だけの解除、branch state分離、曖昧/copy非継承、残存stateのrestart復元、history payloadとcurrent stateの対応を実証していなかった。
- fix evidence: 3 physical linesを事前markし中央行だけ変更した後、`[0,1)`と`[2,3)`だけが残ることをassertする。main/featureを往復してcontext IDと異なるrangesの分離・復元を確認し、一意renameのstable file ID/range継承、copyの別IDかつ空range、rename元delete、mainの残存stateとterminal/no-terminal/empty fileのrestart復元を確認する。
- identity sibling evidence: branch逆mappingでcontextとGlobalに同一pathの異なるIDが存在した実Git scenarioを受け、current contextの一意stable IDをGlobal候補より優先する。context内またはGlobal内の複数候補は引き続きrejectする。拡張scenarioと関連suiteで正常動作を確認した。
- history evidence: repository historyを1回だけ読み、remap、mark、rename、copy、deleteについてtype、contextId、revisionId、filePath、previousRanges、nextRanges、reasonを期待するdurable stateと照合する。
- impact closure: AC-07〜AC-10、AC-12とstate/history/restart整合を壊すsource test gapsは埋まり、source impactは解消した。
- required action disposition: 完了。severityはhighのまま維持し、reclassificationなし。

### T207-R1-P3 — medium — closed

- origin/location: initial review `T207-R1-P3`。`package.json:147-158`、`test/unit/ci-workflow-contract.test.ts:29-55`、`.github/workflows/ci.yml:45-52`。
- source problem: `test:t207`はstandalone focused scriptだけで、`test:git`、aggregate `test`、CIのいずれにも収録されていなかった。
- fix evidence: `test-dist/test/integration/t207-git-history.integration.test.js`を`test:git`へ追加し、CI contract unitがこの収録を固定する。既存CI Temporary Git stepは`npm run test:git`を実行する。
- CI evidence: exact-HEAD run `30704382171`のTemporary Git gateはT207を含めて成功した。
- required action disposition: 完了。severityはmediumのまま維持し、reclassificationなし。

## Coverage dispositions

- source finding continuity/identity/severity: `checked_no_finding`（P1 high、P2 high、P3 mediumを維持して全件closed）
- requirement/design conformance: `checked_no_finding`（source findingsに関係するAC-07〜AC-10、AC-12、行数/evidence contract）
- correctness and sibling edge cases: `checked_no_finding`（terminal EOL、no terminal EOL、empty、branch逆mapping、copy/delete）
- scope discipline/unrelated changes: `checked_no_finding`
- changed files/direct dependency impact: `checked_no_finding`
- API/data/configuration/workflow compatibility: `checked_no_finding`。`physicalLineCount`追加は内部evidence metadata拡張で、外部breaking changeなし
- error handling/failure diagnostics: `checked_no_finding`。line-count mismatchと同一layer内identity conflictのrejectを維持
- security/secret handling: `not_applicable`
- tests/validation adequacy: `checked_no_finding`
- current-HEAD CI: `checked_no_finding`
- report/tracking accuracy: `checked_no_finding`（follow-up reportはintermediate CI failureと最終二重contract修正を追記済み）
- regression/maintainability: `checked_no_finding`
- held: Issue #28（Windows POSIX fixture）は既存owner保持のnon-blocking held
- unexplored: 必須criterionなし

## Validation assessment

- implementation focused evidence: transition suite 44/44、`npm run test:t207` 1/1、`npm run test:git` 33 pass・Windows/POSIX fixture 3 skip、`npm run test:t205` 31/31、`npm run test:t206` 25/25、compile、lint、architecture、`git diff --check`成功。
- intermediate CI: run `30704154986`、HEAD `49fb847fff45dcec6540e155ff8f4af46b388fbc`はunit 346/347でfailure。このHEADを成功証拠に使用していない。
- final exact-HEAD CI: run `30704382171`、HEAD `8f81942fba517397ceb17bbfac8c0fd87be6c268`、completed/success。build、contract typecheck、architecture正負、lint、unit、Temporary Git（T207収録）、GitHub mock、VS Code Extension Hostの全configured gate成功。
- local Windows full unitの既知19 failuresはIssue #28に一致し、本fix起因でないためheld。matching Linux CI unitは成功した。
- full suiteは指示どおりreviewer側で再実行せず、final exact-HEAD CIを再利用した。

## Verdict・remaining risks・next action

- verdict: `pass_with_held`。
- required/open findings: なし。closed=`T207-R1-P1` high、`T207-R1-P2` high、`T207-R1-P3` medium。
- severity reclassification/errata: なし。
- held/non-blocking: Issue #28のみ。
- remaining risks: 技術verdictはreviewed fix HEAD `8f81942fba517397ceb17bbfac8c0fd87be6c268`だけに適用し、後続commitには自動的に引き継がない。本report自体はnormal review証拠であり、独立最終reviewのattestationではない。
- next action: 本reportと必要なtracking/report同期をcommit/pushし、pre-freeze gateを満たした新immutable HEADに対して、実装担当および本normal reviewerと異なるreviewer 2/2が独立最終reviewを1回行う。
- merge boundary: mergeを許可せず、実行していない。
