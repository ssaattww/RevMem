# Sub-agent実行レポート

## タスク

- 目的: 独立review findings `T207-IFR-P1`、`T207-IFR-P2`を修正・検証する。
- タスク種別: independent review follow-up implementation / verification

## sub-agentを使う理由

- 理由: ユーザー指定どおりterra/high implementation workerへ一括修正を委譲する。

## 対象範囲

- 対象: old textとsource lineCount evidenceの照合、Context/Global同一path別IDのatomic reconciliation、negative/restart/history tests、関連検証。

## 対象外

- 対象外: P1/P2 closure以外の新規観点・新規finding、Issue #28、無関係なcleanup、commit、push、PR、merge、親所有tracking。

## 実行コマンド

- `npm run compile:test && node --test test-dist/test/unit/git-file-state-transition-r3.test.js test-dist/test/integration/t207-git-history.integration.test.js` — pass（P1/P2 Red→Green後のfocused確認）。
- `npm run lint` — pass。
- `npm run test:t207` — pass。
- `npm run test:t204` — pass。
- `npm run test:t205` — pass。
- `npm run test:t206` — pass。
- `npm run compile` — pass。
- `npm run validate:architecture` — pass。
- `npm run validate:architecture:negative` — expected 10 violations を検出してpass。
- `git diff --check` — pass（CRLF変換のGit warningのみ）。
- Markdown focused lint — unsupported（repository内に `tools/lint/` と `lint:md` wiring がないため）。report本文では用語回避目的の不要なbacktick/quoteを追加していない。

## 対象ファイル

- `src/core/git-diff/validated-git-file-state-transition.ts`
- `src/adapters/document-review-state/document-review-state-session-provider.ts`
- `test/unit/git-file-state-transition.test.ts`
- `test/unit/git-file-state-transition-r3.test.ts`
- `test/integration/t207-git-history.integration.test.ts`

## 指摘事項

- 指摘要約: `T207-IFR-P1` highと`T207-IFR-P2` highをidentity/severity維持で修正する。

## 結果

- `T207-IFR-P1` high: ignore whitespace/EOL時のfull-text evidenceについて、old pathのsource stateをcurrent pathから解決し、`textDocumentLineCount(oldText) === sourceState.lineCount` を必須化した。terminal EOL、empty、no-terminal、stale count、source state未解決を検証するRed/Green testを追加し、physical line countはdestination metadataの別証拠として維持した。
- `T207-IFR-P2` high: Git open時にContext/Globalの同一path・別stable IDをCASで原子的にreconcileし、確実なrevision/hash一致時はGlobal ranges/metadataをContext stable IDへ移管して旧Global keyを除去する。不一致はGlobal reviewedを空にしてContext IDだけを残す保守的な未確認化とした。branch往復後のlegacy splitを本番repository経由で再現し、mark/unmark、persist、restart、historyとGlobal path/key一意性およびrangesを確認した。

## リスク

- 未解決のリスクまたは後続対応: Windows Issue #28（POSIX fixture failure）はheldのままで、本修正では扱わない。通常reviewer確認に加え、同じ独立reviewerが `T207-IFR-P1/P2` のclosure限定で再確認する。再確認では新規観点・新規findingを追加しない。
