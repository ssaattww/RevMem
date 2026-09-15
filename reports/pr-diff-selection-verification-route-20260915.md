# Sub-agent実行レポート

## タスク

- 目的: PR #120の最終検証環境と既存CIコマンドの実行経路を確認する。
- タスク種別: environment verification。対象PR #120、開始HEAD c2dfc3cb27efd79bdf41c4e0ad7b9534161b588b。

## sub-agentを使う理由

- 利用者が実装terra highを指定。環境確認はSkillでsub-agent必須。製品実装と独立に、親が検証経路を決定するための情報を取得する。

## 対象範囲

- 既存workflow・テストrunner・依存実行環境の読み取りと最小の可用性確認。

## 対象外

- 製品コード・テスト・workflow・trackingの編集、全体試験実行、push、merge。

## Dispatch profile

- selection inputs: environment / bounded_technical / uncertainty medium / radius local / criticality ordinary / repetition single / context fresh。
- selection source: user_override。
- observed decomposability: single。
- decomposition policy / disposition: allowed; bounded environment inspection only。
- proposed profile: none。
- approval status / evidence: 利用者「実装 terra high」。
- requested profile: gpt-5.6-terra / high / fork_turns none。
- agent role / default-role plan: runtime default; explicit model/effort via collaboration schema。
- role config evidence / profile effect: config.tomlにはagents role overrideなし。公開spawn schemaはfresh forkでoverride対応。planned effect unchanged。
- planned runtime profile: gpt-5.6-terra / high。
- applied profile: null。
- application status: spawn_succeeded_profile_unverified; identity /root/verification_route。
- runtime profile observability: final_profile_hidden。
- reviewer continuity: not applicable。
- fork policy: none。
- reasons / constraints: 全実装terra high、レビューsol highという利用者指定。Skillは清潔なorigin/main 106ea5dcf12c4805756351fb9381df220b94f044の専用worktreeから読む。旧Skill作業branchは変更しない。

## 実行コマンド

- 実施（read-only）: `node --version`、`npm --version`、`git --version`、`code --version`、`wsl.exe --list --quiet`、`Get-Command xvfb-run`、`git rev-parse HEAD`、`git status --short`、`package.json`、`.github/workflows/ci.yml`、`test/vscode/run-extension-host.ts`、`tools/run-ci-command.mjs` の読取り。
- `tools/run-ci-command.mjs`は`shell: false`でchild processを起動する。Windowsではnpm package scriptを直接`npm`又は`npm.cmd`で渡さず、必ず `node tools/run-ci-command.mjs <label> C:\Windows\System32\cmd.exe /d /s /c "npm run <script>"` とする。PDS-01の実記録はこの形で`spawnError: null`、exit 2（未実装exportによる期待どおりのRed）となった。直接`npm`は`ENOENT`、`npm.cmd`は`EINVAL`だった。
- 最終candidate HEADを固定した清潔なWindows作業ツリーで、CIと同じ順序・記録形式で実行する基礎route: `node tools/run-ci-command.mjs build C:\Windows\System32\cmd.exe /d /s /c "npm run build"`、`node tools/run-ci-command.mjs typecheck-contracts C:\Windows\System32\cmd.exe /d /s /c "npm run typecheck:contracts"`、`node tools/run-ci-command.mjs architecture C:\Windows\System32\cmd.exe /d /s /c "npm run validate:architecture"`、`node tools/run-ci-command.mjs architecture-negative C:\Windows\System32\cmd.exe /d /s /c "npm run validate:architecture:negative"`、`node tools/run-ci-command.mjs lint C:\Windows\System32\cmd.exe /d /s /c "npm run lint"`。
- 次に`.github/workflows/ci.yml:36-92`の全Node gateを同じlabelで順に実行する。package scriptは全て上記の`cmd.exe /d /s /c "npm run <script>"`形にする。例: `node tools/run-ci-command.mjs test-unit C:\Windows\System32\cmd.exe /d /s /c "npm run test:unit"`、`test-t403 ... "npm run test:t403"`、`test-t405 ... "npm run test:t405"`、`test-t406 ... "npm run test:t406"`、`test-t304 ... "npm run test:t304"`、`test-t502 ... "npm run test:t502"`、`test-t505 ... "npm run test:t505"`、`test-t604 ... "npm run test:t604"`、`test-t605 ... "npm run test:t605"`、`test-t606 ... "npm run test:t606"`、`test-t609 ... "npm run test:t609"`、`test-t610 ... "npm run test:t610"`、`test-git ... "npm run test:git"`、`test-github ... "npm run test:github"`。workflow内のinline Node testは各々同じ `node tools/run-ci-command.mjs <workflow-label> node --test <workflow記載のtest-distパス>` として実行する。
- Windows固有の実Extension Host routeは`xvfb-run -a`を除き、`node tools/run-ci-command.mjs test-t506 C:\Windows\System32\cmd.exe /d /s /c "npm run test:t506"`、`node tools/run-ci-command.mjs test-t609-extension-host C:\Windows\System32\cmd.exe /d /s /c "npm run test:t609:extension-host"`、`node tools/run-ci-command.mjs test-vscode C:\Windows\System32\cmd.exe /d /s /c "npm run test:vscode"`。これはWindowsの実UI hostを使うためLinux CIそのものの代替ではない。
- 成功時・失敗時とも各wrapperは `test-output/ci/<label>.stdout.log`、`.stderr.log`、`.log`、`.result.json` を生成する。Extension Host各phaseは追加で `test-output/vscode-launch-diagnostics/<phase>-<timestamp>.json` を生成する。PR CIでは別途`review-range-user-validation-<version>`（VSIX、source ZIP、version.json）又は`ci-failure-diagnostics-*` artifactを対象candidate HEADに一致させて確認する。

## 対象ファイル

- 変更: このreportの本sub-agent担当欄のみ。
- 確認: `package.json`、`.github/workflows/ci.yml`、`tools/run-ci-command.mjs`、`test/vscode/run-extension-host.ts`、`test/vscode/owned-extension-host-launch.ts`、既存Windows診断を含む `reports/pr-115-independent-final-review-20260907.md` とPR #120の既存report群。

## 指摘事項

- `verification_capability` は `local_execution_available`。Node `v24.20.0`、npm `11.19.0`、Git `2.46.0.windows.1` は利用可能で、Node系build/testとGit fixtureをローカル実行できる。
- `code` は利用可能だが版は`1.92.0`で、manifestの`^1.125.0`より古い。実Host runnerはinstalled `code`を使用せず、`@vscode/test-electron`で固定`1.130.0`を`.vscode-test`へ取得して起動する。現時点で`.vscode-test`は無いため、最初のhost runはarchive downloadを必要とし、runnerにはそのための300秒launch timeoutがある。
- Linux CI parityはこの端末でunsupported。workflowのT506/T609/VS Code Hostは`ubuntu-latest`と`xvfb-run -a`を要求するが、`xvfb-run`は存在しない。`wsl.exe --list --quiet`もexit 1でusageを返し、使用可能なWSL distributionを確認できなかった。Linux exact-headの合否とartifactはGitHub Actionsで確認する。
- Windows既知held: 過去exact-target記録には、Git working-tree path判定19件、symlink fixtureの`EPERM`、及び`vscode-updating` mutexによるHost未起動がある。これは今回未実行であり、再現時もpassへ読み替えず、wrapper logとHost diagnosticsでcandidate/base差分を分類する。

## 結果

- 結果: final routeを確定。PDS-01を含む製品変更がcommitされたfinal technical HEADごとに、まず上記Windows wrapper routeを一回実行し、全ログ・result JSON・Host diagnosticsを保存する。Windows outcomeはplatform固有の補助証拠として扱い、required Linux parity、PR packaging、VSIX manifest、failure artifactは同一headのGitHub Actions CIで完結させる。
- 開始時のrepository HEADは`c2dfc3cb27efd79bdf41c4e0ad7b9534161b588b`（`investigation/issue-119-linked-diff-blocks`）で、指定baselineと一致した。本調査では全体試験、製品変更、commit、push、mergeを行っていない。

## リスク

- 全体ローカル検証は通常レビュー収束後の最終候補で一回実施する。内容変更があれば影響する証拠を無効化する。管理報告のみの差分で実装証拠を無条件に再実行しない。最終CIとartifactは公開HEADの一致を別途必要とする。
- Windowsの実Host初回runは固定VS Code archiveのdownloadと外部updater mutexに依存する。失敗した場合、`test-output/vscode-launch-diagnostics/`のphase JSONとwrapperの4ファイルを保存して、Hostが実際に起動したかを分けて判定する。
- WSL/Linux hostはこの端末で利用不能のため、`xvfb-run`をPowerShellへ移植してLinux CI成功を主張しない。matching GitHub Actions runのcheckout SHA、各job conclusion、success artifact又はfailure diagnostics artifactが必要である。
