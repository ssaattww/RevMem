# Sub-agent実行レポート

## タスク

T609 IFR005 Host seed cell の限定 follow-up。開始 HEAD は `4dd7acfb003aada7fc9da11dcc42114816cdfc1c`。R5 exact Host で停止した `seed initial mapping ranges` の未完了境界を除去し、IFR005 actual Host matrix を次の public command cell まで前進させた。IFR005 seed cell は ready、専用 Host 全体は後続 public command timeout により incomplete。

## sub-agentを使う理由

親タスクの限定実装を、この worktree の production/session transaction と T609 Host fixture に対して実施するため。review、commit、push、CI、GitHub、tracking、design、historical reports は実施しない。

## 対象範囲

Test-only `seedT609InitialReviewedRanges` が実 production document session を open し、単一の durable repository transaction と history transaction を完了した時点で有限に settle するようにする。readback は committed `batchTransaction.next` を使い、UI publication、decoration refresh/readback を helper completion から除く。public Shift-JIS/BOM command coverage は維持する。

## 対象外

production の public command・UI・Current Context・decoration behavior、fixed sleep/timeout 増加、T609 Host phase 構成、full suite、`test:t609`、CI、commit/push/PR/review/merge、tracking/design、historical reports。

## 実行コマンド

Red: `node --experimental-strip-types --test test/unit/t609-gate-wiring.test.ts` を1回実行。新規 seed-settle contract は `loadForDecoration` と `reviewStateChanged.fire()` が helper に残るため 1 failure。

Green: 同 focused command を最小修正後に1回実行し、12/12 pass。

Lint: `npm run lint` を1回実行し pass。Markdown wording は `tools/lint/` と `lint:md` wiring がないため markdown-word-checker は unsupported。

Exact Host（1回のみ、retry なし）: `npm run test:t609:extension-host` は build と compile:test を pass。R5 の `seed initial mapping ranges` を通過したが、single-root phase の後続 public `mark UTF-8 BOM` command が10秒 timeoutし fail。cleanup は succeeded。diagnostic: `test-output/vscode-launch-diagnostics/t609-single-root-1787354801350.json`。

Diff check: `git diff --check` を1回実行し pass（CRLF conversion warnings のみ）。

## 対象ファイル

変更: `src/extension.ts`、`test/unit/t609-gate-wiring.test.ts`、本 report。

確認: R5 exact diagnostic、`src/adapters/document-review-state/reconciled-document-review-state-session-provider.ts`、`src/adapters/document-review-state/document-review-state-session-provider.ts`、`src/adapters/state-repository/debounced-review-state-repository.ts`、T609 Host suite と package validation wiring。

## 指摘事項

R5 helper は `initial.committer.commit()` と `historyRecorder.recordTransaction()` の後に `reviewStateChanged.fire()` を発行し、Current Context/Global/Review Contexts の listener chain を開始していた。さらに3 editor の `documentSessionProvider.loadForDecoration()` を await して Git ownership/mapping/decor readback を helper completion に含めていた。これが actual durable transaction ではない UI/decor boundary を `seed initial mapping ranges` timeout に含める直接原因だった。

## 提案内容

Test mode に限り、helper は実 production `documentSessionProvider.open()`、`initial.committer.commit(batchTransaction)`、`historyRecorder.recordTransaction()` を維持する。一方、committed `batchTransaction.next` から3 file の intervals を返し、state-changed publication と decoration readback を行わない。これにより durable transaction の実証を残しつつ、UI/public refresh を helper の settle 条件から分離する。

## 未解決事項

IFR005 Host seed cell は ready: exact Host は R5 の seed timeout を越えた。Host 全体は incomplete: public Shift-JIS/BOM coverage のうち `mark UTF-8 BOM public command` が次の10秒 timeoutとして露出し、multi-root cancel/stale と restart/reopen は未到達。retry は禁止に従い未実施。
