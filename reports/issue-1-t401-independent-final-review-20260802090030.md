# T401 独立最終レビュー（reviewer 2/2）

## Metadata / target identity

- Repository: `ssaattww/RevMem`
- PR / task: `#31` / `T401`
- Review mode: `independent final review`
- Reviewer identity: reviewer 2/2。T401の実装、review fix、通常reviewを担当しておらず、nested agentも使用していない。
- Branch: `task/t401-github-pr-context-resolver`
- Base ref: `origin/main`
- Fixed base SHA: `05a5350575c6a7c1e7b6b2534b78d2c273317044`
- Reviewed implementation HEAD: `93befcf2645a7b011ab932230a77d65b94a3d800`
- Requested range: `05a5350575c6a7c1e7b6b2534b78d2c273317044..93befcf2645a7b011ab932230a77d65b94a3d800`
- PR merge base / branch parent: `ec1ce78ab35867397c33d711095424e3eedd6e2c`
- Reserved report path: `reports/issue-1-t401-independent-final-review-20260802090030.md`
- Persistence intent: `report_attestation_commit` only after a passing verdict。今回はfailのためattestation commit不可。

レビュー中、local `HEAD`、`origin/task/t401-github-pr-context-resolver`、PR `headRefOid`はいずれも reviewed implementation HEAD と一致した。GitHub上の現在の`main`とlocal `origin/main`も fixed base SHA と一致した。PRはdraft、mergeable=`MERGEABLE`、merge state=`CLEAN`である。PR GraphQLの`baseRefOid`はbranch作成時点の`ec1ce78...`を示すため、fixed baseとの差分では後発T207の逆差分が見えるが、`git merge-tree --write-tree <fixed-base> <reviewed-head>`は競合なく成功した。統合treeではT207変更を保持したままT401の19 pathが加わることを確認し、T207を削除する変更とは判定していない。

## Purpose, scope, and authoritative sources

`tasks/tasks-status.md`のT401、`tasks/phases-status.md` P4、`doc/design/vscode-review-range-tracker-design.md`のReview Context Resolver・GitHub連携・障害時fallback・security要件、PR body/comments/reviews、通常reviewとfollow-up/handoff、fixed baseからreviewed HEADまでの全差分、全変更fileと直接依存、exact-HEAD CIを独立評価した。

対象はremoteからのGitHub/GitHub Enterprise identity解決、既存VS Code認証session、認証済みまたはpublic未認証API、exact HEAD open-PR検索、pagination、0/1/複数候補、branch fallback、公開barrel、report/trackingである。T402以降のPR files/diff/cache/persistence/UI実装、Issue #28の修正、merge/releaseは対象外である。

## Inspected changes and dependencies

- T401 product code全7 file: `src/application/github-pr-context/{contracts,github-pull-request-context-resolver,index}.ts`、`src/adapters/github/{fetch-github-pull-request-adapter,git-remote,vscode-github-authentication-provider,index}.ts`。
- Test/support: `test/integration/mock-github.test.ts`、`test/support/mock-github-server.ts`、`test/support/temporary-directory.ts`。
- Public/consumer boundary: `src/adapters/index.ts`、既存application/adapters directory barrels、`type-fixtures/contracts/*`、`typecheck:contracts` script。
- Runtime/direct dependencies: `src/extension.ts`、既存review-context contract、Git remote/API URL/authentication/fetch/chooserの受渡し境界。
- Repository evidence: T401 implementation report/handoff、通常review R1/R2/R3、2件のreview-follow-up report/handoff（計11 changed report/handoff path）、PR body/comments/reviews、task/phase tracking、design、CI workflow。
- Fixed-base two-dot diffは37 path。分岐後のT207 18 path（`package.json`、T207 report 8件、document session provider、revision mapper、Git transition 2件、validated transition、task tracking、T207 integration test、CI contract test、Git transition test 2件）はcurrent base側にだけ存在する。merge-treeが全18 pathを保持することを確認し、T401実効差分は上記report/handoff 11、product 7、test 1の計19 path。全pathを差分または現内容で確認した。

## Normal-review finding continuity

- `T401-R001` — High — **addressed**。`Link: rel="next"`を追跡し、2 page目のexact HEAD候補を取得する回帰testがある。
- `T401-R002` — High — **addressed as originally stated**。`github.com`と非`github.com`でprovider IDを分け、`createIfNone: false`を維持する。ただし、その修正がEnterprise tokenと実remote hostを結合していない別のsecurity defectを残したため、新規`T401-IFR2-P1`を起票する。
- `T401-R003` — High — **addressed**。pagination next URLは同一origin・同一protocol・同一collection pathに限定され、userinfo/fragment/cross-originを2回目のauthenticated fetch前に拒否する。
- severity reclassification / erratum: なし。R001/R002/R003はいずれもsource severity Highを維持する。

## Required findings

### T401-IFR2-P1 — High — Enterprise tokenがremote hostへ結合されず任意hostへ送信され得る

- Origin: independently discovered in final review
- Location: `src/adapters/github/vscode-github-authentication-provider.ts:12-35`、`src/adapters/github/git-remote.ts:22-60`、`src/adapters/github/fetch-github-pull-request-adapter.ts:103-126`
- Description: remote parserは任意hostをGitHub Enterprise identityとして受理し、`getAccessToken(host)`は`github.com`以外をすべて同一のVS Code provider `github-enterprise`へ写像する。返されたsessionにはremote hostとの一致証拠がなく、API baseはremote由来hostから別途生成される。この契約を意図どおり組み合わせると、設定済みEnterprise sessionのtokenを、workspaceのremoteに書かれた任意のHTTPS hostへBearer tokenとして送信できる。
- Impact: untrusted repository設定や誤設定remoteにより、既定scope `repo`のprivate Enterprise tokenが別hostへ漏えいし得る。R003のpagination origin検証は初回request先を信頼済みと仮定するため、この漏えいを防がない。
- Evidence: `authenticationProviderId()`はhostを`github.com`か「その他」かだけで判定する。`parseGitHubRemote("git@attacker.example:owner/repo.git")`は`attacker.example`を有効identityとして返せる。`gitHubApiBaseUrl()`はそのhostを`https://attacker.example/api/v3`へ変換し、fetch adapterは受け取ったtokenを初回requestのAuthorization headerへ無条件設定する。既存testも任意の`git.example.test`に対しEnterprise tokenを返すことを正として固定しており、configured Enterprise URIとの照合testはない。
- Required action: VS Codeで設定されたEnterprise URI/authorityとremote identityをcanonicalに照合し、一致したhostにだけそのsession tokenを返す。未一致・設定不明・認証provider errorではtokenを送信せず、public API試行またはbranch fallbackへ安全に遷移する。attacker host不一致時にEnterprise tokenを一度もfetchへ渡さないRed/Green testを追加する。

### T401-IFR2-P2 — Medium — malformed PR配列要素がbranch fallbackでなく例外になる

- Origin: independently discovered in final review
- Location: `src/adapters/github/fetch-github-pull-request-adapter.ts:28-42,146-158`
- Description: top-level payloadが配列かは検証するが、各要素をobject/null guardなしで`GitHubPullRequestResponse`へcastし、`toCandidate()`で即座に`value.number`等を読む。要素が`null`または`undefined`ならTypeErrorがrejectし、`unavailable/api`へ分類されない。
- Impact: malformed、proxy変換、将来のAPI異常応答でPR解決promiseが例外終了し、T401の「API失敗時にbranchへfallbackしてlocal操作を止めない」契約を破る。
- Evidence: TypeScript castはruntime validationではない。`payload.map(value => toCandidate(value as GitHubPullRequestResponse, headSha))`に対し、`toCandidate(null, ...)`は最初のproperty accessでthrowする。catchは`response.json()`だけを囲み、その後のmappingを囲まない。malformed elementのtestはない。
- Required action: 各要素がnon-null objectであることをproperty access前に検証し、malformed response全体を`unavailable/api`へ分類する方針をtestで固定する。

### T401-IFR2-P3 — Medium — 新規public barrelがconsumer contract gateに含まれない

- Origin: independently discovered in final review
- Location: `src/application/github-pr-context/index.ts:1-2`、`src/adapters/github/index.ts:1-3`、`type-fixtures/contracts/tsconfig.json:9-12`
- Description: designは「公開barrelはconsumer type fixtureで固定」と要求するが、新規GitHub application/adapter barrelを外部consumerとしてimportするfixtureがなく、`typecheck:contracts`のincludeも既存2 fixtureだけである。
- Impact: export欠落、constructor/options、readonly union、VS Code auth surface等の公開契約が内部compileと実装testだけに依存し、consumer-facing変更をcontract gateが検出できない。
- Evidence: T401 testはrepository内部から直接両directory barrelをimportするが、`type-fixtures/contracts`にはGitHub関連importが0件。exact-HEAD CIのContract typecheck成功はT401 public APIをcompileしていない。
- Required action: 両barrelをconsumer pathから使用するT401 contract fixtureを追加し、`type-fixtures/contracts/tsconfig.json`へ含める。正負の重要契約を固定する。

### T401-IFR2-P4 — Medium — pre-freeze時点でT401 trackingが未同期

- Origin: independently discovered lifecycle/documentation defect
- Location: `tasks/tasks-status.md:238`、`tasks/phases-status.md:116-129`、T401 reports/handoffs
- Description: reviewed HEADでT401は依然`未着手`である。implementation/follow-up/normal-review reportは「専用Skillのみ」を理由に更新しなかったが、独立最終review前のpre-freeze gateは専用progress Skillを呼んでactual resultへ同期することを要求する。担当者境界は未同期のままfreezeする理由にならない。
- Impact: repositoryのauthoritative trackingが実装・通常review・CIの実状態と矛盾し、T402以降の依存判断と再開判断を誤らせる。pre-freeze条件を満たさないためattestationへ進めない。
- Evidence: T401行は`未着手`のまま。PRには実装commit、通常review pass、exact-head CI successが存在する。通常review R3もtracking未変更を明記している。
- Required action: `progress-sync-manager`等の専用SkillでT401/P4の実状態を同期し、その変更を含むHEADを通常review/fix verificationとmatching CIへ戻した後、新しいimmutable HEADでfresh independent final reviewを行う。

### T401-IFR2-P5 — Medium — cyclic paginationを完全取得と誤認してpartial resultを返す

- Origin: independently discovered in final review
- Location: `src/adapters/github/fetch-github-pull-request-adapter.ts:128-171`
- Description: pagination loopは`while (!visited.has(url.toString()))`で既訪問URLを検出すると、API failureを返さずloopを正常終了し、収集済み候補を`found`として返す。`Link: <current-url>; rel="next"`または複数URLのcycleは「次pageがある」というresponseと矛盾するが、未取得pageなしとして扱われる。
- Impact: cycle前にexact HEAD候補がなければ誤った`not-found` branch fallbackになり、候補が一部だけなら本来の複数候補選択を省略して誤ったPRを自動選択し得る。R001の全page検索契約をmalformed pagination時にsilentに破る。
- Evidence: source直接実行probeで初回URL自身を`rel="next"`に返すとfetchは1回で終了し、結果は`{ kind: "found", candidates: [] }`となった。invalid cross-origin/pathは`unavailable/api`とする一方、cycleだけがpartial successになる。cycle regression testはない。
- Required action: next URLがvisited済みなら`unavailable/api`として安全にfallbackし、self-loopとmulti-URL cycleの回帰testを追加する。正常paginationとR003のorigin/path制約を維持する。

### T401-IFR2-P6 — Medium — network/API failureからbranch fallbackまでの受入testが欠落

- Origin: independently discovered test/validation defect
- Location: `test/integration/mock-github.test.ts:216-237,265-294`
- Description: test名は「rate-limit and API failures」とするがfixtureはHTTP 429だけで、network reject、一般HTTP error、invalid JSON/non-array、`resolveSearchResult({kind:"unavailable"})`を検証していない。したがってtask終了条件のrate-limit・network・API failure時branch fallbackのうち、rate-limit分類以外がacceptance evidenceを持たない。
- Impact: adapterのfailure classificationやapplication fallback wiringが退行してもexact-head CIが成功し得る。実際にP2のmalformed API elementはこのgapを通過している。
- Evidence: T401 test全体を確認するとfetch reject/500/invalid JSON/non-array fixtureがなく、resolver testは`resolve()`だけを呼び`resolveSearchResult()`を一度も呼ばない。CIのMock GitHub gateはこのfileだけを実行する。
- Required action: network reject、非rate-limit HTTP/API error、invalid JSON/shapeを`unavailable`へ分類し、それぞれをresolverが`{kind:"branch", reason:"unavailable"}`へ変換するtestを追加する。P2のmalformed elementも同じfailure matrixへ含める。

### T401-IFR2-P7 — Medium — T202 remote identityとのcanonicalization不整合でEnterprise portを失う

- Origin: independently discovered direct-dependency defect
- Location: `src/adapters/github/git-remote.ts:3-19,31-42,55-60`、直接依存`src/adapters/local-git/git-remote-normalization.ts:22-43,59-63`
- Description: T401 parserはURLの`hostname`だけをidentityへ保存して非default portを破棄し、GitHub.comのowner/repository caseを保持する。一方、依存T202のcanonical remote contractは非default portを保持し、GitHub.com pathをlowercase化する。同じraw remoteが2つの異なるrepository identityへなる。
- Impact: `https://git.example.test:8443/Team/Repo.git`はT401で`https://git.example.test/api/v3`へ誤接続し、custom-port GitHub Enterpriseを検索できない。GitHub.comではremoteのcase差だけで将来の`host + owner + repository + PR number` context identityが分裂し、T202 repository ownershipとT404 PR state routingが不整合になり得る。
- Evidence: source直接実行probeで上記Enterprise remoteはT401=`git.example.test` / API=`https://git.example.test/api/v3`、T202=`git.example.test:8443/Team/Repo`となった。`https://GitHub.com/Owner/Repo.git`はT401が`github.com/Owner/Repo`相当を保持する一方、T202は`github.com/owner/repo`となった。T401 testにport/case interoperabilityはない。
- Required action: T202のcanonical parser/authority policyを共有または再利用し、API authorityとrepository identityの単一contractを作る。GitHub.com case variant、default/nondefault port、Enterprise HTTPS/SSH URLをcross-module contract testで固定する。P1のconfigured Enterprise authority照合にも同じcanonical authorityを使用する。

## Coverage dispositions

| Criterion | Disposition | Evidence |
|---|---|---|
| Requirement / design conformance | `checked_finding` | P1〜P7 |
| Correctness / edge cases | `checked_finding` | malformed array elementとcyclic pagination |
| Scope discipline / unrelated changes | `checked_no_finding` | merge-treeはclean、T207を保持、T402+ product scopeなし |
| All changed files / direct dependencies | `checked_finding` | 19 T401実効pathとbase divergence、runtime/public/T202 remote contract依存を確認。P7あり |
| API / data / compatibility | `checked_finding` | P2、P3、P7 |
| GitHub authentication / host binding | `checked_finding` | P1 |
| Pagination | `checked_finding` | R001/R003 closureは維持するがP5あり |
| Error handling / diagnostics | `checked_finding` | P2、P5、P6。CI failure artifact構成とR003 Red artifactは確認済み |
| Security / secret handling | `checked_finding` | P1。token永続化・log出力は変更範囲で確認されない |
| Tests / validation adequacy | `checked_finding` | P1/P2/P3/P5/P6/P7の回帰・consumer fixtureが欠落 |
| Current-HEAD CI | `checked_no_finding` | exact HEAD run `30720372243`と`30720370638`は全configured gate success |
| Workflow / failure diagnostics | `checked_no_finding` | `ci.yml`は各gate logとfailure時のsource/test/generated/config artifactを保持 |
| PR metadata / comments / reviews | `checked_no_finding` | draft/open、head/base、mergeability、body、3 review、3 issue comment、inline comment 0件を確認 |
| Reports / tracking accuracy | `checked_finding` | R001-R003 continuityは正確、trackingはP4 |
| Regression / maintainability | `checked_finding` | trust-boundaryとconsumer gateの欠落 |
| Breaking changes record | `not_applicable` | 現差分に既存公開contract/file formatの破壊的変更は確認されない |

## Validation assessment

- `git diff --check 05a5350575c6a7c1e7b6b2534b78d2c273317044..93befcf2645a7b011ab932230a77d65b94a3d800`: success。
- `git merge-tree --write-tree 05a5350575c6a7c1e7b6b2534b78d2c273317044 93befcf2645a7b011ab932230a77d65b94a3d800`: success、tree `7c6a0a76290fffe07f289cca08e17b44e5d59459`。
- GitHub synthetic merge commit `5b787c0b651dac96336bc191777e8079b26bb5a8`: parentsはfixed baseとreviewed HEAD、treeはlocal merge-treeと同じ`7c6a0a...`。current-base統合はcontent上clean。ただしexact-head CI runsはbase更新前に開始されており、このsynthetic merge commit自体の再実行証拠ではない。
- GitHub Actions pull_request run `30720372243`: head SHA `93befcf2645a7b011ab932230a77d65b94a3d800`、completed/success。Build、Contract typecheck、architecture正負、lint、unit、Git integration、Mock GitHub integration、VS Code Extension Hostがsuccess。
- GitHub Actions push run `30720370638`: 同じhead SHA、completed/success、同じconfigured gateがsuccess。
- CI成功は既存testの通過証拠だが、P1/P2/P3/P5/P6/P7の欠落caseを実行しておらずfindingを否定しない。
- Source直接実行probe（Node type stripping、repository非変更）: arbitrary remote `attacker.example`から`github-enterprise-secret`を取得して`https://attacker.example/api/v3/...`へBearer送信すること、`[null]` responseがTypeErrorになること、self-loop next linkが1 fetch後にempty `found`になること、T401/T202間のport/case identity差を再現した。
- 独立reviewではfull suiteを再実行していない。static source/data-flow、上記focused probe、repository contract、GitHub metadata、既存exact-head CIを証拠とした。
- Markdown focused/full lint: `tools/lint/`と`package.json`の`lint:md`が存在しないため`unsupported`。passへ変換せず、review reportのwording/backtick用途を手動確認した。repository設定変更は行っていない。

## Held, unexplored, and remaining risks

- Held: Issue #28「WindowsでPOSIX path fixtureのunit testsが失敗する」。openかつT401本筋外で、Linux exact-head CIのunit gate成功によりnon-blocking heldを維持する。
- Unexplored: なし。live GitHub Enterprise OAuth/API end-to-endは環境がなく未実行だが、対象trust boundaryはsource/probeで評価済みでありvalidation limitationとして保持する。
- Remaining non-blocking risks: 長大だが非循環なpagination chainにpage/response上限がない。chooserが入力候補外objectを返す場合の防御、network timeout/cancellation、runtime PR context/UI composition、current-base synthetic mergeのCI再実行は後続integration時に再評価が必要。
- Unknown: なし。

## Verdict and next action

- Verdict: **fail**。
- Required/open findings: `T401-IFR2-P1` High、`T401-IFR2-P2` Medium、`T401-IFR2-P3` Medium、`T401-IFR2-P4` Medium、`T401-IFR2-P5` Medium、`T401-IFR2-P6` Medium、`T401-IFR2-P7` Medium。
- Verdict-blocking unexplored area: なし。
- Technical verdict applies only to reviewed implementation HEAD `93befcf2645a7b011ab932230a77d65b94a3d800`。
- Next action: 7 findingをTDD/専用tracking Skillで修正し、design/report/trackingを含む全変更をcommit/push、normal reviewerがfinding identity/severityを維持してclosureを検証、new HEAD matching CI成功後、fresh independent final reviewを行う。Issue #28はheldのまま修正しない。mergeしない。

## Attestation

- `report_attestation_allowed: false`
- 理由: required findingが7件ありverdictがfail。今回のreserved reportをadministrative attestation commitとして受理してはならない。
- `report_attestation_head: null`
- 将来pass時のみ、reviewed implementation HEADをfirst parentとする単一commitが予約済みindependent-final-review report pathだけを変更し、後続commitがないことをcallerが検証する。attestation commitをreviewed implementationとして扱わない。
