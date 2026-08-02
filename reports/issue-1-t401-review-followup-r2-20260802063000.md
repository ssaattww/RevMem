# T401 レビュー指摘対応レポート R2

## メタデータ

- リポジトリ: `ssaattww/RevMem`
- Pull Request: #31
- 対象ブランチ: `task/t401-github-pr-context-resolver`
- 対象finding: `T401-R003`（High）
- Source reviewed implementation HEAD: `be0c324721aa3b69c0807992fb679c9b69613c57`
- Review report/handoff反映後の開始HEAD: `9444bff29c92976c5abf2a07aa89a147b66b7c8f`
- TDD Red HEAD: `b39f5ddecea35ee21276b8d77e843c2b3f2e23c0`
- Green implementation HEAD: `b046ab21395543199c227242185448bc170182f0`
- マージ: 未実施

## 対象指摘

`FetchGitHubPullRequestAdapter`がGitHub REST paginationの`Link: rel="next"`に含まれる絶対URLをorigin検証せず採用し、同じAuthorization headerを次のrequestへ渡していた。このため、cross-origin URLまたは同一origin上の無関係なpathへtokenを転送する可能性があった。

## TDD

### Red

`test/integration/mock-github.test.ts`へ、認証token付きの初回応答が`https://attacker.example/steal?page=2`を`rel="next"`として返すcaseを追加した。

期待値:

- 初回API originへのrequestだけが実行される。
- cross-origin URLはfetchされない。
- search結果は安全側に`unavailable/api`となる。

Red HEAD `b39f5ddecea35ee21276b8d77e843c2b3f2e23c0`に一致するCI run `30719175623`で、Mock GitHub integration testが失敗した。failure diagnostics artifact `8824303685`（`ci-failure-diagnostics-30719175623-1`）が保存された。build、typecheck、architecture正負、lint、unit、Git integrationは成功し、新規security regression testで失敗したため、既存実装がcross-origin next URLへ進むことを確認した。

### Green

`src/adapters/github/fetch-github-pull-request-adapter.ts`のpagination URL解析を次の契約へ変更した。

- relative URLは現在page URLをbaseとして解決する。
- API collection URLと同一originであること。
- protocolが初回API URLと同一で、`http:`または`https:`であること。
- userinfoを含まないこと。
- pathnameが元の`/repos/{owner}/{repository}/pulls` collection pathと完全一致すること。
- fragmentを含まないこと。
- 不正なnext linkは候補なしとして黙って終了せず、`unavailable/api`としてbranch fallbackへ移ること。
- visited URL setによるloop防止を維持すること。

Green implementation HEAD `b046ab21395543199c227242185448bc170182f0`に一致するCI run `30719218852`で、build、contract typecheck、architecture正負、lint、unit、Git integration、Mock GitHub integration、VS Code Extension Hostの全configured gateが成功した。

## 変更ファイル

- `test/integration/mock-github.test.ts`
  - cross-origin pagination URLへtokenを転送しないRed/Green regression testを追加。
- `src/adapters/github/fetch-github-pull-request-adapter.ts`
  - pagination linkを同一origin・同一collection path・安全なprotocolへ制限。
- `reports/issue-1-t401-review-followup-r2-20260802063000.md`
  - 本詳細レポート。
- `reports/issue-1-t401-review-followup-r2-handoff-20260802063000.yaml`
  - 元の通常レビュワーへ渡すfix verification handoff。

## 検証

- Red exact-head CI: run `30719175623`, HEAD `b39f5ddecea35ee21276b8d77e843c2b3f2e23c0`, conclusion `failure`
- Red failure artifact: `8824303685`
- Green exact-head CI: run `30719218852`, HEAD `b046ab21395543199c227242185448bc170182f0`, conclusion `success`
- Green gates: build、typecheck、architecture positive/negative、lint、unit、Git integration、Mock GitHub integration、VS Code Extension Hostすべて成功

レポートおよびhandoff commit後はHEADが変わるため、PR current HEAD SHAと一致する新しいCI runのみを最終証跡として確認する。別SHAのrunは代用しない。

## 結果

`T401-R003`をfinding identityとseverityを維持してaddressedした。cross-originおよび同一origin別pathのpagination URLへ認証情報を転送しない契約を実装した。PR #31はdraftのまま更新し、mergeは行っていない。
