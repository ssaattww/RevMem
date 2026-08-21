# T606 independent final attestation R2 report

## タスク

Issue #76 / PR #77 の invalidated attestation 後に追加された CI failure follow-up delta を、同一 independent reviewer が限定検証した。これは新しい full review ではなく、`T606-IFR001`〜`T606-IFR005` closed と `PASS_WITH_HELD` を維持したまま、exact-head CIで露出した5件の旧test期待が既存production contractへ同期されたことと、new attestation前の管理記録を確認する作業である。

## sub-agentを使う理由

sub-agent は使用していない。同一 reviewer の continuity を保ち、既存findingを再評価せず、指定されたCI failure、test-only delta、follow-up evidence、tracking、current PR bodyだけを直接照合した。

## 対象範囲

- final admin target / attestation first-parent candidate: `c559f70c7afcd345136553b54293305bef1f469f`
- CI follow-up technical HEAD: `2a2b59fe0cf8a9f65c79fd87ebd50386ae6a488e`
- previous final admin target: `8a3c86c89fcfea91d18ee621d42d9d178a1425c0`
- invalidated attestation HEAD: `b747c80d62ac293f3a45f8bc932154e2e72421b2`
- base / merge-base: `fb7df6ab79bb23ae16b43b61aa66ab743460be69`
- verified range: `8a3c86c89fcfea91d18ee621d42d9d178a1425c0...c559f70c7afcd345136553b54293305bef1f469f`
- failure evidence: PR CI run `32431194872` / job `96622916836`、head `b747c80d62ac293f3a45f8bc932154e2e72421b2`。build、contracts、architecture、lintはsuccess、Unit testsだけが5件のstale expectationでfailure。
- 判定対象: product code変更0、PR68の4 supersede testsのtyped `OperationCancelledError` / rejection consumption / no unhandled rejection、T505 stale Global direct boundaryとregistered commandのgeneric / redacted boundary、focused 15 / 0、static pass、local full unit 521 / 20 / 2 heldの正直な記録、tracking / current PR #77 bodyのidentityとevidence同期

## 対象外

- `T606-IFR001`〜`T606-IFR005` の再評価、新規観点・finding、severity 変更、新しい full independent review
- product implementation、design、workflow、configuration、Skill の変更または広域再レビュー
- test / CI の実行または待機、commit、push、PR操作、merge
- full unitでheldとされたWindows Git-owner path 19件とSIGTERM / SIGKILL timing 1件の原因調査・修正
- repository Markdown toolingによるwording check。`tools/lint`、Markdown targets / whitelist / `prh`、`cspell`、`lint:md`が存在しないためunsupported / heldとした。

## 実行コマンド

read-onlyで `git status --short --branch`、`git rev-parse HEAD`、`git merge-base`、`git log`、`git show`、`git diff --name-status`、`git diff --stat`、`git diff`、`git diff --check`、`rg`、`Get-Content`、`Select-String`、`gh run view 32431194872`、`gh run view 32431194872 --job 96622916836 --log-failed`、`gh pr view 77` を使用した。test、build、lint、architecture、CIは再実行していない。レポート更新には`apply_patch`だけを使用した。

## 対象ファイル

- `test/unit/issue-66-pr68-review-findings.test.ts`
- `test/unit/t505-refresh-invalidation.test.ts`
- `test/unit/t606-r5-production-activation.test.ts`
- `src/t405-pull-request-review-runtime.ts`（contract read-only）
- `src/ui/global-understanding/global-understanding-ui-model.ts`（contract read-only）
- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`（contract read-only）
- `reports/issue-76-t606-ci-followup-20260821130000.md`
- `handoffs/issue-76-t606-ci-followup-20260821130000.yaml`
- `reports/issue-76-t606-independent-final-attestation-20260821123000.md`（invalidated evidence）
- `README.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`
- current PR #77 body

verified rangeに`src/` product変更、design、workflow、configuration変更は0である。technical deltaは上記3 test filesだけで、その他はinvalidated attestationとCI follow-upのreports / handoff / trackingである。

## 指摘事項

- 新規findingなし。`T606-IFR001`〜`T606-IFR005`はすべてclosedを維持する。
- **CI delta accepted.** CI failureの5件は、productionが既に返すtyped cancellation / direct stale rejectionを旧testがresolved / dedicated reporterとして期待した不一致である。PR68の4 testsはsupersede・clear・same-context re-registrationを`OperationCancelledError` rejectionとして消費し、stale failureのdeferred rejection handlerを開始前に接続してunhandled rejectionを防ぐ。stale publish抑止assertionは維持される。
- T505 testはstale nodeのdirect controller `RangeError` rejectionとopen failure rejectionを固定し、actual registered Global open command testはgeneric UI message、raw detail非表示、`started` + `failed`単一terminal、`Operation failed; details were redacted.`を固定する。既存production境界と一致する。
- provided focused Green 15 pass / 0 fail・unhandled rejectionなし、build / contracts / lint / architecture positive・negative / diff-check passを受領した。local full unit 521 pass / 20 fail / 2 skipはGreenに変換せず、Windows対象外19件とSIGKILL timing 1件としてheldを維持する記録がfollow-up、tracking、PR bodyで一致する。
- invalidated attestation `b747c80...` は再利用しない。current PR #77 bodyはhead `c559f70...`、CI technical HEAD `2a2b59f...`、failed run、focused 15 / 0、full unit 521 / 20 / 2、all findings closed、same-reviewer CI-delta verification / new attestation / exact-head rerun pendingを同期している。

## 結果

**Technical verdict: PASS_WITH_HELD maintained.** `T606-IFR001`〜`T606-IFR005`はすべてclosed、CI deltaはacceptedである。required CI-delta criteriaはすべてreviewedまたはheld、unexploredはnone、unknownはnone。heldはCI follow-up technical HEADに対するexact-head PR CI rerun、local full unitのWindows 20 failures、unsupportedのMarkdown wording toolingであり、技術判定をblockしないがmergeを許可しない。

`report_attestation_allowed: true`。このreportは、事前予約済み `reports/issue-76-t606-independent-final-attestation-r2-20260821133000.md` を1回だけ保存するadministrative report-attestationを意図する。attestation commitのfirst parentはfinal admin target `c559f70c7afcd345136553b54293305bef1f469f`、変更pathはこの予約reportだけ、commitは単一、他のexecutable / test / Skill / design / workflow / configuration / tracking / feedback / handoff / product path変更は0でなければならない。attestation SHAはcommit後にexternal metadataへ記録し、後続Git commitまたはrepository writeがあればcompletionは無効となる。technical verdictはCI follow-up technical HEADとaccepted deltaに基づき、attestation commitをimplementationとしてreviewしたものではない。

## リスク

- CI run `32431194872`はinvalidated attestation HEADのfailure evidenceであり、current technical / admin HEADのsuccess evidenceではない。current exact-head PR CI rerunはmerge gateとしてheldである。
- local full unitは20 failuresのためGreenではなくheldである。focused 15 / 0とstatic passがこのheldを上書きしない。
- repository Markdown toolingが不在のためfocused / full wording checkはunsupported / heldである。placeholder、見出し、末尾空白、HEAD、status、committed deltaのdiff-checkを機械確認する。
- attestation commitのfirst-parent、単一commit、予約report-only diff、後続commitなし、以後repository writeなしのいずれかを満たさなければ、`report_attestation_allowed`は失効する。
- 本作業はCI-delta限定verificationであり、新しいfull reviewや対象外領域の再保証ではない。ただし指定されたcriteriaにunexploredはない。
