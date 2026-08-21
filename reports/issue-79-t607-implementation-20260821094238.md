# T607 implementation report

## タスク

T607 / Issue #79 large-workload performance and incremental UI。base/current start HEAD は `2afa1b6a8299b2d25a1ef2c7186508028bbd5fb6`、branch は `task/t607-performance-incremental-ui` である。

## sub-agentを使う理由

使用しない。親の明示指示によりこの implementation owner は self-review、CI待機、commit、push、PR、merge を行わず、implementation-worker の範囲だけを担当した。

## 対象範囲

Design §19.1 を先に追加し、T504 Global Tree を 128 file の決定的 stage で公開する production wiring、generation stale/cancel 時の後続 publish 抑止、visible editor decoration load の並列開始を実装した。`test:t607` は 10,000 changed-line PR projection、large repository Tree、2,048 reviewed intervals、visible-editor decoration、T606 production matrix を含む。T301/T504/T606 の既存 contract は変更せず、CI は diagnostic runner 経由で focused command を実行する。

## 対象外

PR Progress の raw T301 calculator redesign、T504 source I/O policy、T606 privacy/failure policy、Extension Host、full suite、CI起動・待機、review、commit、push、PR/Issue更新、merge は対象外である。公開 API、設定、保存形式の破壊的変更はないため `Design/BreakingChanges.md` は変更しない。

## 実行コマンド

Red: 依存導入後の `npm run test:t607` は未export `createGlobalUnderstandingTreeModelIncrementally` により `compile:test` failure を観測した。Green: `npm run test:t607` は 63 pass / 0 fail。最初のGreen試行は既存host callbackの戻り型と並列化で露出した順序依存testを修正後、同じ focused command が成功した。`npm run build`、`npm run compile:test`、`npm run typecheck:contracts`、`npm run lint`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`git diff --check` は各1回成功した。negative architecture は期待どおり11件を検出した。Markdown wording は `tools/lint/` と `lint:md` wiring がないため focused/full とも unsupported/held である。

## 対象ファイル

`src/ui/global-understanding/global-understanding-ui-model.ts`、`src/ui/global-understanding/vscode-global-understanding-runtime.ts`、`src/ui/global-understanding/index.ts`、`src/ui/normal-editor/normal-editor-decoration-controller.ts`、T607/decoration tests、`package.json`、`.github/workflows/ci.yml`、Design、README、tasks/phases、当report、handoffを変更した。

## 指摘事項

計測で特定した bottleneck は complete Global Tree projection が一括で node を作成・sortしていた点と、visible editor decoration が先行editorをawaitしていた点である。Node `v24.18.0` の同一worktreeで10,000 Global file fixtureを1回測定し、旧同期projectionは6.18ms、incremental projectionはfirst stage 4.04ms、total 5.87ms、決定的scheduler yieldは156回だった。このwall-clock値は advisory でありgateではない。gateは128 file stage、stage数・yield数、stale generation非publish、2,048 intervalでのwork checkpoint、visible editorの同時開始という決定的contractである。

## 結果

initial implementation complete、normal review pending。T607 の最小最適化は generation-safe bounded/incremental Global Tree publish と visible decoration load の並列開始である。前者は current generation のimmutable sorted prefixだけをstage公開し、後者は selection-to-decoration の同期待ちをeditor間で直列化しない。

## リスク

stageの総時間はhost・machine依存であり100msを自動fail gateにしていない。PR Progress のline reviewability取得は既存T606 cancellation boundaryを維持し、このtaskで再設計していない。CI、normal review、independent review、exact-head CI、merge は未実施で、current HEAD のCI evidenceは存在しない。Markdown wording gate はrepository tooling不在でheldである。
