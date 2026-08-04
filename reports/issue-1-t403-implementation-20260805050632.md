# T403 実装レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Task: `T403`
- Pull Request: `#44`
- Branch: `task/t403-github-cache`
- Base: `main` / `490389037f8bf83441a76798fe20d16b48de3d8b`
- Implementation HEAD before this report: `7054a1bd6b4dabe839f145feeaf001dbd4ce09de`
- Mode: initial implementation
- Merge: 未実施

## 目的と範囲

T403として、T402のimmutable PR diff取得結果を対象に、GitHub PR metadataとsource-redacted diffをrepository-local cacheへ保存し、GitHub APIが429またはnetwork failureで利用不能な場合に限って取得済みPRをoffline表示できるapplication serviceとfilesystem adapterを実装した。

cacheは`contextId`、GitHub host、owner、repository、PR番号、base SHA、head SHAの完全一致で識別する。live取得時刻と期限をISO 8601で記録し、offline読込時には`fresh`または`stale`を明示する。期限切れcacheも取得済み情報として返すが、古い状態であることをresult contractから判別できる。

永続diffにはfile identity、path、status、additions/deletions、hunk座標、line kindとline番号だけを保持し、line textは空文字列へredactする。GitHub tokenはcache contractに含めず、runtime objectに余分なtoken fieldが混入しても永続documentへコピーしない。

T404の複数PR layer永続化、T405のReview Contexts View/runtime配線、T604の複数process lock・cache cleanup、mergeは対象外とした。

## authoritative requirements

- `tasks/tasks-status.md` T403: GitHub metadata・diff cache、期限、最終更新時刻、429・network failure時のoffline読込を実装する。
- 完了条件: tokenとsource本文を不要に永続化せず、offline時に取得済みPRを表示し、古い状態を明示する。
- `doc/design/vscode-review-range-tracker-design.md`: API制限・network failure時はlocal Gitまたはcacheへfallbackし、最終成功更新時刻を表示する。tokenは永続化しない。
- RevMem実装はTDDを基本とし、先にfailureを確認してから実装する。
- failure時にはtest結果、標準出力、標準エラー、原因調査logをartifactへ保存する。
- current PR HEAD SHAとworkflow run head SHAが一致するrunだけをCI証拠に使用する。
- 詳細reportをrepositoryへ保存し、別途簡易reportをPR commentへ投稿する。
- mergeは利用者が行う。

## 診断artifact workflow

作業開始時に`.github/workflows/ci.yml`を確認した。既存workflowは各commandを`2>&1 | tee test-output/ci/*.log`で実行し、failure時に次を`actions/upload-artifact@v4`へ保存する。

- test/build/architecture/lint command log（標準出力・標準エラーを含む）
- `dist/`、`test-dist/`、source、tests、tools、type fixtures
- environment、Git status、生成file一覧
- package/TypeScript/ESLint/workflow設定

したがって診断情報の追加自体は不要だった。T403 focused testを継続的に実行するため、同workflowへ`npm run test:t403`のgateと専用log `test-output/ci/test-t403.log`を追加した。

### TDD Red artifact

- Red commit: `c5be5413ff75983eba207b3c5add7dd6b05d088b`
- Exact-head CI run: `30944663833`
- Job: `92111537433`
- Conclusion: failure
- Artifact: `ci-failure-diagnostics-30944663833-1`
- Artifact ID: `8906569405`

未実装の`src/application/github-pr-cache/index`と`NodeGitHubPullRequestCacheStorage`を参照するtestを先に追加したため、`compile:test`が意図どおり失敗した。別SHAのrunは使用していない。

### focused fixture correction artifact

- HEAD: `b1386942ad7fe045bd9f42eb9a5305080bbc1240`
- Exact-head CI run: `30945163506`
- Job: `92113212075`
- Conclusion: failure
- Artifact: `ci-failure-diagnostics-30945163506-1`
- Artifact ID: `8906772323`

実装後のfocused test 5件中4件は成功し、identity mismatch用fixtureだけがsource本文を残したcache entryを直接storageへ書こうとして失敗した。production storageが安全境界どおり拒否した結果であり、storageを緩めずfixtureをsource-redacted entryへ修正した。

## TDD記録

### Redで固定した契約

初期testで次を定義した。

1. live GitHub取得結果を返す際、利用者へ返すsnapshotのsource textは維持する。
2. 永続cacheでは全line textをredactし、source本文を保存しない。
3. 更新時刻と期限を明示する。
4. 429またはnetwork failure時だけexact cacheへfallbackする。
5. 期限切れcacheを返す場合は`stale`と明示する。
6. generic API failureではcacheを代用しない。
7. context/repository/PR/base/headの一つでも違うentryを使用しない。
8. metadataとdiffを別領域に保存し、一つのgeneration pointerで公開する。
9. tokenとsource本文をfilesystemへ保存しない。

### Green implementation

次を小さな論理単位で追加した。

- cache-aware acquisition contractとresult contract。
- source-redacted cache entryのstrict parser・clone・identity serializer。
- deterministic in-memory storage。
- 429/network限定のoffline fallback service。
- metadata/diff generationとlatest pointerを使用するfilesystem adapter。
- public adapter export、type fixture、focused/default test wiring、CI gate。
- application codeをcontracts、entry validation、service、in-memory storageへ責務分割。

追加の自己点検で、network failureの期限内`fresh`経路、source-bearing direct write拒否、extra token field除去をtestへ追加した。

## 実装構成

### Application contract

- `src/application/github-pr-cache/contracts.ts`
  - T402 acquisition port、cache entry/storage、freshness status、live/offline resultを定義。
  - offline resultは失敗したlive attemptを保持し、診断情報を失わない。

### Cache entry validation

- `src/application/github-pr-cache/cache-entry.ts`
  - request、metadata、snapshot、timestampをruntimeで再検証する。
  - exact context/repository/PR/base/head identityを要求する。
  - canonical POSIX repository-relative path、status/path matrix、status統計を検証する。
  - file identity/display pathの重複を拒否する。
  - hunk順序、座標、line cursor、old/new count、additions/deletionsを検証する。
  - binary entryにhunkが存在する場合を拒否する。
  - 永続cacheでは全line textが空文字列であることを要求する。
  - schema version、canonical ISO timestamp、`expiresAt >= updatedAt`を要求する。

### Cache-aware acquisition service

- `src/application/github-pr-cache/github-pull-request-cache-service.ts`
  - T402 live acquisitionを先に実行する。
  - valid metadata/snapshotを取得した場合だけredacted entryを保存する。
  - cache write失敗時も完全なlive結果を破棄せず、`not-cached`として返す。
  - remote attemptに`rate-limit`または`network`がある場合だけcacheを読む。
  - cache read/corruption/identity mismatch時は元の`unavailable`を保持する。
  - offline結果へ`fresh`/`stale`、`updatedAt`、`expiresAt`を付与する。

### Storage adapters

- `src/application/github-pr-cache/in-memory-github-pull-request-cache-storage.ts`
  - exact identity keyとdetached cloneを用いるtest/application storage。
- `src/adapters/github/node-github-pull-request-cache-storage.ts`
  - identityをSHA-256 keyへ変換する。
  - `cache/github/<key>/metadata-<generation>.json`へmetadataを保存する。
  - `cache/diffs/<key>/diff-<generation>.json`へredacted diffを保存する。
  - 両generation fileの書込後に`cache/github/<key>/latest.json`をatomic replaceし、不完全generationを公開しない。
  - pointer内pathを再構築値と照合し、path injectionを拒否する。
  - unsafe generation名、corrupt JSON、document identity不一致を拒否する。
  - persistence直前にentryを正規化し、未知fieldを永続documentへコピーしない。

### Public/test wiring

- `src/application/github-pr-cache/index.ts`: responsibility-based module export。
- `src/adapters/github/index.ts`: Node cache adapter export。
- `type-fixtures/contracts/t403-github-pr-cache.fixture.ts`: public positive/negative type contract。
- `type-fixtures/contracts/tsconfig.json`: fixture登録。
- `package.json`: `test:t403`追加、`test:github`へT403 suiteを接続。
- `.github/workflows/ci.yml`: focused T403 gateとstdout/stderr logを追加。

## test coverage

`test/unit/github-pull-request-cache.test.ts`は6件を実行する。

1. live取得時にtimestampを付与し、cacheだけをsource-redactedにする。
2. 429時に期限切れexact cacheを返し、`stale`と表示する。
3. network failure時に期限内exact cacheを返し、`fresh`と表示する。
4. generic API failureではcacheを代用しない。
5. context/repository/PR/base/head identity mismatchを拒否する。
6. filesystem generation round-trip、source-bearing write拒否、extra token除去、source/token非永続化を確認する。

## 検証

### Exact-head Green CI

implementation HEAD `7054a1bd6b4dabe839f145feeaf001dbd4ce09de`に完全一致するCI run `30946152467`、job `92116526756`はsuccessだった。

成功したgate:

- Install dependencies
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T403 GitHub cache tests
- T304 PR progress tree tests
- T502 Global mapping and display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- Temporary Git integration tests
- Mock GitHub integration tests（T403 suiteを含む）
- VS Code Extension Host tests

success runのためfailure context collectionとartifact uploadはskipされた。

このreportとhandoffの保存後は新しいHEADになるため、PR commentには保存後のcurrent HEADと一致するrunだけを最終CI証拠として記録する。実装HEADのrunを最終HEADへ代用しない。

## security・fail-closed境界

- tokenはapplication cache contract、metadata document、diff document、pointerのいずれにも存在しない。
- 未知fieldはvalidated entryへ再構築する際に除去する。
- source-bearing line textを含むentryはstorage write前に拒否する。
- cache identityはmoving refではなくfull base/head object IDを含む。
- exact identity不一致、corrupt JSON、schema mismatch、非canonical timestamp、invalid path/status/hunk/statisticsを使用しない。
- API failure全般へ広げず、task指定の429/networkだけをoffline fallback対象にする。
- cache write/read failureを確認済み状態や別PR dataへ推測変換しない。
- metadata/diffを先に書き、latest pointerを最後にatomic replaceする。

## intentionally untouched

- `tasks/tasks-status.md`: repository ruleにより`task-breakdown-planner`、`task-consistency-manager`、`progress-sync-manager`経由でのみ更新可能なため、本implementation workerでは変更していない。
- `doc/design/vscode-review-range-tracker-design.md`: T403のcache、offline、timestamp、token非永続化方針が既に定義されており、設計変更を必要としなかった。
- `src/extension.ts`とruntime composition: T404/T405範囲。
- persistent PR review layer、Review Contexts View、command/UI表示: T404/T405範囲。
- multi-process lock、generation cleanup、容量上限: T604範囲。
- merge、release: 利用者または後続workflowの範囲。

## remaining risks

- offline diff cacheはprivacy要件によりsource本文を持たない。offline UIは取得済みPR metadata、file/hunk座標、進捗用構造を表示できるが、remote source本文そのものをcacheだけから復元しない。
- metadataのtitle/stateは最終成功取得時点の値であり、`stale`時はGitHub上の最新状態と異なる可能性がある。resultのtimestamp/freshnessをT405 UIが明示する必要がある。
- cache generationのcleanup、容量制限、複数VS Code process間lockはT604に残る。T403 adapterはimmutable generationとpointer-last publicationを提供する。
- force-pushなどでhead SHAが変わった場合は別identityとなり、旧revision cacheを新revisionへ代用しない。
- runtime compositionはT404/T405で実装されるまで現在のVSIX UIへ接続されない。

## 次のaction

- PR #44を通常reviewへ渡す。
- reviewerはPR current HEADを固定し、そのSHAに一致するCI runだけを使用する。
- T404/T405は本contractの`offline-cache`、`freshness`、`updatedAt`、`expiresAt`をUI/persistent layerへ接続する。
- mergeは利用者が行う。
