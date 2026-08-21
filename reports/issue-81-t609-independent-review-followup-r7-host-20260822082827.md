# Sub-agent実行レポート

## タスク

T609 IFR005 R7 Host follow-up。開始 HEAD は `8f899b630128d5cd8ab94e2238a888fdb2179134`。R6 の BOM public mark timeout を局所化するため、single-root phase を startup/no-active context/durable seed/Shift-JIS public mark/BOM public mark の順序に固定し、Test mode の review-state dependent refresh を public command Promise から分離した。exact Host は seed cell で再度 timeout し、IFR005 Host matrix は incomplete。

## sub-agentを使う理由

親タスクから指定された R7 限定実装と evidence collection をこの worktree で担当するため。review、commit、push、CI、GitHub、tracking、design、historical reports は実施しない。

## 対象範囲

same repository/session owner の single-root composition を T609 gate contract で固定する。Test mode でも全4 normal mark の applied event は exactly once 発火し、Current/Global/Review Contexts の同じ dependent refresh を explicit drainable Promise queue へ積む。Host は public command の state commit/history 完了後に queue、document state、decoration refresh の順に bounded settle する。

## 対象外

production command/UI behavior、固定 sleep/timeout 増加、直接 seam による public command 回避、R6 seed transaction実装、full suite、`test:t609`、CI、commit/push/PR/review/merge、tracking/design、historical reports。

## 実行コマンド

Red: `node --experimental-strip-types --test test/unit/t609-gate-wiring.test.ts` を1回実行。single-root が mixed encoding public mark より前に seed を完了しないこと、Test-mode dependent queue が未実装であることを 1 failure として固定した。

Green: 同 focused command を最小実装後に実行し 13/13 pass。

Lint: `npm run lint` を1回実行し pass。Markdown wording は `tools/lint/` と `lint:md` wiring が存在しないため markdown-word-checker は unsupported。

Exact Host（1回のみ、retryなし）: `npm run test:t609:extension-host` は build と compile:test を pass。single-root の `seed initial mapping ranges` が10秒 timeoutし fail。cleanup は succeeded。diagnostic: `test-output/vscode-launch-diagnostics/t609-single-root-1787355401299.json`。

Diff check: `git diff --check` を1回実行し pass（CRLF conversion warnings のみ）。

## 対象ファイル

変更: `src/t305-extension.ts`、`test/vscode/t609-suite/index.ts`、`test/unit/t609-gate-wiring.test.ts`、本 report。

確認: `src/extension.ts` normal mark handlers、R6 diagnostic、T609 Host fixture、Current/Global/Review Contexts dependent refresh composition、package validation wiring。

## 指摘事項

R6 exact Host は seed を通過して BOM public mark timeoutを露出したが、R7で authoritative orderとして seed を public encoding marks の前へ固定した exact Host は seed cell で再度停止した。Test modeで event を完全抑制する案は actual Host semantic reachabilityを弱めるため採用しなかった。

## 提案内容

productionでは既存の non-awaited Current/Global/Review Contexts refresh をそのまま維持する。Test modeでは `reviewStateChanged` event も同じく発火し、listener は dependent work をFIFO Promise queueへ登録する。`drainReviewStateDependentsForTest()` はこのqueueをawaitし、Hostは各 public Shift-JIS/BOM command後に明示 drainする。deferAppliedDecorationRefreshは全 normal mark に共通のままで、state commit/history completionとmanual decoration observationを分離する。

## 未解決事項

IFR005 queue contract と focused evidence は ready。actual Host matrixは incomplete: R7 exact Hostは public Shift-JIS/BOM commands に到達せず、seed initial mapping ranges timeoutが再出現した。retryは行っていない。BOM command、multi-root cancel/stale、restart/reopenは未証明。
