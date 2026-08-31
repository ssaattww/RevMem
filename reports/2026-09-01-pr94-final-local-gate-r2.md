# PR #94 final local gate R2

## Candidate

開始HEAD: `be8acb8b6640dc654d5390017881ca5ec0262db0`（指定候補と一致）。

開始時status: `?? reports/2026-09-01-pr94-final-local-gate-r2.md` のみ。source、test、tracking の変更は行わない。

## Static gates

各コマンドは一回だけ実行した。

- `npm run build`: pass（`tsc -p tsconfig.json`）。
- `npm run typecheck:contracts`: pass。
- `npm run validate:architecture`: pass。
- `npm run validate:architecture:negative`: pass（期待どおり11件の fixture 違反）。
- `npm run lint`: pass（warnings 0）。

静的配線: default `test` は `test:unit`、`test:git`、`test:github`、`test:t502`、`test:vscode` のみ。`.github/workflows/ci.yml` の Unit job は `npm run test:unit` を実行する。`test:t607` と performance は default/required CI 配線に存在せず、実行もしていない。

## Test gate

`npm test` を一回実行した（80.1秒、exit 1）。所有した npm/node process は終了しており、残存 process はない。

`test:unit` で失敗したため、後続の `test:git`、`test:github`、`test:t502`、`test:vscode` には到達していない。出力伝送が切り詰められたため完全な aggregate count は取得できなかったが、以下の actionable failures を確認した。

- `issue-13-r6-review-followup` の `DocumentReviewStateSessionProvider.open` 経路で例外。
- `owned-extension-host-launch` の「success is reported before worker close」契約で、期待 `/failed/` に対し実際は `Extension Host launch success-without-close timed-out; diagnostic: <external-diagnostic>`。

再実行、修正、CI 待機は行わない。いずれもこの単回ゲートの情報だけでは候補HEADの直接因果を確定できず、別の focused diagnosis が必要である。

## Held

ゲートは `npm test` の failure により held。Markdown wording lint はこの予約reportを対象に確認したが、repo に `tools/lint/` と `lint:md` 配線がないため unsupported（設定変更は行わない）。

`git diff --check`: pass（一回）。終了HEAD: `be8acb8b6640dc654d5390017881ca5ec0262db0`。終了status: `?? reports/2026-09-01-pr94-final-local-gate-r2.md` のみ。
