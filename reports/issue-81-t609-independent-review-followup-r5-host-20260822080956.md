# Sub-agent実行レポート

## タスク

T609 IFR005 の Host startup Current Context race を限定修正した。`03b9c8248311eea63b95efe3f26e19b6c1975d2a` を開始 HEAD とし、実装後の作業ツリーを対象にする。IFR005 の実装契約は ready、専用 Host gate は exact 実行の失敗により incomplete である。

## sub-agentを使う理由

親タスクから、実装と指定検証をこの限定 worktree で実行するよう委任されたため。review、commit、push、CI、GitHub、tracking、historical report は実施しない。

## 対象範囲

Current Context の登録時 startup refresh を単一の handled Promise として保持し、Test mode API の `drainCurrentContextStartupForTest()` が同じ Promise を await できるようにする。T609 Host は extension activation 後にこれを drain してから、no-active-editor の実 public `reviewRange.refreshContext` command を実行する。T609 gate wiring の TDD 契約と R4 fixture 前提も同期する。

## 対象外

production の Current Context 選択・repository 解決ロジック、固定 sleep・timeout 拡張、Review Contexts、full suite、`test:t609`、CI、commit/push/PR/review/merge、tracking/design、既存 historical reports。

## 実行コマンド

Red: `node --experimental-strip-types --test test/unit/t609-gate-wiring.test.ts`（新規 startup-drain contract は未実装のため fail。開始 HEAD には別の mapping-seed assertion fail も存在）。

Green: 同じ focused command を実装後に実行し、新規 contract は pass。R4 fixture 前提に合わせて test-only assertion を同期後、同 command は 11/11 pass。

Lint: `npm run lint` は pass。Markdown wording は `tools/lint/` と `lint:md` wiring が存在しないため markdown-word-checker は unsupported（repo の既知制約）。

Exact Host（1回のみ、retry なし）: `npm run test:t609:extension-host` は build と compile:test を pass した後、`t609-single-root` の `seed initial mapping ranges` 10秒 timeout と cleanup timeout により fail。diagnostics: `test-output/vscode-launch-diagnostics/t609-single-root-1787354282708.json`、`test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787354293596.json`。

Diff check: `git diff --check` は pass（CRLF conversion warnings のみ）。

## 対象ファイル

変更: `src/ui/current-context/vscode-current-context-runtime.ts`、`src/t305-extension.ts`、`test/vscode/t609-suite/index.ts`、`test/unit/t609-gate-wiring.test.ts`、本 report。

確認: `src/extension.ts`、`src/t405-review-contexts-runtime.ts`、package scripts、既存 R4/R5 diagnostics。

## 指摘事項

IFR005-Host-startup: 登録 runtime は startup refresh を一度だけ開始し、handled error presentation を含む `startupRefresh` を公開する。t305 composition は重複 refresh を開始せず、Test mode では同一 Promise を drain API として返す。Host fixture は active editor がないことを確認したまま、drain 完了後に public Current Context command を実行する。startup error は既存 runtime の `reportRefreshError` 経路で UI に観測可能で、unhandled rejection を追加しない。

前提同期: mapping seed editor を Host が開いて Test-mode production transaction へ渡す現行 R4 fixture と矛盾していた static assertion を test-only で同期した。production extension はこの理由では変更していない。

## 結果

実装契約と focused TDD は Green。exact Host は single-root の既存/別境界である `seed initial mapping ranges` timeout により失敗し、IFR005 の Host evidence は incomplete。retry は行っていない。

## リスク

専用 Host が startup drain 後の no-active-editor Current Context command を越えて mapping seed で停止したため、後続 phase（multi-root cancel/stale、restart/reopen）は未証明。lint は report の最終 test-only assertion 同期前に実行済みであり、最終 Markdown wording lint は repo wiring 不在で unsupported。exact Host failure cleanup の timeout も残る。
