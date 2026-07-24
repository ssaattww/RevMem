# Sub-agent実行レポート

## タスク

- 目的: SSC Release workflowを忠実に移植し、NuGet配布だけを動的versionのVSIX Release assetへ置換する
- タスク種別: 実装

## sub-agentを使う理由

- 理由: workflow、契約test、READMEをまたぐreview follow-upであり、ユーザー指定のterra high実装担当へ委譲するため

## 対象範囲

- 対象: SSC互換trigger・version解決・main push Release作成、VSIX package/upload置換、既存`0.0.1-pre` fallback、Release契約test、READMEの動的version案内

## 対象外

- 対象外: 製品機能、設計書、BreakingChanges、tasks・phases、既存reports、実Release/tag変更、SSCにない独自hardening、commit、push、PR作成

## 実行コマンド

- 実行コマンド:
  - `Get-Content -Raw <implementation-executor・tdd-executor・T109調査/実装report>`
  - `gh api -H 'Accept: application/vnd.github.raw+json' repos/ssaattww/SSC/contents/.github/workflows/publish-nuget.yml?ref=main`
  - `npm run compile:test && node --test test-dist/test/unit/release-vsix-contract.test.js`（Red）
  - `npm run compile:test && node --test test-dist/test/unit/release-vsix-contract.test.js`（Green）
  - `npm run package -- 0.0.3-pre --no-git-tag-version --no-update-package-json --pre-release --out artifacts/review-range-tracker-0.0.3-pre.vsix`
  - PowerShellの`System.IO.Compression.ZipFile`によるVSIX manifest/package version・pre-release metadata確認
  - `npm run lint`
  - `npm test`
  - PowerShellでworkflow shell blockを抽出し、`C:\Program Files\Git\bin\bash.exe -n -c <script>`
  - `git diff --check`

## 対象ファイル

- 変更または確認したファイル:
  - 変更: `.github/workflows/release-vsix.yml`
  - 変更: `test/unit/release-vsix-contract.test.ts`
  - 変更: `README.md`
  - 変更: 本レポート（既存プレースホルダーの記入のみ）
  - 確認: SSC main `.github/workflows/publish-nuget.yml`、T109調査report、既存package/test設定

## 指摘事項

- 指摘要約または「指摘なし」:
  - SSCからtrigger（`release: published`、`push: main`、optional `package_version` manual）、job権限、full-history checkout、event別version解決、main pushのnotes/関連PR取得/`gh release create`の順序とshellを移植した。
  - .NET project/restore/build/pack/NuGet publishをNode 24/npm/VSIX package/GitHub Release assetへ機械置換した。VSIX品質gateとして既存CI相当のbuild、lint、unit、Git/GitHub integration、Extension Host testをpackage前に置いた。
  - stable tagがないRevMemだけの最小差分として、最新`x.y.z-pre` tagをbaseにするfallbackを追加した。stable tagがあればSSCどおりstable tagを優先する。
  - 固定version/tag/asset/env/concurrency、remote main guard、metadata完全一致検証、repair worktreeを削除した。manual/releaseは既存Releaseへのasset uploadのみで、新規Releaseを作成しない。
  - 同名assetが対象Releaseにあればuploadをskipする。これはNuGet `--skip-duplicate`のGitHub Release assetへの機械置換である。

## 結果

- 結果:
  - RedではSSC trigger、動的resolver、既存Release upload、fixture resolver、READMEの動的asset案内を期待する契約test 5件が失敗した。現行固定workflowの欠落を検出できた。
  - Greenでは契約test 7件がすべて成功した。workflowから抽出したresolverを一時Git fixtureで実行し、`0.0.1-pre`起点の2commit後=`0.0.3-pre`、T109の1commit追加後=`0.0.4-pre`を確認した。
  - dynamic packageではsource `package.json`のversionを`0.0.1-pre`のまま保ち、`review-range-tracker-0.0.3-pre.vsix`内部のpackage version/identityを`0.0.3-pre`、pre-release metadataを`true`にできた。
  - `npm run lint`、`npm test`（unit 122件、Git integration 17件、GitHub integration 1件、Extension Host）、workflow shell構文、`git diff --check`が成功した。
  - GitHub Release/tagの実作成・アップロード・変更は実行していない。

## リスク

- 未解決のリスクまたは後続対応:
  - 実際のmain merge時はcommit数が正となるため、別commitが先にmergeされれば期待`0.0.4-pre`より大きいversionになる。
  - version未指定のmanual runはSSC互換の`<prefix>-ci.<run number>`を解決するが、同名既存Releaseがなければ意図どおり失敗する。manualでassetを添付する場合は既存Releaseと同じ`package_version`を指定する必要がある。
  - release published経路で公開済みReleaseへのasset uploadを行うため、immutable releases、権限不足、GitHub API障害時の実挙動はGitHub上で未検証である。独自のdraft/repair hardeningは追加していない。
