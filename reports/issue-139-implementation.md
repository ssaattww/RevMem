# Issue #139 実装・検証報告

## 対象

- Issue: https://github.com/ssaattww/RevMem/issues/139
- PR: https://github.com/ssaattww/RevMem/pull/140
- branch: `issue-139-redetect-closed-merged` / base: `main`
- base HEAD: `a479bf5cf2b35f342a8dab90dc886a19d8233520`
- 設計コミット: `6a5d510bdacd06640a63d9a7051ebd59e2211102`
- 設計: `Design/Issue139PullRequestRediscovery.md`
- 本報告は実装者による通常報告。独立レビュー判定ではない。実装公開HEADはPR metadataと親への引渡しに記録する。

## 変更

- GitHub検索を`state=all`へ変更。branchが確定した場合はhead refとhead repositoryを照合し、SHAの違いだけでは除外しない。同じSHAでも別branch/forkを除外する。
- local-gitでtracking remote/refを解決。trackingがないbranchはidentity remoteと現在refを使用し、detached HEADは既存のHEAD一致へ縮退する。異なるhostと削除head repositoryの対応は推測しない。
- 候補にopen / closed / mergedを保持し、既存Quick PickのPR番号・タイトルに状態を表示する。
- 新しいContextは選択PRのimmutable HEADを使用。保存済みPRの再選択も選択HEADをowner同期対象にし、別PRのrevision/review stateを変更しない。
- 明示選択はrepository/HEAD/branch refごとに保存。別branchに同じHEADがあっても選択を持ち越さない。選択closed/mergedはCurrent Contextとして保持する。
- 検索境界を`findByHead`へ改名しcontract fixtureを追随。破壊的TypeScript境界変更を`Design/BreakingChanges.md`へ記録。
- Issue139のproduction回帰を`npm run test:unit`へ追加。T406 HTTP fixtureと明示選択closedの期待値を新要件に合わせた。

## 要件と証拠

| Issue139受入条件 | 検証 |
| --- | --- |
| 未保存open検出・表示 | Issue139 production未保存open |
| 未保存closed検出・表示 | Issue139 production未保存closed |
| 未保存merged検出・表示 | Issue139 production未保存merged |
| 同名別repository/fork除外 | SHA共通でも別fork/branch/削除repositoryを除外、別host除外 |
| 複数候補の状態表示 | production Quick Pickでclosed/open/mergedのdescriptionを確認 |
| 保存有無・Context/Progress/review分離 | 未保存3状態、保存済みclosed/merged、別PR files/head/history不変、同HEAD別branch選択分離 |

## 実行結果

- TDD初期Red: compile:test成功後、Issue139の5件が失敗。SHA不一致の候補未検出、同SHAの別fork/branch混入、tracking境界欠落を再現。
- branch分離Red: 同HEAD別branchへ選択PRが持ち越される1件が失敗。修正後に成功。
- 別hostRed: APIへ進んでnetwork unavailableになる1件が失敗。修正後に空候補として成功。
- `npm run build`: 成功。
- `npm run typecheck:contracts`: 成功。
- `npm run validate:architecture` / `npm run validate:architecture:negative`: 成功。
- `npm run lint`: 成功。
- `npm run compile:test`後、Issue139 / t405-review-followup / review-contexts-storage / pr-progress-remote-tracking-revision / mock-githubの5ファイル: **52/52成功**。
- `git diff --check`: 成功。
- 全体`npm test`、exact-head CI、通常レビュー、独立最終レビューはこの公開時点では未完了。実機UIは未検証。

## 作業境界と次の手順

FA780の専用checkoutのみ変更。PR138、他担当checkout/session、依存、認証・権限・環境設定、workflowは変更しない。通常commit/pushのみ。
全体検証を完了し、正確な公開HEADとログを親へ渡す。親が通常/独立最終レビューを手配する。exact-head必要CIと保護条件を照合し、親の最終連絡前にはマージしない。

## IR139-001 と全体検証fixtureの修正

- 独立レビュー対象`307f8484ab325ccd2b13c22290d8da19ba513aff`でP1 IR139-001を指摘された。選択PRと未選択兄弟のremote HEADが同じ場合、選択HEADへrepository全体を同期して兄弟のreview stateも再マップしていた。初回52件ではこの兄弟ケースが不足していた。
- 指摘資料を読取のみで確認し、実production fixtureにローカルHEAD=B、PR52 closed/C、PR53 open/C、PR53確認済み[1,2)の回帰を追加。修正前に兄弟HEADがCへ変わるRedを確認した。
- 選択後のowner同期へ対象Context IDを渡す。選択HEADへの同期では未選択Contextのmetadata/revisionを固定し、repository-level CASは維持する。未選択兄弟のHEAD、files/確認済み範囲、履歴が不変となるGreenを確認した。
- 初回全体検証はT407 HTTP fixtureの`state=open`条件から未表示pickerを無期限待ちしていた。所有を起動コマンド・PID・作成時刻で照合した自担当検証ツリーだけを終了し、exit1として記録。成功扱いにはしない。
- T407 fixtureを`state=all`とhead ref/repository metadataへ追随。単独11/11成功。
- 修正後build、contract型検査、lint、diff check成功。Issue139 / T405 follow-up / T407の3ファイルで45/45成功（IR139-001を含む）。独立指摘のclosure判定は親と同一独立reviewerが行う。
- 修正後HEADで全体検証とCIを再実行する。以前の結果・中断を新HEADの成功証拠に流用しない。

## IR139-002 の修正

- 独立レビューで旧v1のrepository+HEAD選択が元branch不明のまま別branchへ引き継がれるP1を指摘された。回帰テストで同SHAのunrelated branchにclosed PR候補が混入するRedを確認した。
- branch付き読取ではbranch付き保存キーのみ使用する。旧選択がある場合はHEADのみの自動推論も抑止し、再検出による明示選択で関連付けを確立する。旧Contextの保存データは保持する。
- fixtureは実際のsymbolic-refを参照し、detached時はdetached selectionを返す。
- 修正後build、compile:test、typecheck:contracts、lint、diff check成功。Issue139/T405 composition/T405 follow-up/T407の対象回帰は49/49成功（IR139-001/002を含む）。ログはcheckout外のissue139-ir002-focused.log。
- 886a39fの全体検証はunit 896/896まで成功したが、IR139-002修正に伴い所有プロセスを停止したため全体成功には数えない。修正後の公開HEADで全体gate/CIを再実行する。独立指摘closure判定とマージ可否は親と独立reviewerの確認待ち。

## CI既存契約回帰の追修正

- abdd457のPR CI 37933097191はIssue106/PR108段階で既存PR108-PRODUCT-002の2件失敗。兄弟lifecycle unavailable時の中断と、認証回復後のownerHEAD同期がIR139-001修正で失われていた。成功扱いにしない。
- 全PR lifecycleの取得・認証確認は復元し、取得不可ならrepository-ownerのcommit前に中断する。ローカルHEADと選択PR HEADが異なる場合のみ未選択兄弟の更新を固定し、ownerHEADが一致する通常同期の既存契約を維持する。
- abdd457の全体gate47148はbuild/契約型/architecture/negative/lint成功、tooling16/16、unit897/897、Git48成功+既定skip3、GitHub48/48、T502 11/11成功後、VS Code t306起動で失敗(exit1)。診断ではvscode-updating mutexが30秒後も保持され、extension-host起動前に終了した。これは全体成功に数えない。他担当やVS Code更新プロセスは操作していない。
- 追修正後build/compile:test/契約型/lint/diff check成功。IR001/002を含むIssue139＋PR108-002＋T405 composition＋T407は34/34成功、別実行のIssue106全3ファイル＋PR108 product全ファイルは37/37成功。ログはcheckout外のissue139-ci-fix-focused.log / issue139-ci-fix-pr108.log。
