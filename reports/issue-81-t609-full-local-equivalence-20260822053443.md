# Sub-agent実行レポート

## タスク

- 目的: Issue #81 / T609 の independent final review 前、frozen candidate `a7dd571de06bd669ee2489239d31bd309dfa8b45` に対する repository-defined full local equivalence gate を一度だけ実行し、全結果を保持する。
- 実行時branch: `task/issue-81-repository-encoding`。`HEAD^` は `ef6297cefe3a7c18bc7c81d19514474120316629`。commit、push、CI待機、GitHub操作は行っていない。

## sub-agentを使う理由

- 理由: final publication candidate の完全ゲートは、通常のfocused T609 evidence（`test:t609` 52/52およびfunctional Host 3 phase）と代替できず、失敗時も各umbrella componentを一回ずつ収集する必要があるため。

## 対象範囲

- 実行対象: `npm test` を構成する5 component、static 6 command、Markdown lint のrepo-local wiring判定。T609 focused/Host commandは直前証拠を保持し、本ゲートでは追加実行しなかった。
- accepted delta（base `3bba5defe32b7da134817492427e09c70c97beaf`からcandidate）: T609 repository resolution、review-context cancellation/encoding/revision mapping、local Git/state adapters、T405/T305/extension/UI composition、CI/package/test/fixture/design/tracking/report群。

## 対象外

- 実装・修正、test再実行、commit/push、CI/GitHub確認・待機、tracking/design/BreakingChanges変更は対象外。予約済み本report以外への書込みはしない。

## 実行コマンド

- static（各1回）: `npm run build` pass (62.2s); `npm run typecheck:contracts` pass (27.2s); `npm run validate:architecture` pass (15.7s); `npm run validate:architecture:negative` pass (10.7s, expected 11 fixture violations); `npm run lint` pass (196.2s); `git diff --check` pass (4.0s)。
- umbrella components（各1回、unit失敗後も継続）: `npm run test:unit` fail (exit 1, 107.7s); `npm run test:git` pass (35 pass, 0 fail, 3 skipped, 273.7s); `npm run test:github` pass (48/48, 85.4s); `npm run test:t502` pass (11/11, 69.5s); `npm run test:vscode` pass (342.5s)。
- `test:vscode` phase: `t306`、`t302`、`lifecycle-confirm`、`lifecycle-restore-confirmed-and-unmark`、`lifecycle-restore-unmarked`、`vscode-fixture-cleanup`は全て`status=succeeded`、`exitCode=0`、`termination=not-needed`。timeoutなし。
- Markdown lint: `package.json`に`lint:md`なし、`tools/lint/`、`markdown-targets.json`、whitelist、`prh.yml`、cspell configもなし。repo-local focused/full lintは`unsupported`（passへ読み替えない）。

## 対象ファイル

- 実行で生成されたignored test artifactsを除き、worktreeの変更は本予約reportだけ。gate前後ともtechnical HEADは`a7dd571de06bd669ee2489239d31bd309dfa8b45`のままである。
- inspected: `package.json` scripts、`tools/lint/` wiring、T609 normal closure R3/R16/R17 evidence、candidate delta、各command stdout/stderr。

## 指摘事項

- blocking gate result: `npm run test:unit`のみexit 1。observed failuresは22件で、既知Windows/POSIX fixture/process-semantics範囲に限られる: `Git ownership routes a workspace-external file to the branch repository`; `Git ownership wins even when the file belongs to the current workspace`; `workspace reviewed ranges are promoted when Git ownership is detected later`; `an old workspace context records an empty baseline before the target file is first created`; `initial workspace promotion persists ranges and baseline in one real CAS commit`; `a failed initial promotion leaves the Git owner without promoted ranges or baseline`; `workspace and external sources are reconciled by one real CAS commit`; `content changes refresh the reconciliation baseline before later fallback additions`; `Git recovery adds newer fallback ranges even when the Git owner already has state`; `fallback additions do not resurrect ranges removed from the higher owner`; `initial promotion and baseline use one lower-owner observation`; `workspace reviewed state wins over a conflicting external-file removal`; `workspace removal wins over a conflicting external-file addition`; `writable open performs one active-owner Git inspection`; `a new Git context at the same revision inherits repository-wide Global state`; `a new Git context at an unmapped revision does not replace repository-wide Global state`; `recreated lower-owner context does not turn the old baseline into removals`; `stale Git cleanup preserves another context's later owner-wide Global update`; `stale Git cleanup preserves a later same-context current file state`; `metadata timeout escalates to SIGKILL when the process ignores SIGTERM`; `owned Extension Host launch fails and terminates its tree when success is reported before worker close`; `owned fixture cleanup removes only its supplied temporary root`。
- ownership/reconciliation 19件は`DocumentReviewStateSessionProvider.resolveGitMapping`の`document path is outside the resolved Git working tree`で失敗し、Windows上でPOSIX fixture path semanticsを解決できない既知環境クラスである。残る3件はWindowsのSIGKILL不能、および同一owned Extension Host cleanup timeout由来のdiagnostic assertion/cleanup failureである。
- T609/changed-file failureは本gateで観測されていない。unit output中のT609-NR-005、T609-NR-002、encoding/revision-mapping関連はpass表示であり、別管理の直前focused `test:t609` 52/52およびT609 functional 3 phase evidenceを置換しない。

## 結果

- full local equivalence gate verdict: `blocked`。static 6/6、umbrella 4/5はpassだが、`test:unit`の22既知環境依存failureによりrepository-defined full gateはpassではない。
- candidate identityは実行前後で不変: `a7dd571de06bd669ee2489239d31bd309dfa8b45`。結果を本reportへ記録したのみで、独立final reviewへ進めるかは親が既知failure dispositionを判断する。

## リスク

- held/blocking: Windows/POSIX fixture path-semantics 19件、WindowsでSIGKILLを送れない診断1件、owned Extension Host success-without-close/fixture-cleanup timeout 2件。勝手な修正・retryはしていない。
- unsupported: repo-local Markdown lint wiringが存在しない。exact-head CIは本taskの明示的非対象であり未確認。これらをsuccessとして扱わない。
