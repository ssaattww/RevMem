# Sub-agent実行レポート

## タスク

- 目的: CI90-001 normal closure後のcandidate HEADでrepository-defined full local equivalence gateを1回だけ実行する
- タスク種別: final candidate verification

## sub-agentを使う理由

- 理由: ユーザー指定Terra/highの検証担当へ、再試行を抑制したexact-head local gateを委譲するため

## 対象範囲

- 対象: candidate `0da5becfa06692c2ffbd7da74d1d85a3124cea43`、static gates、default `npm test`、CI90-001/T606到達状況、性能非追加の確認

## 対象外

- 対象外: 修正、performance実行、Extension Host単独再試行、push、CI待機、merge、review verdict

## 実行コマンド

- 実行コマンド: 開始・終了 `git rev-parse HEAD`、`node -e` によるdefault testと`test:t607`/CI wiringの静的確認、`npm run build`、`npm run typecheck:contracts`、`npm run validate:architecture`、`npm run validate:architecture:negative`、`npm run lint`、`npm test`（各1回）

## 対象ファイル

- 変更または確認したファイル: `package.json`、`.github/workflows/ci.yml`（確認のみ）、本report

## 指摘事項

- 指摘要約または「指摘なし」: default `npm test` は `test:unit`、`test:git`、`test:github`、`test:t502`、`test:vscode` のみを連結し、`test:t607` を含まない。CIもrequired unit/test:T606を配線し、performance `test:t607` は含まない。static gatesは全てGreen、architecture negativeは意図どおり11 violationを検出した。default testは`test:unit`で停止し、CI90-001のT606 2件をfailure diagnosticsに含まない（`test:unit`の対象として到達）一方、別fixture 2件が失敗した。

## 結果

- 結果: candidate `0da5becfa06692c2ffbd7da74d1d85a3124cea43`で開始・終了HEAD不変。build、typecheck:contracts、architecture positive、architecture negative expected契約、lintはGreen。default `npm test` は60.7秒でfailed（後続`test:git`以降は`&&`により未実行）。failure diagnostics: (1) `node-git-command-executor.test` がtimeout後 `SIGKILL` を期待しactual `SIGTERM`、(2) `owned-extension-host-launch.test` が `/failed/` を期待しactual `success-without-close timed-out`。CI90-001 T606 2件に新規failureはない。performance、単独Extension Host、CI waitは未実行。Markdown focused lintはrepo `tools/lint`/`lint:md` 不在のためunsupported（設定変更なし）。

## リスク

- 未解決のリスクまたは後続対応: full local equivalence gateはdefault test failureのためheld。2 failureは候補のCI90-001 test-only差分と別のWindows process/signal・owned-host fixture境界であり、今回の単回実行だけでは環境非因果を確定できない。推奨次アクションは、CIまたはsymlink/process権限が整ったWindows環境でcandidate exact-headのdefault testを1回確認すること。代替は、失敗2 fixtureの既知環境証跡とCI結果を親が照合すること、または別OS runnerで同一gateを一回だけ実行すること。
