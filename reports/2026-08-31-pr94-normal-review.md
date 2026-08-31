# Sub-agent実行レポート

## タスク

- 目的: PR #94 repair review-target HEAD `e2c5260`をIssue #92・design・CI要件に対して通常reviewする。
- タスク種別: normal code review

## sub-agentを使う理由

- 理由: 実装担当と異なるSol/high reviewerが、CI publication前に全変更と直接依存を確認するため。

## 対象範囲

- 対象: base `017e5aeebadbd8b676f72af6791ca455b926c55d`からreviewed HEAD `e2c5260`までのPR #94全差分、Issue #92、design、tests、validation evidence。

## 対象外

- 対象外: 実装、commit、push、merge、CI待機、performance CI追加、PR外変更。

## 実行コマンド

- 実行コマンド: `git rev-parse HEAD`、`git status --short`、`git diff --stat/--name-status/--numstat/--check対象確認 017e5ae...e2c5260`、`git log 017e5ae..e2c5260`、`gh issue view 92 --json ...`、`gh pr view 94 --json ...`、`Get-Content`/`rg`による全変更path・design・直接依存・test名・report evidence確認、`git ls-tree -r e2c5260`によるtemporary artifact残存scan、`package.json` test wiringと`.github/workflows/ci.yml`照合。
- 疑義の最小再現: HEAD一致の既存`test-dist`に対し`node -e`で`restoreImmutableRevisionSnapshots`へ3行のimmutable evidenceと`[0,99)`のGlobal snapshotを入力。exit 0で`global.kind = "hit"`となり、範囲外intervalが復元された。full/default/Extension Host/performance test、nested Codex、CI waitは実行していない。

## 対象ファイル

- 変更または確認したファイル: `017e5aeebadbd8b676f72af6791ca455b926c55d...e2c526078f6f1315689026a14446454671ab6e79`の62変更pathを全件確認した。内訳はdesign 2、`package.json`、report 26、product 19、tracking 2、unit test 12。productは`src/adapters/document-review-state/git-context-document-review-state-session-provider.ts`、`src/adapters/state-repository/persistence-schema-recovery.ts`、`src/application/github-pr-context/*`、`src/application/repository-global-state/repository-global-state-repository.ts`、`src/application/review-commands/*`、`src/application/review-context/git-context-revision-mapper.ts`、`src/application/review-history/review-history-recorder.ts`、`src/core/contracts/*`、`src/core/review-state/*`、`src/t305-extension.ts`、`src/t405-pull-request-review-runtime-base.ts`、`src/ui/pr-progress/*`。
- 直接依存として`src/application/review-contexts/pull-request-revision-evidence-loader.ts`、`src/application/global-review-mapping/*`、`src/core/git-diff/*`、`src/ui/pr-progress/pull-request-progress-tree-data-provider.ts`、`src/extension.ts`、repository CAS/persistence route、`.github/workflows/ci.yml`を確認した。全変更test 12件はtest case名とproduction接続を確認し、全変更report、`tasks/tasks-status.md`、`tasks/phases-status.md`も履歴・主張・残存riskを照合した。
- review中の変更は本reportのみ。review開始時のworking deltaは本reportだけで、reviewed HEADは不変だった。reviewed HEADにはIssue #92用temporary workflow/payload/probe/root markerは残存せず、`.github`差分もなく、意図されたproduct/test/design/tracking/reportだけが残る。performance CI追加もない。

## 指摘事項

- **PR94-NR-001 — high / blocker / origin: normal review**
  - 場所: `src/application/review-context/git-context-revision-mapper.ts:286-320`（特に`:293`）。
  - 内容・証拠: target snapshotをContext/Global独立にrestoreしているが、採用するのは両方が`hit`の分岐だけである。一方だけ`hit`の場合はその結果を捨て、`:324`以降で両layerを通常mappingする。`doc/design/immutable-revision-review-snapshots.md:110-119`および`doc/design/vscode-review-range-tracker-design.md:137`は、存在するlayerをexact restoreし、miss layerだけmappingして同一CASでpublishする契約である。PR mapperには同じmixed処理があるがlocal Git mapperにはない。実装report `reports/2026-08-31-pr94-snapshot-slice-3c.md`の残存riskもこの欠落を明記している。
  - 影響: local GitでContext hit/Global missまたは逆の遷移を行うと、保存済みexact状態が現在revisionからのdiff mappingで置き換えられ、既知revisionへ戻った際の確認状態を失う。A→B→C→A保証がlayer非対称状態で成立しない。
  - 必須対応: local Git mapperもlayerごとにhit/missを合成し、hit側はrestore、miss側だけmapし、最終Context/Globalとtarget snapshotsを1回のCASで公開する。Context-hit/Global-missと逆方向のproduction composition fixture、history reason、CAS conflictをfocused testで固定する。
- **PR94-NR-002 — high / blocker / origin: normal review**
  - 場所: `src/core/review-state/revision-snapshot-service.ts:184-202`（特に`:197-199`）。
  - 内容・証拠: `ImmutableRevisionSnapshotFileEvidence.lineCount`はContextだけ比較され、Global snapshotの`reviewed` intervalをimmutable target line countへ照合しない。最小再現では3行evidenceに対する`[0,99)`を持つGlobal snapshotが例外なく`hit`として返った。designのfail-closed契約（`doc/design/immutable-revision-review-snapshots.md:41-43, 204`）はline count/interval bounds不整合の拒否を要求する。
  - 影響: owner-wide Global snapshot、特に対象fileがContext snapshotに存在しない場合、target document外の確認済み範囲をexact stateとして採用できる。破損persistenceのquarantine/restore境界を迂回し、不確実な範囲を確認済みとして公開する。
  - 必須対応: Global evidenceにも実content由来line countを必須化し、restore前に全Global intervalの上限を照合する。Global-only fileの範囲外、欠落line-count evidence、persistence round-trip/quarantine、Context miss/Global hitをfocused testへ追加する。
- **PR94-NR-003 — medium / blocker / origin: normal review**
  - 場所: `src/core/review-state/review-state-service.ts:93-113`（特に`:96`）。
  - 内容・証拠: `ReviewStateOperation`へ2つのoriginal-selection operationを追加した一方、`ModifiedReviewStateTransaction.operation`の`Exclude`は旧2 operationしか除外していない。このため`mark-original-selection-reviewed`/`unmark-original-selection-reviewed`を`side`・`diffId`なしのModified transactionとして型検査上構築でき、`ReviewStateTransaction`のdiscriminated unionが契約どおりdiscriminateしない。
  - 影響: exported transaction型のconsumerが無効なtyped compositeを作成でき、history recorderは実行時にdiff identity欠落で失敗し得る。atomic composite/history orderingをcompile-timeで保証できない。
  - 必須対応: Modified側operation unionから全original operationを除外するか、modified/original operation型を別名で定義して共有する。original-selection operationに`side: "original"`と`diffId`が必須、modified variantでは不許可であるnegative contract fixtureを追加する。
- **PR94-NR-004 — medium / blocker / origin: normal review**
  - 場所: `package.json:144`。
  - 内容・証拠: 新規`test/unit/issue-92-pr-progress-context-menu.test.ts`のemitted JSが`test:unit`にも他のpackage test scriptにも登録されていない。CIは`test:unit`と`test:t405`を実行するが、後者にもこのfileはない。broader validationのdirect 82/82は一時的な明示実行証拠であり、恒久package/CI wiringを代替しない。
  - 影響: exact tab object identity、PR Progress provenance、非diff拒否、open成功後だけのrecordというIssue #92の主要境界が通常CIで回帰しても検出されない。
  - 必須対応: このtestを`test:unit`またはCIが必ず呼ぶfocused scriptへ登録し、CI workflow contractで到達性を固定する。
- user-confirmation-required gap: なし。4件はいずれも受理済みdesign/PR scope内の実装修正であり、仕様選択待ちではない。
- held non-blocker: reviewed HEAD `e2c526078f6f1315689026a14446454671ab6e79`はlocal repair targetで、remote PR #94 headは確認時`1171bb9132ddd72c263715bd5beb605137a69da2`。`e2c5260`一致pull_request CIは未公開・未確認であり、親workflowがfix convergence後にpush/publicationとexact-head CIを所有する。Markdown lintはrepository wiring不在で`unsupported`。performance CIは明示的非目標。

## 結果

- 結果: **fail**。review modeはinitial normal review。`reviewed_implementation_head = e2c526078f6f1315689026a14446454671ab6e79`、base/commit rangeは`017e5aeebadbd8b676f72af6791ca455b926c55d...e2c526078f6f1315689026a14446454671ab6e79`。reviewerは実装・repairに参加していないdedicated normal reviewerで、built-in code reviewのみ実施した。
- findings first verdict: required finding 4件（high 2、medium 2）。severity reclassification/erratumなし。finding completeness matrixは全件closure未準備: PR94-NR-001はmixed production path/両方向composition fixture/focused evidenceが未実装、PR94-NR-002はGlobal bound validation/quarantine fixtureが未実装、PR94-NR-003は型修正/negative contract fixtureが未実装、PR94-NR-004はpackage/CI wiringが未実装。fix後は同じfinding ID・severityでproduction path、actual composition fixture、focused evidenceを揃えてfix verificationする必要がある。
- coverage disposition: requirement/design conformance=`checked_finding`(NR-001/002/003)、correctness/edge cases=`checked_finding`(NR-001/002)、scope discipline/temporary cleanup=`checked_no_finding`、changed files/direct dependencies=`checked_finding`、API/data/persistence/config/compatibility=`checked_finding`(NR-002/003)、error handling/fail-closed=`checked_finding`(NR-002)、security/secret handling=`checked_no_finding`、tests/validation adequacy=`checked_finding`(NR-004)、current-HEAD local validation=`checked_no_finding`（broader reportのbuild/contracts/architecture正負/lint/compile/direct 82/82/diff-checkをreview evidenceとして評価）、current-HEAD pull-request CI=`held`、reports/tracking/documentation accuracy=`checked_finding`（NR-001の既知riskをcompletion扱いできない）、regression/maintainability=`checked_finding`。public API JSDocとpackageの既存T405/CI到達性は直接確認し、追加指摘なし。
- unexplored: なし。full/default/Extension Host/performanceの再実行は明示禁止・既存evidence利用のため未実行だが、review coverage自体は全変更pathと直接依存へ到達した。mergeは許可しない。

## リスク

- 未解決のリスクまたは後続対応: PR94-NR-001〜004が解消されるまでnormal reviewは収束せず、independent-final-review targetをfreezeしてはならない。特にmixed local restoreとGlobal fail-closedは保存済み確認状態の正確性に直結する。
- 修正後は同一finding IDでbounded fix verificationを行い、両mixed方向、Global-only corrupt bounds、invalid transaction negative typing、package/CI test到達性のcompleteness matrixを満たすこと。修正によりHEADが変わるため、本verdictは新HEADへ転用できない。
- held事項はremote publication後のexact-head pull_request CIとMarkdown lint unsupportedのみ。performance CI追加は要求しない。report persistence以外のcommit/push/merge/PR更新は本reviewでは実施していない。
