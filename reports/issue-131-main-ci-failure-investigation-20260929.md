# Issue #131 main CI/Publish 失敗調査レポート

## 対象

- Repository: `ssaattww/RevMem`
- 調査対象 main HEAD: `96b841693c9dab2828a1d4fcc436804493efdbbe`
- Issue: `#131`
- 診断改善 PR: `#132`
- Merge: 実施しない。

## exact-head workflow 結果

同一 HEAD SHA `96b841693c9dab2828a1d4fcc436804493efdbbe` に対して次の2 runを確認した。

- `Publish VSIX Package` run `36417299921`: failure
- `CI` run `36417300030`: success

別 SHA の run は原因判断に使用していない。

## 失敗箇所

Publish run の失敗 step は `VS Code Extension Host tests`。launcher の記録は次のとおり。

- phase: `t306`
- status: `failed`
- exitCode: `null`
- signal: `SIGTERM`
- termination: `requested`

同一 SHA の通常 CI では `t306` が `status=succeeded`, `exitCode=0`, `termination=not-needed` で成功した。

## 確定できた原因範囲

`run-extension-host-launch-worker.ts` は `runTests` が reject した場合に parent へ `kind=failed` を通知する。`owned-extension-host-launch.ts` はこの通知を `status=failed` とし、owned process tree を停止するため SIGTERM が記録される。したがって今回の失敗は 300秒の外側 watchdog timeout ではなく、Extension Host test 側が failure を返したもの。

一方、失敗 run の artifact 数は 0。`test-output/vscode-launch-diagnostics/t306-*.json` に保存されるはずの workerError/stdout/stderr が残っていないため、t306 内のどの操作・assertion が失敗したかは現存証拠だけでは確定できない。

## 非決定性に関する調査

`test/vscode/t306-suite/index.ts` は複数の非同期操作を固定 `10,000ms` deadline で囲っている。同一 SHA の通常 CI が成功し Publish が失敗した事実から、必須 gate が実行環境の揺らぎを受けている可能性がある。ただし今回の diagnostic JSON が欠落しているため、10秒 deadline 超過が今回の直接原因だったとは断定しない。

T607 の performance workload は既に `test:t607` で開発時に実行可能な一方、`test:unit` と CI から除外されている。この既存方針を Issue #131 の要件として、処理時間計測・性能閾値・runner負荷に依存する短い deadline 等の非決定的テストへ適用する。

## Issue #131 要件

- CI/Publish の必須 gate は決定的に合否判定できるテストだけにする。
- 処理時間計測、性能閾値、runner負荷に依存する短い deadline 等は必須 CI/Publish から除外する。
- 除外したテストは削除せず、開発時専用 command から実行できる状態を維持する。
- t306 を CI に残す部分は可能な限り状態・イベントベースの完了判定へ変更する。
- ハング防止用の十分に大きい watchdog は安全停止用途として残してよい。
- CI と Publish の deterministic gate を共有し、定義のドリフトを防ぐ。

## 今回実施した診断 workflow 改善

Publish workflow に対して以下を追加した。

- `Prepare diagnostic output`
- Restore / Build / Lint / Unit / Git integration / GitHub integration / VS Code Extension Host を `tools/run-ci-command.mjs` 経由へ変更
- 各 command の stdout / stderr / combined log / result JSON を `test-output/ci` へ保存
- failure 時に Node/npm/runner/checkout/event 情報と Git 状態を収集
- `test-output/` と Extension Host diagnostic JSON、生成物、関連 source/config を `actions/upload-artifact@v4` で保存

## TDD 証拠

先に `release workflow preserves failure diagnostics as artifacts` 契約テストを追加した。

- Red: workflow 未修正状態で 8 pass / 1 fail
- Green: workflow 修正後 9 pass / 0 fail

## ローカル検証

- `npm run test:unit`: 870 pass / 0 fail / 2 skip
- `npm run lint`: exit code 0
- `npm run build`: exit code 0
- `git diff --check`: 問題なし

## コミット

- `f6202ee`: `ci: preserve publish failure diagnostics`

## 残存事項

- 非決定的テストの実際の分離・t306 の状態ベース化は Issue #131 の本対応として未実施。
- 本レポート保存後に HEAD が変わるため、PR #132 の最終 exact-head CI は report commit push 後の新しい HEAD に一致する run のみを確認し、結果を PR コメントへ記録する。
- Merge は実施しない。
