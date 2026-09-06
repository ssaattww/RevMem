# Issue #116 検証証拠と最終ゲート計画

- repository: ssaattww/RevMem
- branch: fix/issue-116-context-refresh
- base: d86f2da0cfc5d19cac14e90ffbf5c5a85fd08c9a
- 初期実装HEAD: 1a9711b90686b9a971875ca7ff353a7274c1fb2c
- verification_capability: local_execution_available。Node24/npm11、既存lockfileのnpm ci導入済み。
- focused証拠: reports/issue-116-implementation-20260907.md。実装担当がAの重複5回→期待1回のRed、BのAPI追加前compile Red、test:i116 19/19、build/lint/contracts/architecture正負を記録した。後記immutable gate追加後はfocused19/19を再確認した。
- 絶対時間の実機保証はない。設計probeの11inspection約15.8秒はadvisoryであり、Issueの14.3秒全量を帰属させない。

## 最終ゲートの実行境界

通常レビューと修正が収束した後、すべての非final文書をcommitした候補HEADで、既存CIに含まれる非性能gateを一度実行する。lockfileが変わらなければ依存導入を再利用する。各独立stepは失敗後も継続し、候補SHA、command、時刻、stdout/stderr、exit codeをbranch外へ保存する。T607の性能workloadは追加しない。

- full gate: not_started（この報告保存時点）。
- 正本: .github/workflows/ci.ymlとpackage.json。WindowsではLinux用xvfb-run wrapperを付けない。
- full gate継続担当: /root/issue116_validation（専用担当へ実行を依頼する）。要求profileはterra high、applied null / final_profile_hiddenを明記する。
- 出力先: C:/Users/taiga/AppData/Local/Temp/RevMem-issue116-full-<candidate7>/。
- exact candidateの実行結果はbranch外証拠として独立レビュワーへ渡し、合格後の事前予約済み独立review報告に保存する。この計画文書を実行結果の自己参照のために再commitしない。

## 既知の環境差と判定

PR #115（同じbase tree）で確認したWindowsのsymlink EPERM、document path semantics、owned Host timing、VS Code updater mutexは既知の比較材料である。Issue #116のcurrent-head検証結果の代用にはしない。同じfailureが出た場合は変更起因を確認してheldに分類し、成功へ丸めない。最終attestation HEADに一致するLinux pull_request CIと生成artifactを確認する。

Markdown専用lintのrepository wiringはなく、focused/fullともunsupportedかつnonblocking。diff checkと本文/設計整合をレビューする。設定や依存の追加は行わない。

## 保存時点の状態

commit_pending / push_pending / ci_wait_pending。通常レビュー、最終全体検証、独立レビュー、最終CIはこの文書生成時点で未完了である。最終結果は独立報告とPR本文のexact HEADを正本とする。
