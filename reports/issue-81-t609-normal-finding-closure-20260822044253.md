# Sub-agent実行レポート

## タスク

- 目的: 初回通常review `reports/issue-81-t609-normal-review-20260822013643.md` の既存finding `T609-NR-001`〜`T609-NR-007`を、frozen HEAD `6ba97488a96e7ffe94e05115ced23c211704d3bd`で同一reviewerがfinding限定closureする。
- タスク種別: normal review finding-limited closure。7件のseverityとoriginを固定し、新規観点・新規findingを追加せず、全件を一括dispositionした。

## sub-agentを使う理由

- 理由: 初回通常reviewを担当したreviewerが、各required actionのproduction path、actual composition、focused evidence、gate wiring、trackingを同一基準で再評価するため。

## 対象範囲

- 対象: base `3bba5defe32b7da134817492427e09c70c97beaf`、review target `6ba97488a96e7ffe94e05115ced23c211704d3bd`。初回7 findingsのrequired actionと、その直接follow-upであるR2、R3、R8〜R15、該当production/test/gate/trackingだけを確認した。
- evidence: R2 core focused 24/24、R3 `test:t609` 44/44、R13 storage+gate 22/22、R15 actual Extension Hostの3 phase+cleanup Green、各follow-upに記録されたbuild、compile:test、contract、architecture正負、lint、diff-check Greenをprovided evidenceとして評価した。

## 対象外

- 対象外: 新規criterion、新規finding、severity変更、全範囲再review、実装修正、test/build/lint/CI再実行、CI待機、commit、push、PR/Issue操作、tracking変更、独立review。

## 実行コマンド

- 実行コマンド: `Get-Content`、`rg`、`git diff`、`git rev-parse`、`git status`によるread-only inspectionだけを実施した。test、build、lint、CIは実行していない。
- Markdown lint: repo-local `tools/lint/`、`lint:md`、cspell配線がないためfocused/fullとも`unsupported`。passへ読み替えずheldとした。

## 対象ファイル

- 確認対象: 初回review report、R2/R3/R8〜R15 follow-up、7 findingsに対応するproduction source、focused/unit/Extension Host fixture、`package.json`、`.github/workflows/ci.yml`、`tasks/tasks-status.md`、`tasks/phases-status.md`、`Design/BreakingChanges.md`。
- write boundary: 本reportの予約済み9 placeholderだけを置換し、他fileは変更していない。

## 指摘事項

- `T609-NR-001` — High — `closed`。production path=`checked_no_finding`: `src/t305-extension.ts:109`が`workspace.decode`をLocal Git adapterへ注入し、`src/t405-review-contexts-runtime.ts:612-624,1066-1081`がopened hint集合を`currentGlobalForNewPullRequest`へ渡す。actual composition=`checked_no_finding`: `src/t405-new-pull-request-global-composition.ts:18-59`を実際のGit repository、adapter、mapperで通すShift-JIS fixtureがある。focused evidence=`checked_no_finding`: R2のT405 encoding 1/1とcore focused Green。gate wiring=`checked_no_finding`: suiteは`test:t609`と`test:unit`へ一度ずつ接続。tracking=`checked_no_finding`: T609 trackingのT405 encoding実配線記載と一致する。
- `T609-NR-002` — High — `closed`。production path=`checked_no_finding`: `src/adapters/document-review-state/git-context-document-review-state-session-provider.ts:521-530,557-566`がrepository内の全観測hintをmappingへ渡す。actual composition=`checked_no_finding`: production provider fixtureが複数opened hint、encoding変更、新providerでのreopenを通し、R15は新HostでUTF-8 BOMだけを再観測した。focused evidence=`checked_no_finding`: R2 coreとR15 Green。gate wiring=`checked_no_finding`: provider lifecycle suiteとHost suiteは専用/通常gateへ接続。tracking=`checked_no_finding`: all-opened hint、restart-reopenの記載と一致する。
- `T609-NR-003` — High — `closed`。production path=`checked_no_finding`: `src/application/review-context/history-rewrite-git-context-revision-mapper.ts:94-105`がhintをT602 recoveryへ伝播し、`src/application/history-rewrite-recovery/git-context-recovery.ts:193-217`が非`found` fileを隔離してcatalogを継続する。actual composition=`checked_no_finding`: history-rewrite coordinatorを通すfocused integrationがrecoverable file保持、invalid file unresolvedを検査する。focused evidence=`checked_no_finding`: R2 core Green。gate wiring=`checked_no_finding`: integration suiteは`test:t609`と既存T602 gateへ接続。tracking=`checked_no_finding`: T602 recovery実装済み記載と一致する。
- `T609-NR-004` — High — `open`。production path=`checked_no_finding`: ambiguous Current Contextは明示selectionへ進み、T405 cancel/staleは専用cancellation outcomeでprovider clear/errorを避ける。actual composition=`checked_finding`: `test/vscode/t609-suite/index.ts:170-173`はselection seamを`cancel`/`stale`へ設定した後に`reviewRange.refreshReviewContexts`を呼ぶだけだが、そのcommandは`src/ui/review-contexts/vscode-review-contexts-runtime.ts:316`のprovider refreshであり、seamを消費する`inspectActiveRepository`はredetect/reconnect等の別経路にある。R15 Greenはrepository Quick Pick cancel/staleを実際には通していない。focused evidence=`checked_no_finding`: Current Context selectionとcancellation boundaryのunit fixtureはGreen。gate wiring=`checked_finding`: static gateはHost sourceの文字列とphase配置を固定するだけでproduction seam到達を証明しない。tracking=`checked_finding`: actual multi-root cancel/stale Greenという記載は証拠より強い。required action: actual T405 command/compositionからrepository selection seamを必ず通し、cancelとstaleの双方で既存provider projection・保存stateが不変であることを観測するHostまたは同等のactual composition evidenceを追加する。
- `T609-NR-005` — Medium — `closed`。production path=`checked_no_finding`: mapperがimmutable text read失敗を`immutable-text-unavailable`としてfile単位で保持し、providerからhistory recorderへ渡す。actual composition=`checked_no_finding`: production provider/history appender fixtureが`mapping-unresolved`とgeneric reasonを観測する。focused evidence=`checked_no_finding`: R2 core Green。gate wiring=`checked_no_finding`: mapper/provider suitesは`test:t609`と`test:unit`へ接続。tracking=`checked_no_finding`: reason付きunresolved記載と一致する。
- `T609-NR-006` — Medium — `open`。production path=`checked_no_finding`: `package.json:149-150`と`.github/workflows/ci.yml:73-76`に専用unit/Host gateがあり、R13のWindows containment修正はsibling・outside・link/junction拒否を維持する。actual composition=`checked_finding`: R15のsingle-root mixed encoding、restart-reopen、cleanupは有効だが、multi-root cancel/stale phaseは`T609-NR-004`記載のとおり対象production seamへ未到達で、要求matrixを完了していない。focused evidence=`checked_no_finding`: R3 44/44、R13 22/22、R15全phase Greenはreportから確認。gate wiring=`checked_no_finding`: dedicated scriptsとCI stepは重複なく接続済み。tracking=`checked_finding`: matrix全完了という記載はcancel/staleのsemantic coverage不足と不一致。required action: production repository-selection seamへ到達するactual multi-root cancel/stale fixtureへ修正し、専用Host gateでその観測を固定してからtrackingを同期する。
- `T609-NR-007` — Medium — `open`。production path=`checked_finding`: 元の`unsupported-encoding` union追加と`invalid-encoding.encoding`拡張は互換型へ戻ったが、同じfollow-upで公開barrelからexportされる`GitContextRevisionMappingResult`へrequired `unresolvedReasonsByFileId`を追加した（`src/application/review-context/contracts.ts:119-128`、`src/application/review-context/index.ts:13`）。これはその型を構築するconsumerにsource-breakingで、`Design/BreakingChanges.md`はbaseから不変である。actual composition=`not_applicable`: public型互換性はconsumer contractで判定する。focused evidence=`checked_finding`: provided contract typecheck Greenは既存fixtureだけで、旧shape consumerを固定していない。gate wiring=`checked_finding`: compatibility fixtureまたはBreaking Changes contractがない。tracking=`checked_finding`: 公開互換性実装済みという記載はrequired member追加を反映していない。required action: 新diagnostic memberを後方互換なoptional/internal boundaryへ変換するか、承認済みsource-breaking contractとして`Design/BreakingChanges.md`とconsumer actionを記録しcontract fixtureを追加する。

## 結果

- disposition: `closed`は`T609-NR-001`、`002`、`003`、`005`の4件。`open`は`T609-NR-004`、`006`、`007`の3件。既存7件を一括評価し、新規findingとseverity変更はない。
- normal verdict: `fail`。normal-path blockerはHigh `T609-NR-004`。Medium `T609-NR-006`と`T609-NR-007`もrequired action未完了。user-confirmation-required capability gapはなし。
- coverage disposition: 7 findingsのproduction path、actual composition、focused evidence、gate wiring、trackingはすべて`checked_no_finding`、`checked_finding`、`not_applicable`のいずれかへ処分済み。`unexplored`はなし。reviewed HEADは`6ba97488a96e7ffe94e05115ced23c211704d3bd`。

## リスク

- non-blocking held: exact-head CI、full local equivalence、Markdown lint unsupported。CIは待機していない。held自体は追加blockerではないが、open findingがあるためpre-freeze/full local equivalenceとindependent final reviewへは進めない。
- 次工程: `T609-NR-004`/`006`のactual multi-root cancel/stale compositionと`T609-NR-007`の公開互換性を限定follow-upし、同じreviewerがこの3件だけを再closureする。全件closed後にpre-freeze/full local equivalence、続いてindependent final reviewへ進む。
