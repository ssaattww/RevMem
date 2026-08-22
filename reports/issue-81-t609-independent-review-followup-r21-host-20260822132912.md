# Sub-agent実行レポート

## タスク

T609 R21 verification-only。R20 の remote workspace-membership 修正済み HEAD に対し、actual Extension Host acceptance を一回だけ実行した。

## sub-agentを使う理由

実装・レビュー担当から独立した検証担当として、既存の local evidence を再実行せず、current HEAD の Host evidence と診断だけを収集した。

## 対象範囲

- `9a477d2568bef8e49a3eace7c1d2e143443a77ad` の `npm run test:t609:extension-host` を一度だけ実行する。
- actual `vscode.Uri` T305/T405 valid/reject matrix、virtual public command boundary、live encoding changed-only mapping、persisted Context/Global snapshot、restart-reopen mapping、既存 single/prepare/restart semantics、cleanup を判定する。

## 対象外

- code、test、design、tracking、historical report の変更。
- focused/static/local gate の再実行。
- review、commit、push、CI/GitHub 操作。
- Host の再試行。

## 実行コマンド

- `npm run test:t609:extension-host`（shell timeout 900000ms、実行一回）
  - fail。内部 build と compile:test は通過後、`t609-single-root` が失敗した。
  - diagnostic: `test-output/vscode-launch-diagnostics/t609-single-root-1787373214489.json`
  - failure: `T609 Extension Host timed out: virtual Current Context boundary`。
  - cleanup は succeeded: `test-output/vscode-launch-diagnostics/vscode-fixture-cleanup-1787373215245.json`。
  - 失敗後の再試行はしていない。

## 対象ファイル

- 読み取り: `test-output/vscode-launch-diagnostics/t609-single-root-1787373214489.json`。
- 書き込み: この予約済み実行レポートのみ。

## 指摘事項

- actual Uri probe の valid file、query reject、fragment reject、untitled reject、non-workspace remote reject は `virtual Current Context boundary` の前に実行されるため完了したと推論できる。ただし直後の public `reviewRange.refreshContext` が10秒で未解決となった。
- virtual public Current Context boundary は fail。これにより IFR004 の「T305/T405 actual Uri と public command composition」cell は未完了である。
- `assertMixedEncodingFixture`、live encoding changed-only Context/Global mapping、persistence snapshot、prepare、restart-reopen は失敗地点の後段であり未実行。IFR005 は incomplete。
- cleanup は functional Host failure と分離して pass。

## 提案内容

次の限定 implementation follow-up で、virtual/untitled editor を active にした public Current Context command が未解決になる production cause を解消し、current HEAD で Host acceptance を一回だけ再実行する。再実行時には Uri/public boundary、live encoding、persistence、prepare/restart の全 semantic cells を同じ一回で確認する。

## 未解汾事項

- R21 reviewed HEAD: `9a477d2568bef8e49a3eace7c1d2e143443a77ad` の Host acceptance は fail。
- virtual Current Context command の未解決原因は未調査・未修正。
- IFR004 public-command cell、および IFR005 全 actual semantic cells は未完了。
- matching CI、commit、push、independent-review closure は未実施。
