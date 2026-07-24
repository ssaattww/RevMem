# Sub-agent実行レポート

## タスク

- 目的: T109実装前にSSCとRevMemのRelease workflowを行単位で比較し、NuGetからVSIXへの必要最小限の置換範囲を確定する
- タスク種別: 調査

## sub-agentを使う理由

- 理由: 参照実装との契約差分確認は固定sub-agent対象であり、sol high調査担当による独立確認で独自仕様の再混入を防ぐため

## 対象範囲

- 対象: SSC `publish-nuget.yml`のtrigger、version解決、main push時pre-release作成、workflow_dispatch、release published経路と、RevMemで必要なVSIX package・Release asset置換

## 対象外

- 対象外: ファイル編集、実装、Release作成・削除、tag変更、commit、push、PR作成、SSCにない独自hardeningの提案

## 実行コマンド

- 実行コマンド:
  - `git fetch origin main --tags`
  - `git status --short --branch`
  - `git rev-parse origin/main`
  - `git log --oneline --decorate 0.0.1-pre..origin/main`
  - `git rev-list --count 0.0.1-pre..origin/main`
  - `git tag --sort=-v:refname`
  - `gh api repos/ssaattww/SSC/contents/.github/workflows/publish-nuget.yml?ref=main`
  - `gh api repos/ssaattww/RevMem/contents/.github/workflows/release-vsix.yml?ref=main`
  - `gh run view 30050718098 --repo ssaattww/RevMem --json databaseId,event,headSha,headBranch,status,conclusion,workflowName,jobs,createdAt,updatedAt`
  - `gh run view 30050718098 --repo ssaattww/RevMem --log`
  - `gh run list --repo ssaattww/RevMem --workflow release-vsix.yml --limit 10`
  - `gh run view 30087724096 --repo ssaattww/RevMem --json databaseId,event,headSha,conclusion,workflowName,jobs`
  - `gh run view 30087724096 --repo ssaattww/RevMem --log`
  - `gh run view 30088748936 --repo ssaattww/RevMem --json databaseId,event,headSha,conclusion,workflowName,jobs`
  - `gh run view 30088748936 --repo ssaattww/RevMem --log`
  - `gh release view 0.0.1-pre --repo ssaattww/RevMem --json tagName,name,isPrerelease,targetCommitish,assets,publishedAt,url`
  - `git rev-list -n 1 0.0.1-pre`
  - PowerShellでstable tag、pre-release tag、現在mainと修正PR merge後のversionをSSC式に算出
  - `Test-Path tools/lint`
  - `package.json`の`lint:md` script有無確認
  - `git diff --check -- reports/issue-1-t109-investigation-20260724201518.md`
  - `rg -n <見出し・placeholder検索> reports/issue-1-t109-investigation-20260724201518.md`

## 対象ファイル

- 変更したファイル:
  - `reports/issue-1-t109-investigation-20260724201518.md`のみ
- GitHub上で直接確認したファイル:
  - SSC main `.github/workflows/publish-nuget.yml`
    - URL: `https://github.com/ssaattww/SSC/blob/main/.github/workflows/publish-nuget.yml`
    - blob SHA: `777ef81b2a1a672894d9bb16133024341a5c4ea6`
  - RevMem main `.github/workflows/release-vsix.yml`
    - URL: `https://github.com/ssaattww/RevMem/blob/main/.github/workflows/release-vsix.yml`
    - blob SHA: `5595525bff9d96397bad28681f2b3e23d4692d19`
- 補助確認:
  - RevMem `package.json`
  - RevMem tag `0.0.1-pre`
  - RevMem Release `0.0.1-pre`
  - RevMem workflow runs `30050718098`、`30087724096`、`30088748936`
  - RevMem `origin/main`の`0.0.1-pre`以後のcommit列

## 指摘事項

- 事実確認:
  - 調査時のRevMem `origin/main`は`fa0ab9823274d634d492fc09e3260d748075bb3e`。
  - tag `0.0.1-pre`はT108 merge commit `d2ec00e02cd706ff8bffcad9238885386ed1f2d1`を指す。
  - Release `0.0.1-pre`はpre-releaseで、同じcommitをtargetとし、asset `review-range-tracker-0.0.1-pre.vsix`を1件保持する。
  - T108 mergeのrun `30050718098`は成功し、40 files、45.46 KBのVSIXをpackage後、`gh release create`がRelease URLを返した。
  - T201 main push run `30087724096`とT202 main push run `30088748936`はいずれも成功したが、固定`0.0.1-pre`を検査して`Release already has the expected asset; skipping.`で終了した。新しいcommit用VSIXは配布されていない。
  - `0.0.1-pre..origin/main`は次の2commit:
    - `2c8f79bd2c31ae06b47ead450147bfc62c75ca30` T201 Range Mapping Engine
    - `fa0ab9823274d634d492fc09e3260d748075bb3e` T202 Local Git Adapter
- 1. SSCからそのままコピーする部分:
  - triggerを次のまま採用する。
    - `release: types: [published]`
    - `push: branches: [main]`
    - optionalな`package_version`入力を持つ`workflow_dispatch`
  - jobは`ubuntu-latest`、権限は`contents: write`と`pull-requests: read`を採用する。
  - SSC mainには`concurrency`定義がない。したがって参照実装忠実性を優先する場合、RevMemの固定`concurrency.group: release-0.0.1-pre`はコピー対象ではなく削除対象であり、新しい独自concurrencyも追加しない。
  - `actions/checkout@v5`と`fetch-depth: 0`をそのまま採用する。
  - version解決stepの優先順位をそのまま採用する。
    - manual inputがあればその値。
    - `release` eventならrelease tag先頭の`v`を除く。pre-release Releaseでtagにsuffixがなければ`-pre`を付け、stable Releaseのtagにsuffixがあれば失敗する。
    - main pushなら最新stable tagを探し、そのtag以後のcommit数をbase patchへ加えて`major.minor.(patch+count)-pre`とする。
    - 上記以外、すなわちversion未指定のmanual runはmanifestのversion prefixをseedとして`<prefix>-ci.${GITHUB_RUN_NUMBER}`とする。
  - 空version拒否、base versionの`x.y.z`形式検証、commit数が0なら1へ補正する処理をそのまま採用する。
  - main pushだけ`gh --version`を確認する。
  - main pushだけ、算出versionをtagとして`gh release view`で既存Releaseを確認し、存在すればメッセージを出して終了する。
  - main pushのnotes生成をそのまま採用する。
    - `Automated pre-release from main push.`
    - current SHAに関連するPR番号をcommits APIから取得し、存在すれば箇条書き、なければ`Related pull request: not found.`。
  - main pushの`gh release create`は`--target "$sha"`、`--title "$tag"`、`--notes-file "$notes_file"`、`--prerelease`をそのまま採用する。
- 2. NuGetからVSIXへ機械的に置換する部分:
  - `actions/setup-dotnet@v5`、`.NET 8`を`actions/setup-node@v5`、Node 24、npm cacheへ置換する。
  - NuGet project列挙と`VersionPrefix` seed取得を、root `package.json`の存在確認と`version`からpre-release/build suffixを除いた`x.y.z` seed取得へ置換する。
  - projectごとの`dotnet restore`を`npm ci`へ置換する。
  - projectごとのRelease buildを`npm run build`へ置換する。
  - VSIX品質gateとして、現行CIと同じ`npm run lint`、unit、temporary Git integration、mock GitHub integration、`xvfb-run -a npm run test:vscode`をpackage前に実行する。
  - `dotnet pack -p:PackageVersion=<resolved>`を、resolved versionをVSIX内manifestへ反映する`vsce package`へ置換する。
    - 例: `npm run package -- "$package_version" --no-git-tag-version --no-update-package-json --out "$asset_path"`。
    - resolved versionがpre-release suffixを持つ場合だけ`--pre-release`も付ける。
    - asset名は固定せず、`review-range-tracker-${package_version}.vsix`とする。
  - `NUGET_API_KEY`検証は不要になり、GitHub組み込みtokenを`GH_TOKEN: ${{ github.token }}`として使う。
  - `dotnet nuget push ... --skip-duplicate`をGitHub Release asset配置へ置換する。duplicate時に失敗しない性質は、対象Releaseに同名assetがあればuploadをskipすることで機械的に引き継ぐ。
  - main pushでは、SSCの`gh release create`へ`"$asset_path"`をasset引数として追加し、算出tagの新規pre-releaseへVSIXを置く。Releaseが既に存在する場合はSSCと同様に作成をskipし、同名assetがあることだけを前段のduplicate処理で確認する。
  - `release: published`では、`github.event.release.tag_name`が指す、今まさに公開されたReleaseへVSIXをuploadする。package versionはSSCどおりtagから解決し、tagに先頭`v`があってもupload先は元のrelease tagを使う。
  - `workflow_dispatch`では、resolved `package_version`と同名tagの既存ReleaseへVSIXをuploadする。これはGitHub Release assetをNuGet registryの代替配布先にするための最小対応であり、対象Releaseがなければ失敗させる。manual run自体で独自Releaseを自動作成する処理は加えない。
  - main pushで作成したpre-releaseにより後続の`release: published` runが発生する。そのrunは同名assetを検出してuploadをskipし、SSCのNuGet `--skip-duplicate`と同じ再入時挙動にする。
- 3. 初回`0.0.1-pre`を起点にする不可避な最小差分:
  - SSCは最新stable tagだけを検索するが、RevMemにはstable `x.y.z` tagがなく、既存の配布起点は`0.0.1-pre`だけである。
  - main pushのversion解決で、最新stable tagが見つからない場合に限り、最新`^(v)?[0-9]+\.[0-9]+\.[0-9]+-pre$` tagを検索する。
  - pre-release tagが見つかった場合は、先頭`v`と末尾`-pre`を除いた`0.0.1`を`base_version`とし、`git rev-list --count "${latest_prerelease_tag}..HEAD"`で未配布commit数を数える。
  - stable tagが存在する場合は必ずSSC本来のstable tag経路を優先する。stableもpre-releaseもない場合だけ、SSCどおりmanifest seedと`git rev-list --count HEAD`へfallbackする。
  - 差分はこの「stable tagなし時のpre-release tag fallback」だけに限定する。固定version、固定asset名、最新remote main再検証、Release metadata完全一致検証、repair worktree、固定tagからの再buildなど現行RevMem独自hardeningは採用しない。
- version計算:
  - 現在mainではbase `0.0.1`、`0.0.1-pre..origin/main`が2commitなので、SSC式の現在算出値は`0.0.(1+2)-pre`=`0.0.3-pre`。
  - T109修正PRが通常どおり1つのmerge/squash commitとしてmainへ入ると、起点以後はT201、T202、T109の3commitになる。
  - したがって修正PR mergeをtriggerとする最初の期待Release versionは`0.0.(1+3)-pre`=`0.0.4-pre`。
  - 実際のmergeで複数commitが追加される場合は`git rev-list --count`がその実数を使うため、期待versionも増える。

## 結果

- 結果:
  - SSC workflowをstep単位で直接確認し、RevMemへ移植する契約を「そのままコピー」「NuGetからVSIXへの機械置換」「既存`0.0.1-pre`起点の不可避な1差分」の3分類に確定した。
  - 現行RevMem workflowはtrigger、version、asset、release処理を固定しており、T201/T202 pushで新規配布されなかったことをrunログで確認した。
  - T109実装後は、main pushごとにSSC式でversionを進める。T109が1commitでmergeされる前提の次versionは`0.0.4-pre`。
  - `release: published`はそのRelease、manualはresolved versionと同名の既存Release、main pushは新規算出tagのpre-releaseへ、それぞれ動的version名のVSIX assetを配置する。
  - report以外のファイル編集、workflow実装、Release/tag変更、commit、push、PR作成は行っていない。

## リスク

- 未解決のリスクまたは後続対応:
  - T109 merge前に別commitがmainへ入る、またはT109が複数commitでmergeされると、期待値`0.0.4-pre`はcommit数分だけ増える。workflowは固定期待値ではなく実際の`git rev-list --count`を正とする。
  - version未指定のmanual runはSSCどおり`<prefix>-ci.<run number>`を生成するが、同名の既存GitHub Releaseが通常はないためasset upload先がなく失敗する。参照triggerを変えず独自Release作成も加えない契約上、manual利用者は既存Releaseと一致する`package_version`を指定する必要がある。
  - `release: published`は公開後にassetを追加する。repositoryでimmutable releasesが有効な場合はuploadできない可能性があるが、SSCにないdraft/repair hardeningはT109へ追加せず、運用制約として保持する。
  - main pushの`gh release create`成功が`release: published`を再度triggerするため、同名assetのduplicate skipを実装しないと2回目が失敗する。これは独自hardeningではなくNuGet `--skip-duplicate`の機械的置換として必要。
  - `pull-requests: read`はSSCのnotes生成に合わせて残す。GitHub tokenのrepository設定で権限が制限される場合、PR番号取得はSSC同様`|| true`によりnotesだけ`not found`へfallbackする。
  - SSC mainにはconcurrencyがないため、固定concurrencyを残すと忠実移植にならない。同時main push時の競合はSSCと同じ既存Release確認へ委ねる。
  - 実際の`vsce package <version> --no-update-package-json`、3 event経路、duplicate skipはT109実装後にworkflowまたは同等shell testで検証する必要がある。
  - `markdown-word-checker`に従って確認したが、このrepositoryには`tools/lint/`と`lint:md` scriptがないためfocused/full Markdown用語lintは`unsupported`。代替の`git diff --check`は成功し、backtickはコマンド、識別子、path、実際のログ文言に限定しており、通常文のlint回避には使用していない。
  - 親agent所有の`tasks/tasks-status.md`と`tasks/phases-status.md`には調査開始前から変更があり、本調査では編集していない。
