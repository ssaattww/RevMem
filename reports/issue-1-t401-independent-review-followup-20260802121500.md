# T401 独立review指摘対応報告

## メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request / Task: #31 / T401
- Mode: independent review follow-up
- 対象branch: `task/t401-github-pr-context-resolver`
- broad review対象HEAD: `93befcf2645a7b011ab932230a77d65b94a3d800`
- follow-up開始時HEAD: `0a371f10118d0ce42a3d2d72206bb101061a5190`（latest `origin/main`をmerge済み）
- 対象finding: `T401-IFR2-P1`〜`T401-IFR2-P7`
- commit / push / merge: この実装ターンでは未実施

## 設計判断

T401の既存設計は未認証public API fallback、token非永続化、障害時のlocal/branch継続、および公開barrel consumer fixtureを要求済みである。今回の変更はその安全な実装を補完するものであり、既存consumerへの破壊的変更はない。従って設計書と`Design/BreakingChanges.md`は変更しない。

## 一括対応とclosure evidence

### T401-IFR2-P1 — High — Enterprise token authority binding

- `VsCodeGitHubAuthenticationProvider`にoptionalなconfigured Enterprise URIを追加し、`canonicalGitHubAuthority`でauthorityを正規化してから比較する。
- `github.com`以外はconfigured authorityと完全一致した場合だけ`github-enterprise` sessionを読む。不明・不一致・不正authorityではsessionを読まず`undefined`を返す。
- `getSession`のprovider errorも`undefined`にして、認証なしpublic API fallbackを継続する。
- regressionはattacker authorityに対してEnterprise tokenを一度もfetchへ渡さず、Authorization headerが`null`となること、およびprovider error fallbackを固定する。

### T401-IFR2-P2 — Medium — malformed API element

- PR responseの各配列要素をproperty access前にnon-null objectとして検証する。
- 必須field欠落・型不正の要素は候補を黙って無視せず、response全体を`{ kind: "unavailable", reason: "api" }`へ分類する。
- `null` array elementの回帰をP6のbranch fallback matrixに含めた。

### T401-IFR2-P3 — Medium — public barrel consumer fixture

- `type-fixtures/contracts/t401-github-pr-context.fixture.ts`を追加し、application GitHub PR context barrelとGitHub adapter barrelを外部consumer pathから使用する。
- repository authority、candidate、resolver、fetch adapter、authentication provider、remote parserを型検証し、必須authorityのnegative contractも`@ts-expect-error`で固定した。
- contracts tsconfigへfixtureを追加した。

### T401-IFR2-P4 — Medium — tracking同期

- `tasks/tasks-status.md`のT401を「独立review指摘対応済み（closure review待ち）」へ同期し、PR #31、7 finding、closure reviewと修正HEAD CIを完了条件として記録した。
- `tasks/phases-status.md` P4へ、実装・通常review済み、今回の7 finding対応済み、closure review/CI待ちという実状態を記録した。

### T401-IFR2-P5 — Medium — cyclic pagination

- 既訪問URLを次のrequestとして処理する前に`unavailable/api`を返す。self-loopと2-page cycleのいずれもpartial candidate resultを返さない。
- 正常なfull paginationおよび既存のcross-origin/path検証は維持した。

### T401-IFR2-P6 — Medium — unavailable to branch acceptance matrix

- mock GitHub integrationでnetwork reject、一般HTTP error、不正JSON、non-array shape、malformed element、self-loop、multi-page cycleを対象にした。
- 各adapter結果を`GitHubPullRequestContextResolver.resolveSearchResult()`へ渡し、すべて`{ kind: "branch", reason: "unavailable" }`になることを受入testとして固定した。

### T401-IFR2-P7 — Medium — T202 canonical remote identity

- GitHub remote parserはT202の`normalizeGitRemoteUrl()`を直接再利用し、GitHub.comのowner/repository lowercase、default port除去、Enterprise non-default port保持を単一policyにした。
- Enterprise HTTPS/SSH、GitHub.com case variant、default/nondefault portについて、T401 integrationとT202 focused suiteで相互運用性を確認した。
- API base URLとauth authorityは同じcanonical authorityを使用する。

## TDD と環境診断

- 先行してintegration regressionとconsumer fixtureを追加した。最初の`npm run test:github` / `npm run typecheck:contracts`は、新設constructor optionが未実装のためTypeScript `TS2554`で失敗した（Red）。
- 初回実行時はworktreeに依存packageがなく`tsc`を起動できなかった。`npm ci`でlockfileどおりに復元後、上記Redを観測した。package manifest/lockfileは変更していない。
- 実装後のfocused regressionはGreenで、13 tests passed。

## 検証

- `npm run compile`: success
- `npm run lint`: success
- `npm run typecheck:contracts`: success（T401 consumer fixtureを含む）
- `npm run validate:architecture`: success
- `npm run validate:architecture:negative`: expected 10 violations matched
- `npm run test:github`: success、13 passed
- `npm run test:t202`: success、17 passed
- `git diff --check origin/main...HEAD`: success
- `git diff --check`: success

CIはcommit/push後のfinal HEADに一致するrunだけを次段で利用する。このworktreeでcommit/pushをしていないため、matching final-HEAD CIはまだない。

## 意図的に変更しない範囲

- source broad independent review report `issue-1-t401-independent-final-review-20260802090030.md` は変更していない。
- T402以降のPR files/diff/cache/persistence/UI、extension runtime compositionはT401 follow-upの範囲外。
- `.github/workflows/ci.yml`は必要なfailure diagnosticsを既に保存するため変更しない。
- Issue #28のWindows POSIX fixtureは本筋外のheld itemとして変更しない。

## 次のアクション

このfollow-upを含む変更をcommit/pushし、exact-head CI成功後、同じ独立reviewerが`T401-IFR2-P1`〜`P7`だけをclosure確認する。広域レビューや新規finding追加は行わない。
