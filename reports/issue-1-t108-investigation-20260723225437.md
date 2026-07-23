# Sub-agent実行レポート

## タスク

- 目的: T108の実装前調査として、RevMemの現状機能とSSCのGitHub Release方式を確認し、VSIX配布と日本語READMEの具体的な変更案を確定する
- タスク種別: 調査

## sub-agentを使う理由

- 理由: requirement・参照実装・現状機能の独立確認は固定sub-agent対象であり、sol highによる調査がユーザー指定されているため

## 対象範囲

- 対象: RevMemのmanifest、実装、テスト、CI、VSIX packaging設定、SSCのGitHub Release workflow、日本語READMEに記載可能な現状機能・インストール・操作手順

## 対象外

- 対象外: ファイル編集、実装、Release実行、GitHub上の状態変更、将来機能を実装済みとして記載すること

## 実行コマンド

- 実行コマンド:
  - `git status --short --branch`
  - `git fetch origin main`
  - `git rev-parse HEAD`
  - `git rev-parse origin/main`
  - `git log -5 --oneline --decorate`
  - `rg --files -g '!node_modules' -g '!out' -g '!dist'`
  - `Get-ChildItem -Force`
  - `Get-ChildItem -Recurse -Force .github`
  - `Get-Content -Raw <manifest・実装・テスト・CI・設計・進捗ファイル>`
  - `rg -n <機能・制限・T108・将来タスクを識別する検索語> src test tasks doc package.json .vscodeignore`
  - `git ls-remote https://github.com/ssaattww/SSC.git refs/heads/main`
  - `git ls-remote https://github.com/ssaattww/RevMem.git 'refs/tags/*'`
  - `gh release list --repo ssaattww/RevMem --limit 20`
  - `gh release list --repo ssaattww/SSC --limit 5`
  - `gh api repos/ssaattww/SSC/contents/.github/workflows/publish-nuget.yml`
  - `gh api repos/ssaattww/SSC/releases/latest`
  - `gh api 'repos/ssaattww/SSC/releases?per_page=5'`
  - `gh api repos/ssaattww/RevMem/releases --jq 'length'`
  - `gh api repos/ssaattww/RevMem/tags --jq 'length'`
  - `Test-Path tools/lint`
  - `package.json`の`lint:md` script有無確認
  - `git diff --check -- reports/issue-1-t108-investigation-20260723225437.md`
  - `git status --short`
  - GitHub上の一次資料をブラウザーで直接確認:
    - `https://github.com/ssaattww/SSC/blob/main/.github/workflows/publish-nuget.yml`
    - `https://github.com/microsoft/vscode-vsce/blob/v3.9.2/src/validation.ts`
    - `https://github.com/microsoft/vscode-vsce/blob/v3.9.2/src/main.ts`
    - `https://github.com/microsoft/vscode-vsce/blob/v3.9.2/src/package.ts`
    - `https://code.visualstudio.com/api/references/extension-manifest`
    - `https://cli.github.com/manual/gh_release_create`
    - `https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows`

## 対象ファイル

- 変更したファイル:
  - `reports/issue-1-t108-investigation-20260723225437.md`のみ
- RevMemで確認したファイル:
  - `README.md`（現時点では0 byte）
  - `package.json`
  - `package-lock.json`
  - `.vscodeignore`
  - `.github/workflows/ci.yml`
  - `src/extension.ts`
  - `src/ui/normal-editor/review-command-registration.ts`
  - `src/ui/normal-editor/normal-editor-decoration-controller.ts`
  - `src/application/review-commands/normal-editor-review-command-service.ts`
  - `src/application/editor-decoration/normal-editor-decoration-model.ts`
  - `src/application/workspace-identity/workspace-identity-service.ts`
  - `src/adapters/workspace-review-state/workspace-review-state-session-provider.ts`
  - `src/adapters/state-repository/contracts.ts`
  - `src/adapters/state-repository/storage-router.ts`
  - `src/adapters/state-repository/debounced-review-state-repository.ts`
  - `src/adapters/state-repository/file-system-review-state-repository.ts`
  - `src/adapters/state-repository/coherent-file-system-review-state-repository.ts`
  - `src/core/intervals/selections.ts`
  - `src/core/review-state/review-state-service.ts`
  - `test/vscode/suite/index.ts`
  - `test/unit/line-intervals.test.ts`
  - `test/unit/normal-editor-review-command-registration.test.ts`
  - `test/unit/normal-editor-review-command-service.test.ts`
  - `test/unit/normal-editor-decoration-controller.test.ts`
  - `test/unit/normal-editor-decoration-model.test.ts`
  - `test/unit/workspace-review-state-session-provider.test.ts`
  - `test/unit/state-repository.test.ts`
  - `test/unit/debounced-review-state-repository.test.ts`
  - `tasks/tasks-status.md`
  - `tasks/phases-status.md`
  - `doc/design/vscode-review-range-tracker-design.md`
- SSCで確認したファイル:
  - `.github/workflows/publish-nuget.yml`
  - GitHub API確認時のファイルblob SHA: `777ef81b2a1a672894d9bb16133024341a5c4ea6`
  - 調査時のSSC `main`: `ce57238404db8e27e5ccb031885508a855d0895b`

## 指摘事項

- 基準commit:
  - `git fetch origin main`後、RevMemの`HEAD`と`origin/main`はいずれも`f21f8b900426d02553981aac7d9a4d5d663508a1`（T107完了）だった。
  - worktreeには親agent所有の`tasks/tasks-status.md`、`tasks/phases-status.md`の変更と、事前作成済みの本レポートが存在する。これらのうち本レポート以外は変更していない。
- RevMemで現時点に利用者が使える機能:
  - 通常テキストエディタのカーソル行または選択行を「確認済み」にできる。
  - 通常テキストエディタのカーソル行または選択行の「確認済み」を解除できる。
  - 複数選択に対応し、重複・隣接する行範囲は正規化して結合する。
  - 選択終端が次行の0文字目の場合、その終端行は対象外になる。カーソルだけの場合はその1行が対象になる。
  - ファイル全体を確認済みにできる。実行前にモーダル確認を表示する。
  - ファイル全体の確認済みをすべて解除できる。実行前に「Global確認済み状態も解除されます」と明示するモーダル確認を表示する。
  - 4コマンドはコマンドパレットと通常エディタの右クリックメニューから実行できる。
  - 確認済み行をテーマ対応のグレー背景で行全体に装飾する。
  - 既定でガターアイコンを表示し、設定で非表示にできる。
  - 既定ではOverview Rulerを表示せず、設定で表示できる。
  - hoverに現在context、確認日時、Global active/inactiveを表示する。
  - 同じdocumentを分割表示している場合、成功した確認・解除後にすべてのvisible editorを即時更新する。
  - 確認・解除はcontext状態とGlobal状態を同一transactionで更新し、永続化成功後にだけ成功装飾を表示する。
- 公開設定と既定値:
  - `reviewRange.showGlobalReviewed`: `true`。Global確認済み範囲を通常エディタ装飾へ重ねる。
  - `reviewRange.showGutterIcon`: `true`。確認済み行のガターアイコンを表示する。
  - `reviewRange.showOverviewRuler`: `false`。確認済み範囲をOverview Rulerへ表示する。
  - theme color IDは`reviewRange.reviewedBackground`と`reviewRange.reviewedOverviewRuler`。
  - 必要VS Code versionは`engines.vscode: ^1.125.0`。
  - extension IDは`taiga.review-range-tracker`、実行場所は`extensionKind: ["workspace"]`。
- 永続化挙動:
  - 現在の`src/extension.ts`はGit/PR resolverを接続せず、すべての対象をworkspace contextとして`WorkspaceReviewStateSessionProvider`へ渡す。
  - workspace folder URI、document URI、workspace相対pathから安定IDを生成する。
  - 状態はrepository内へ書かず、VS Codeの`ExtensionContext.storageUri`配下の`workspace-state.json`へ保存する。
  - コマンドtransactionは即時にatomic commitし、初期化・sanitize用のcomplete snapshot saveだけを既定50msでdebounceする。
  - load/commit前に同一targetのpending saveをflushし、deactivate時にも受理済みI/Oとpending saveをflushする。
  - T107のExtension Host試験は、1回目の起動で確認、再起動後の装飾復元と解除、さらに再起動後も解除状態が維持されることを検証している。
  - 現在内容のhash、path、line count、revisionが保存状態と一致しない場合、不確実な確認済み表示を出さない。次のコマンドopen時には当該ファイルのcontext/Global状態を削除して保存する。
- READMEへ明記すべき現状の制限:
  - diff editorは未対応。コマンドは実行せず警告を表示し、装飾も表示しない。
  - workspace folder外のファイルとuntitled editorは対象外。単一folderのworkspaceで使う案内が安全である。
  - 現時点ではGit repository内でもbranch、commit、Git diff、GitHub PRを認識せず、workspace contextとして扱う。
  - 編集差分への行追従は未接続。内容hashが変わると、そのファイルの保存済み範囲を新しい内容へ推測適用せず無効化する。
  - rename/move追従は未実装で、相対pathが変わると別file IDになる。
  - 複数root workspaceは`storageUri`を共有する一方、folderごとにrepository IDが異なるため、現実装ではidentity mismatchになり得る。対応済みと記載しない。
  - append-only historyは`requestHistory`がno-opで、履歴保存・閲覧は未実装。
  - PR進捗、理解率、Activity Bar/Tree View、GitHub認証・offline cacheなどtasksの将来機能はREADMEへ混ぜない。
- READMEへ提案する日本語「現状できること」:
  - 「通常エディタで、カーソル行・単一選択・複数選択を確認済み／未確認へ切り替えられます」
  - 「ファイル全体の確認／全解除ができ、どちらも実行前に確認ダイアログを表示します」
  - 「確認済み行はグレー背景で表示され、ガターアイコンとOverview Rulerは設定で切り替えられます」
  - 「hoverでcontext、確認日時、Global状態を確認できます」
  - 「確認状態はworkspace単位のVS Code拡張保存領域へ保存され、VS Code再起動後に復元されます」
  - 「安全のため、ファイル内容が変わった場合は以前の確認済み範囲を新しい内容へ自動で引き継ぎません」
  - 上記に続けて「現在の制限」としてdiff editor、Git/PR非対応、編集・rename追従なし、履歴なし、単一folder workspace推奨を明示する。
- READMEへ提案する日本語「インストール方法」:
  - 動作要件としてVS Code 1.125.0以上を先に明示する。
  - GitHub Releasesの`0.0.1-pre`から`review-range-tracker-0.0.1-pre.vsix`をダウンロードする。
  - VS Codeの拡張機能ビュー右上の`...`から「VSIX からのインストール...」を選び、ダウンロードしたVSIXを指定する。
  - CLIの場合は`code --install-extension review-range-tracker-0.0.1-pre.vsix`を実行する。
  - Marketplace公開ではなく手動VSIX配布であること、更新時も新しいRelease assetをダウンロードして再インストールすることを明示する。
- READMEへ提案する日本語「使い方」:
  - folderを1つ開き、そのfolder内のファイルを通常エディタで開く。
  - 対象行を選択するか、対象行へカーソルを置く。
  - 右クリックまたはコマンドパレットで「Review Range: 選択範囲を確認済みにする」または「選択範囲の確認済みを解除する」を実行する。
  - 全行を対象にする場合は「ファイル全体を確認済みにする」または「ファイル全体の確認済みを解除する」を実行し、確認ダイアログを承認する。
  - `reviewRange.showGutterIcon`、`reviewRange.showOverviewRuler`、`reviewRange.showGlobalReviewed`を必要に応じて変更する。
- SSCのGitHub Release workflowの一次調査結果:
  - `.github/workflows/publish-nuget.yml`は`release: published`、`push: main`、任意versionを受け取る`workflow_dispatch`で起動する。
  - job権限は`contents: write`と`pull-requests: read`、secretは`NUGET_API_KEY`。
  - `actions/checkout@v5`を`fetch-depth: 0`で使い、`actions/setup-dotnet@v5`で.NET 8を準備する。
  - Release起動時はtagから先頭`v`を除いてpackage versionを決め、main push時は最新stable tagとcommit数から`<major>.<minor>.<patch>-pre`を計算する。
  - 2つのprojectをrestore/build/packし、`./artifacts/*.nupkg`をNuGet.orgへpushする。
  - main push時だけ`gh release view "$tag"`で既存Releaseを確認し、存在しなければ`gh release create`を`--target "$sha"`、`--title "$tag"`、`--notes-file`、`--prerelease`で実行する。
  - SSCの直近pre-release（`0.4.1-pre`～`0.4.4-pre`）はtag名とrelease名が一致し、targetは各main commitである。ただしRelease assetsは空であり、NuGet packageはRelease assetではなくNuGet.orgへ送っている。
- RevMem向けRelease構成案:
  - triggerは`push`の`branches: [main]`を採用する。T108 workflowがmainへ初回mergeされたpushでそのworkflow自身が評価され、最初のReleaseを自動作成できる。
  - `pull_request: closed`は不要。merge commitへの`push: main`で同じ契機をより単純に扱える。
  - `release: published`は最初のReleaseを作れず、作成済みReleaseへassetを後付けする構成になるため、今回の「初回mergeでRelease作成」には主triggerとして使わない。
  - 任意の手動再実行用に`workflow_dispatch`を併設してよいが、version入力は持たせず`0.0.1-pre`へ固定し、意図しない別Release作成を防ぐ。
  - `permissions`はjobまたはworkflowで`contents: write`のみで足りる。PR番号を独自API取得しないなら`pull-requests: read`は不要。
  - `concurrency.group: release-0.0.1-pre`と`cancel-in-progress: false`で同時作成競合を防ぐ。
  - `env`で`RELEASE_VERSION=0.0.1-pre`、`RELEASE_TAG=0.0.1-pre`、`ASSET_NAME=review-range-tracker-0.0.1-pre.vsix`、`ASSET_PATH=artifacts/review-range-tracker-0.0.1-pre.vsix`を固定する。
  - `actions/checkout@v5`は`fetch-depth: 0`、`actions/setup-node@v5`は既存CIと同じNode 24、cacheはnpmを使う。
  - `npm ci`後、既存CI相当の`npm run build`、`npm run lint`、`npm run test:unit`、`npm run test:git`、`npm run test:github`、`xvfb-run -a npm run test:vscode`を通してからpackageする。
  - packageは`mkdir -p artifacts`後、`npx vsce package --no-dependencies --pre-release --out "$ASSET_PATH"`とする。既存`package` scriptを使う場合は`npm run package -- --pre-release --out "$ASSET_PATH"`でもよい。
  - uploadとRelease作成は1コマンドで`gh release create "$RELEASE_TAG" "$ASSET_PATH" --target "$GITHUB_SHA" --title "$RELEASE_VERSION" --generate-notes --prerelease`とする。GitHub CLI一次資料ではasset引数を付けた`gh release create`はdraft作成、asset upload、publishの順に処理するため、assetなしReleaseを公開する窓を小さくできる。
- `0.0.1-pre`のversion・名前整合:
  - 推奨はtag名=`0.0.1-pre`、release名=`0.0.1-pre`、`package.json` version=`0.0.1-pre`、VSIX名=`review-range-tracker-0.0.1-pre.vsix`で完全一致させること。
  - `package-lock.json`のroot `version`と`packages[""].version`も`0.0.1-pre`へ同期する。
  - VS Code公式Extension Manifestは`version`を「SemVer compatible version」と規定する。
  - RevMemが固定している`@vscode/vsce` v3.9.2の`validateVersion`は`semver.valid(version)`で判定するため、有効なSemVer prereleaseである`0.0.1-pre`を許容する。
  - v3.9.2は`vsce package [version]`、`--no-git-tag-version`、`--no-update-package-json`、`--pre-release`も備える。今回はsource manifest自体を正しいversionへ更新し、CIで一致を検証する方が監査しやすい。
  - `--pre-release`はVSIX metadata上のpre-release指定であり、GitHub Releaseの`--prerelease`とは別である。両方を指定する。
  - したがってversion分離案は通常不要。もし実package/install smokeで環境固有の拒否が判明した場合だけ、内部package version=`0.0.1`、GitHub tag/release=`0.0.1-pre`、asset=`review-range-tracker-0.0.1.vsix`へ分け、READMEに差を明記するfallbackが可能。ただし名前の一貫性が下がるため第二案とする。
- 再実行時の冪等性:
  - workflow開始時に`gh release view "$RELEASE_TAG" --json tagName,name,isPrerelease,assets`でReleaseを確認する。
  - tag、release名、pre-release属性、期待asset名がすべて正しければ成功終了し、後続main pushでも新しいReleaseを作らない。
  - Releaseがなく同名tagだけ存在する場合は、tagのcommitとbuild対象を確認し、不一致なら上書きせず失敗する。
  - Releaseはあるがassetがない部分失敗時は、そのRelease tagのcommitをcheckoutして同じVSIXを再生成し、`gh release upload "$RELEASE_TAG" "$ASSET_PATH" --clobber`で補修する。現在のmain HEADから再生成するとtag内容とassetが不一致になるため禁止する。
  - 同名assetがある場合は`--clobber`で無条件上書きせずskipする。metadataやtagが期待と違う場合は自動修正せず失敗させる。
  - repositoryでimmutable releasesが有効な場合、公開済みReleaseへの後付け・置換はできない。最初からasset引数付き`gh release create`を使うことが重要で、部分失敗の補修不能時は明示的な手動判断が必要になる。
- 必要な変更ファイル:
  - 新規`.github/workflows/release-vsix.yml`: fixed first pre-releaseの検証、package、冪等なRelease作成・asset upload。
  - `package.json`: versionを`0.0.1-pre`へ変更。必要ならpackage scriptに明示outputを追加するが、workflowから`--out`を渡せばscript変更はversionだけでよい。
  - `package-lock.json`: root package versionを`0.0.1-pre`へ同期。
  - `README.md`: 上記の現状機能、制限、インストール、使い方。
  - `.vscodeignore`: 現状でも`.github`、source、test、reports、tasks、`node_modules`、map、lockfileを除外し、README、LICENSE、`dist`、`media`、`package.json`を残すため基本構成は妥当。再package時の自己包含防止として`artifacts/**`と`*.vsix`の追加を推奨する。
  - `.github/workflows/ci.yml`: 既存CIは検証コマンドの基準として利用でき、直接変更は必須ではない。Release workflow側でも同等検証を実行し、既存CIと並行して未検証assetを公開しない。
- 実装後の検証方法:
  - `npm ci`
  - `npm run build`
  - `npm run lint`
  - `npm run test:unit`
  - `npm run test:git`
  - `npm run test:github`
  - `xvfb-run -a npm run test:vscode`（Linux CI）
  - `npm run package -- --pre-release --out artifacts/review-range-tracker-0.0.1-pre.vsix`
  - `npx vsce ls --no-dependencies`でREADME、LICENSE、package.json、`dist/extension.js`、`media/reviewed-gutter.svg`が含まれ、source/test/report/task/CIが除外されることを確認する。
  - VSIXをZIPとして展開し、`extension/package.json`のname、publisher、version=`0.0.1-pre`、engine=`^1.125.0`と`extension.vsixmanifest`のversion/pre-release metadataを確認する。
  - `sha256sum artifacts/review-range-tracker-0.0.1-pre.vsix`をRelease notesまたはjob summaryへ記録する。
  - VS Code 1.125.0以上の隔離profileで`code --install-extension artifacts/review-range-tracker-0.0.1-pre.vsix`を実行し、拡張ID・version、4コマンド、装飾、再起動復元をsmoke確認する。
  - workflow YAMLを静的lintし、可能ならforkまたは一時repositoryで「Releaseなし」「正しいRelease/assetあり」「Releaseありassetなし」「同名tagのみ」「metadata不一致」の5経路を検証する。

## 結果

- 結果:
  - RevMemの最新`origin/main`上で、READMEへ記載できる現状機能・設定・保存挙動と、記載してはいけない将来機能をmanifest・composition root・状態repository・unit/Extension Host testから切り分けた。
  - SSCの実workflowとRelease実績を直接確認し、NuGet publish部分を除外しつつ、full-history checkout、version/tag解決、`gh release view`による存在確認、main commitをtargetとしたpre-release作成をRevMemへ転用できると判断した。
  - T108初回main merge時の最初のGitHub Releaseは、固定`0.0.1-pre`、固定asset `review-range-tracker-0.0.1-pre.vsix`を`gh release create`へ同時指定する構成で実現できる。
  - RevMem repositoryには調査時点でtagもReleaseも0件だったため、`0.0.1-pre`との衝突はない。
  - VS Code公式manifest仕様とRevMemが使うvsce v3.9.2の実装上、`package.json`の`0.0.1-pre`は許容される。package versionとRelease versionを分離する必要はない。
  - 実装・workflow実行・Release作成は行っていない。

## リスク

- 未解決のリスクまたは後続対応:
  - `engines.vscode: ^1.125.0`は非常に新しいため、利用者環境が要件を満たさない可能性が高い。READMEの先頭付近へ明記する必要がある。
  - GitHub Release assetはMarketplace配布ではなく、署名も現構成にはない。利用者は手動installと更新を行う必要があり、配布元・checksumを明示することが望ましい。
  - `--pre-release`を付けた実VSIXのVS Code 1.125.0へのinstall smokeは本調査の非編集制約により未実行。実装後のpackage/install検証を必須にする。
  - `markdown-word-checker`に従って確認したが、このrepositoryには`tools/lint/`と`lint:md` scriptがないためfocused/full Markdown用語lintは`unsupported`。代替の`git diff --check`は成功し、backtickはコマンド、識別子、path、実UIラベルに限定しており、通常文のlint回避には使っていない。
  - `.vscodeignore`に`artifacts/**`と`*.vsix`がないため、dirtyなローカル作業treeで再packageすると既存成果物を拾う可能性を排除できない。追加またはclean checkoutの強制が必要。
  - main pushごとにworkflow自体は起動するため、正しいassetが存在する場合は早期skipして費用を抑える。将来versionを上げる際は固定値workflowを置換または一般化する別タスクが必要。
  - Release作成後asset upload前の障害、同名tagの手動作成、immutable release設定、権限不足は自動補修できない場合がある。metadata不一致やtag不一致を上書きせずfailさせる必要がある。
  - Release workflowが既存CIと独立に走ると二重実行になるが、既存CI成功前に公開しないためRelease job自身の検証は省略しない方が安全である。将来は成功したCIの`workflow_run`へ統合する余地がある。
  - 複数root workspaceは現storage routingで衝突する可能性がある。READMEでは単一folder workspaceを案内し、複数root対応済みと表現しない。
  - content変更時は行mappingせず当該ファイル状態を無効化するため、利用者には「編集へ自動追従する」と誤解させない。
  - 親agent所有の`tasks/tasks-status.md`と`tasks/phases-status.md`には本調査開始前から変更があり、本調査では触れていない。
