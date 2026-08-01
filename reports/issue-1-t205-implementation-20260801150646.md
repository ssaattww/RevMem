# T205 Implementation実行レポート

## メタデータと対象identity

- report type: `implementation_report`
- generated at: `2026-08-01T15:06:46+09:00`
- repository: `ssaattww/RevMem`
- Issue: `#1`
- task: `T205`
- mode: `initial implementation`
- branch: `task/t205-branch-context-resolver`
- base ref: `main`
- base SHA: `68a2b49847fcaae2dd5943358c8ff875a1ce75a9`
- PR: `#27`
- reviewed implementation HEAD: 該当なし。本レポートは実装レポートであり、独立レビュー判定を含まない。
- implementation HEAD: `fb4e4f7206f35b04cc43b2f7057a92b0ce62c675`
- relevant commit range: `68a2b49847fcaae2dd5943358c8ff875a1ce75a9..fb4e4f7206f35b04cc43b2f7057a92b0ce62c675`
- persistence mode: `repository_file`
- reserved path: `reports/issue-1-t205-implementation-20260801150646.md`

## 目的

T205として、Git管理下の通常エディタ状態について、branch context resolver、detached commit context、Git状態監視、commit更新時のcontext revision再計算を実装する。T104、T202、T203、T204の既存contractを再利用し、branch切替時のcontext分離と、同一branchでHEADが進んだ場合のContext/Global確認済み範囲の追従を成立させる。

## authoritative requirementsと設計参照

- ユーザー指示: RevMemの実装はTDDを基本とし、先に失敗テストを追加してから実装する。小さな論理単位でcommit/pushし、詳細reportをrepositoryへ保存し、PRへ簡易reportを投稿する。mergeは利用者が行う。
- `tasks/tasks-status.md`: T205はbranch context resolver、detached commit context、Git状態監視、context revision更新と再計算を対象とし、T104/T202/T203/T204へ依存する。
- `doc/design/vscode-review-range-tracker-design.md`: branch/commit単位のcontext識別、同一path変更のrange mapping、rename/copy/add/deleteのfile transition、履歴不足時の保守的失効、binary除外、Context/Globalの一貫更新を要求する。
- `.github/workflows/ci.yml`: build、contract typecheck、architecture、lint、unit、Git integration、GitHub mock、VS Code Extension Hostを実行し、失敗時はstdout/stderr、test result、source/test/config、環境、Git状態、調査logをdiagnostic artifactへ保存する。

## scope

- Repository IDとfull branch refを用いるbranch context identity。
- commit object IDを用いるdetached commit identity。
- branch identityからmoving HEADを除外し、同一branch内のcommit更新では同一contextを維持する。
- Contextとrepository owner-wide Global stateを旧revisionから新revisionへ再計算する。
- T203のsame-path interval mappingとT204のrename/copy/add/delete transitionを合成する。
- unique rename後もstable file IDをdocument routingで再利用する。
- add/copyで既存document routingと同じrepository-scoped file IDを生成する。
- binary diff sectionをline review mappingから除外し、text file mappingを継続する。
- 旧Git objectが利用できない場合、対象pathを未確認として保守的に新revisionへ進める。
- pollingでbranch/HEAD/detached変化を検出し、同一snapshotを重複通知しない。
- timer駆動のcallback失敗をerror boundaryへ渡し、未処理Promise rejectionを防止する。
- callback失敗時は旧monitor baselineを維持し、次回pollで同じtransitionを再試行する。
- Node Local Git adapterへshell文字列を使わないcomplete zero-context revision diff境界を追加する。

## non-goals

- PR contextの解決やGitHub API連携。
- UI上の進捗表示、設定UI、通知UIの追加。
- task trackerの状態更新。
- 設計書の再構成またはT205以外の仕様変更。
- CI workflowの変更。既存workflowが必要なfailure diagnosticsを保存済みのため変更しない。
- 独立コードレビュー、review verdict、merge。

## 実装内容

### Git context resolver

- `GitReviewContextResolver`をapplication層へ追加した。
- branch context IDは`branch-context + repositoryId + refs/heads/...`のdomain-separated SHA-256とし、moving HEADをidentityに含めない。
- detached HEADはfull commit object IDを必須とし、`detached-context + repositoryId + HEAD@commit`でcommitごとに分離する。
- persisted schemaとの互換性を維持するため、detached contextのlogical kindは`detached-commit`としてresolver結果へ公開し、永続化時は既存`ReviewContextState.kind = branch`と`refName = HEAD@<commit>`を使用する。

### Context/Global revision mapper

- `GitContextRevisionMapper`を追加し、ContextとGlobalのcomplete snapshotを同じ新revisionへ進める。
- T204のfile transitionでrename/copy/add/deleteを処理し、T203のinterval mapperで同一pathの通常変更を処理する。
- unique renameでは元file IDとreviewed rangeを保持し、`previousPaths`へ旧pathを記録する。
- add/copyの新file IDは`repository-file + repositoryId + currentPath`から生成し、通常document routingのidentity contractと一致させる。
- Global stateも同じdiffとmapping policyで進める。
- 旧objectが存在しない場合はrangeを推測せず、現revisionで読めるpathだけを未確認状態として保持する。
- `Binary files ... differ`および`GIT binary patch`を含むdiff sectionはline-review mapping対象から除外する。完全diff取得contractは変更しない。

### Git状態監視

- `PollingGitStateMonitor`を追加した。
- repository ID、root、branch/detached、HEADのfingerprintが変化した場合だけ通知する。
- pollは直列化し、重複timer callbackによる同時pollを防止する。
- timer駆動の失敗は`onError`へ渡し、未処理Promise rejectionを発生させない。
- change callback成功後にだけbaselineを更新する。失敗時は旧baselineを保持し、後続pollで再試行する。
- `dispose()`でtimerと観測対象を解放する。

### document routing統合

- Git context準備用providerを既存のrouted/reconciled providerの前段へ追加した。
- document open/decorate時にGitを1回だけinspectionし、そのsnapshotでcontext初期化またはrevision mappingを実行した後、既存routingへ同じinspection結果を渡す。
- Context/Global complete snapshotの更新は既存repository transaction境界を用い、stale transaction時は最新snapshotから最大3回再計画する。
- Git rename後はpersisted `currentPath`からstable file IDを解決し、新path由来IDへ分裂させない。
- 同一currentPathへ複数file IDが存在する矛盾状態は推測せず拒否する。
- monitor callback経由のmappingが失敗した場合、monitor baselineを先に更新しない。

### Local Git revision source

- Node adapterへ`git diff --unified=0 --find-renames --find-copies <old> <new> --`をargument listで実行する境界を追加した。
- shell command stringは構築しない。
- real temporary Git repositoryを使用し、complete zero-context diffが既存parserで解釈できることをintegration testで確認した。

## changed files

- `package.json`: T205 unit/integration test wiringと`test:t205`を追加。
- `src/application/review-context/contracts.ts`: resolver、revision source/mapper、monitorのportsとdata contract。
- `src/application/review-context/git-review-context-resolver.ts`: branch/detached context resolver。
- `src/application/review-context/git-context-revision-mapper.ts`: Context/Global revision mapping、T203/T204合成、binary filtering、保守的fallback。
- `src/application/review-context/polling-git-state-monitor.ts`: serialized polling、dedup、error boundary、retry baseline。
- `src/application/review-context/index.ts`: application API export。
- `src/adapters/local-git/node-local-git-adapter.ts`: complete revision diff source。
- `src/adapters/document-review-state/git-context-document-review-state-session-provider.ts`: Git context準備、mapping、polling、CAS retry。
- `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`: public providerをGit context準備経由へ変更。
- `src/adapters/document-review-state/document-review-state-session-provider.ts`: persisted pathからrename後stable file IDを解決。
- `src/adapters/document-review-state/index.ts`: Git-aware provider option export。
- `test/unit/git-review-context-lifecycle.test.ts`: resolver、mapping、history不足、added-file identity、monitor transition。
- `test/unit/document-git-context-lifecycle.test.ts`: branch commit、branch switch、detached context、rename routing。
- `test/unit/git-context-revision-mapper-binary.test.ts`: binary section混在時のtext mapping回帰。
- `test/unit/polling-git-state-monitor-error.test.ts`: scheduled error boundaryとretry回帰。
- `test/integration/git-context-revision-source.integration.test.ts`: real Git complete diff integration。

## TDD evidence

| phase | HEAD | exact matching run | result | diagnostic artifact |
|---|---|---:|---|---|
| Initial Red | `bf7372ec9fb023447aec3e964403fce45c4cd42a` | `30684822827` | 未実装module/contractで失敗 | `8813524266` `ci-failure-diagnostics-30684822827-1` |
| First complete Green | `41f07090adf9aa85a3f517f73ff86a56122547d9` | `30685458858` | 全工程成功 | 該当なし |
| Added-file identity Red | `7eb37ac5ba664b94c6d07165680268b9c8dbd9e9` | `30685681629` | path-only IDとrepository-scoped IDの不一致 | `8813810126` |
| Added-file identity Green | `a08d0a1ae77307019eddc34c0fae15c6315bd63d` | `30685749873` | 全工程成功 | 該当なし |
| Rename routing Red | `fed078c4c9e35f40622617d6620be066a0d98921` | `30685898552` | rename後に新path由来IDを返して失敗 | `8813889582` |
| Rename routing Green | `44f05d4c09cac633182f1a5f7304f5922ba552ee` | `30686105349` | 全工程成功 | 該当なし |
| Real Git integration Green | `f29310ffae28fa972dc1c879ef53b2f980324418` | `30686219355` | 全工程成功 | 該当なし |
| Binary mapping Red | `e6ec7707e013ffdba60b08dd414109d79596fec2` | `30686334431` | binary new-file sectionがtext transition parserを停止 | `8814045086` |
| Binary mapping Green | `c7e5412cacfea3c0eaf9deab0d451abc1ab8521e` | `30686476383` | 全工程成功 | 該当なし |
| Scheduled error Red | `bae230cbb370b405cb4082365913e5fcc6bd3f37` | `30686622476` | `onError` contract未実装で失敗 | `8814144182` |
| Scheduled error Green | `207c17b392392e8e32488bb5013c18c52a9801f6` | `30686687450` | 全工程成功 | 該当なし |
| Retry baseline Red | `2e1dfdbeafdbc1c52d4aba05bd8c6d1d2538b075` | `30686828187` | callback失敗後の試行回数が`1`のまま | `8814219601` |
| Implementation Green | `fb4e4f7206f35b04cc43b2f7057a92b0ce62c675` | `30686940290` | 全工程成功 | 該当なし |

上表のCIはすべて記載HEADとworkflow runの`head_sha`が一致するrunのみを使用した。別SHAのrunは代用していない。

## final validation

implementation HEAD `fb4e4f7206f35b04cc43b2f7057a92b0ce62c675`に一致するCI run `30686940290`で以下を確認した。

- Build: success
- Contract typecheck: success
- Architecture validation: success
- Negative architecture fixture validation: success
- ESLint: success
- Unit tests: success
- Git integration tests: success
- GitHub mock tests: success
- VS Code Extension Host tests: success
- Failure diagnostic artifact upload step: failureなしのためartifact生成対象外

focused validationは`test:t205`へresolver、document lifecycle、binary mapping、monitor error/retry、real Git revision sourceを登録し、broader validationはCI全工程で実施した。

## failure diagnostics

- 既存workflowが失敗工程のstdout/stderrを`ci-logs/*.log`へ保存する。
- test results、generated output、source、test、type fixtures、tools、package/tsconfig/eslint設定、environment、Git status/log/diffをfailure diagnostic packageへ含める。
- 本作業中のRedおよび中間失敗では、各matching runの`ci-failure-diagnostics-*` artifactを確認した。
- workflowは要件を満たしていたため変更していない。

## intentionally untouched

- `tasks/tasks-status.md`: tracker更新権限を持つplanner/sync workerの対象であり、本implementation workerでは変更しない。
- `doc/design/vscode-review-range-tracker-design.md`: 既存設計がT205の動作を規定しており、新しい設計判断を追加していないため変更しない。
- `.github/workflows/ci.yml`: failure diagnostics要件を既に満たしているため変更しない。
- T205以外のtask実装、既存PR、release/versioning: 対象外。
- merge: 利用者の境界であり実行しない。

## blocked、unknown、held、unexplored

- blocked: なし。
- unknown: native Windows runner上のmixed-case Git tree pathは本PRのCIでは個別検証していない。CIのreal Git integrationはUbuntu上で実行した。
- held: PR #27の独立コードレビューとmerge判断は別workerおよび利用者へ保持する。
- unexplored: 実運用規模の大規模repositoryでのpolling負荷、長大diffの性能、UI上のエラー通知はT205の自動test範囲外。

## remaining risks

- polling errorは未処理Promiseにせず同じtransitionを再試行するが、document providerは現時点でuser-facing notification callbackを設定していない。次回foreground open/loadでもmappingを再実行する。
- force-push等で旧objectが失われた場合の保守的失効はfake revision sourceで検証した。実Git object pruneを伴うintegration testは実施していない。
- detached contextはlogical contract上`detached-commit`だが、persisted stateは既存schema互換のため`kind = branch`と`HEAD@commit`を使用する。将来schemaを分離する場合はmigrationが必要になる。

## next action

- 別workerによるPR #27のコードレビューを実施する。
- review結果への対応が完了した後、利用者がmergeを判断する。
- task tracker更新が必要な場合は、tracker更新権限を持つplanner/sync workerが実施する。

## merge boundary

- PR #27は作成・更新済みである。
- 本作業ではmergeを実行しない。
