# T503 独立最終レビューレポート

## Metadata / target identity

- Repository: `ssaattww/RevMem`
- Issue / task: Issue #1 / T503 repository file列挙・gitignore・空行判定
- Pull Request: #34 `T503: repository file列挙とGlobal集計候補を実装`
- Review mode: independent final review
- Reviewer: reviewer 2/2（本PRの実装、review fix、通常review、fix verificationに未関与の別chat）
- Independence evidence: reviewerは本review中に実装、fix、commit、push、PR comment、mergeを行っておらず、変更したrepository pathは事前予約済みの本reportだけである
- Branch: `task/t503-repository-file-enumeration`
- Current base: `origin/main` `05a5350575c6a7c1e7b6b2534b78d2c273317044`
- PR merge-base / branch parent: `ec1ce78ab35867397c33d711095424e3eedd6e2c`
- Reviewed implementation HEAD: `c0215bb3d715b152946c0e3eccae67a01ccc1985`
- PR implementation range: `ec1ce78ab35867397c33d711095424e3eedd6e2c...c0215bb3d715b152946c0e3eccae67a01ccc1985`
- Current-base comparison: `05a5350575c6a7c1e7b6b2534b78d2c273317044..c0215bb3d715b152946c0e3eccae67a01ccc1985`
- Reserved report path: `reports/issue-1-t503-independent-final-review-20260802093030.md`
- Intended persistence for a passing review: one administrative `report_attestation_commit`
- Technical verdict: `fail`
- Report attestation allowed: `false`

技術的verdictは上記reviewed implementation HEADだけに適用する。current `main`はT207のmerge commitを含みreviewed HEADの子孫ではないため、PR本体の15-path three-dot diffと、指定されたcurrent-base two-dot diffの双方を確認した。two-dot上で現れるT207 file/reportの削除・旧版化は、branchがcurrent `main`より前に分岐したことによるmain-only差分であり、PRが提案する削除ではない。GitHubのcurrent merge candidate `c13c9bd06ca9c14f5e6e482ca08463d5174763de`はfirst parentがcurrent `main`、second parentがreviewed HEADで、PRは`MERGEABLE/CLEAN`である。

## Purpose, accepted scope, and non-goals

T503の権威ある終了条件、設計、PR本文、通常review closure、reviewed HEADに一致するCIを独立に再評価した。対象は次のとおり。

- T300 `ReviewFileExclusionPolicy`と同じユーザーglob・binary判定の再利用
- repository-relative pathによる決定的なfile列挙
- root `.gitignore`判定
- binary判定、symbolic link非追跡、除外理由保持
- 共通policyまたはgitignoreで除外したdirectoryの再帰前prune
- `included` / `excluded` / `excludedDirectories`の型・集計・sort・重複禁止契約
- コメント行を含むtrim後非空行の計数
- T504/T505 consumer境界、設計、task tracking、report、PR本文・comment、CI workflow

次は既存のaccepted non-goal / heldであり、本verdictのrequired findingにはしていない。

- nested `.gitignore`読込とGit wildmatch完全互換（escaped `#` / `!`、trailing-space、全pattern構文を含む）
- T504のcalculator、cache、chunk/background再計算
- T505のGlobal Understanding ViewとStatus Bar実装
- T607の大規模repository性能最適化
- Issue #28のWindows POSIX path fixture failure（本PRと因果関係のない既知held）

ただし、後述のdirectory-only規則は「完全wildmatch互換」ではなく、`cache/`がregular file `cache`へ一致してはならないというroot `.gitignore`のentry-kind境界であるためheldに含めていない。

## Authoritative requirements and design

- `tasks/tasks-status.md` T503: `included`へ非空行の分母候補file、`excluded`へ実際に列挙した除外file、`excludedDirectories`へpruneしたdirectoryを1 directory 1件で保持し、3配列をpath昇順・重複なしとし、ユーザーglob・binary・`.gitignore`・symbolic linkの理由を保持する。
- `doc/design/vscode-review-range-tracker-design.md` 11.3 / 12章 / 16.5 / 20.2: `included`だけがGlobal分母候補、prune subtreeは分子・分母へ寄与せず、除外file数とdirectory診断数を混在させず、repository列挙時に`.gitignore`を適用する。
- PR #34本文: root `.gitignore`、T300 policy、binary、non-empty lines、symlink、directory prune、3配列の集計契約、focused CIを実装範囲とする。
- 過去review: `T503-IR-001` high、`T503-IR-002` high、`T503-IR-003` medium、`T503-FV-001` highのidentityとseverity、およびR4でのclosure主張を確認した。

## Inspected changed files and dependencies

PR three-dot diffの15 pathをすべて確認した。

1. `.github/workflows/ci.yml`
2. `doc/design/vscode-review-range-tracker-design.md`
3. `reports/issue-1-t503-implementation-20260801234500.md`
4. `reports/issue-1-t503-independent-review-20260801235000.md`
5. `reports/issue-1-t503-review-followup-20260801235800.md`
6. `reports/issue-1-t503-fix-verification-20260802062100.md`
7. `reports/issue-1-t503-review-followup-r2-20260802062700.md`
8. `reports/issue-1-t503-fix-verification-r2-20260802063200.md`
9. `reports/issue-1-t503-review-followup-r3-20260802063400.md`
10. `reports/issue-1-t503-fix-verification-r3-20260802064200.md`
11. `reports/issue-1-t503-review-followup-r4-20260802065500.md`
12. `reports/issue-1-t503-fix-verification-r4-20260802070700.md`
13. `src/adapters/repository-files/node-repository-file-enumerator.ts`
14. `tasks/tasks-status.md`
15. `test/unit/repository-file-enumerator.test.ts`

直接依存として次も確認した。

- `src/core/file-exclusion/review-file-exclusion-policy.ts`
- `src/application/file-exclusion/review-file-exclusion-policy-service.ts`
- `test/unit/review-file-exclusion-policy.test.ts`
- `package.json` / `tsconfig.json` / `tsconfig.test.json`
- repository root `.gitignore`
- PR #34本文、全review、全comment、current merge state
- current `main`で追加されたT207のsource/test/report/workflow/package/task差分と、PR merge candidate上での共存証拠

Current-base two-dot diffにだけ現れるT207の8 report削除、integration test削除、既存source/test/packageの旧版化はbranch divergenceとして確認し、PR changed-file setへ誤分類していない。PR-event CIはT207 merge後に実行され、current merge candidateはcleanである。

## Validation and evidence

### Current-HEAD CI

- Pull request run: `30720650746`
  - `headSha`: `c0215bb3d715b152946c0e3eccae67a01ccc1985`
  - event: `pull_request`
  - conclusion: `success`
  - job `build-and-lint` / job ID `91423747581`: success
- Push run: `30720648944`
  - `headSha`: `c0215bb3d715b152946c0e3eccae67a01ccc1985`
  - event: `push`
  - conclusion: `success`
  - job `build-and-lint` / job ID `91423742558`: success

両runともbuild、contract typecheck、architecture positive/negative、lint、unit、T503 focused、temporary Git、mock GitHub、Extension Hostを成功している。pull-request runはcurrent `main`のT207 merge後に開始され、current merge candidateがcleanであるため、current baseとの統合証拠としても有効である。

### Local focused and diagnostic probes

Environment: Node.js `v24.18.0`、npm `11.16.0`、Windows。

- `npm ci`: success。tracked fileは変更されていない。
- `npm run compile:test`: success。
- `git diff --check`（PR rangeおよびcurrent-base two-dot）: success。
- Markdown focused/full wording lint: `unsupported`。repositoryに`tools/lint/`、`lint:md`、`cspell.config.jsonc`がなく、実行可能なrepo-local wiringはない。inline codeはSHA、path、identifier、command、verdict等に限定し、通常proseをlint回避目的で囲っていない。
- `node --test test-dist/test/unit/repository-file-enumerator.test.js`: 1 pass / 1 fail。失敗はfile symlink作成時のWindows `EPERM`であり、製品assertionへ到達していない（finding `T503-IFR-004`）。
- repository非変更のtemporary fixture probe:
  - T300 policy `src/*`は`src/nested/deep.ts`をincludeと判定する一方、enumeratorは`src`全体を`excludedDirectories`へpruneした（`T503-IR-001`再open）。
  - root `.gitignore` `cache/`に対して`git check-ignore cache`はnot ignoredだが、enumeratorはregular file `cache`をgitignore除外した（`T503-IFR-001`）。
  - `countNonEmptyLines("a\rb\r")`は`1`を返した（実非空行は2、`T503-IFR-002`）。
  - Windows directory junctionは`Dirent.isSymbolicLink()`で検出され、followせず`symbolic-link`理由で`excluded`へ保持された。
  - `"é.ts".localeCompare("e\u0301.ts", "en")`と逆順がともに`0`となり、distinct pathへtotal orderを与えないことを確認した（`T503-IFR-005`）。

Matching CI successは有効だが、current test fixtureが以下のfinding caseを覆っていないため、CI successだけではT503終了条件の正しさを証明しない。

## Findings

### T503-IR-001 — high — reopened — synthetic childによるdirectory pruneがT300 file globより広くfileを除外する

- Source severity: high（変更なし、reclassificationなし）
- Origin: closure gap / introduced by the directory-prune fix
- Location: `src/adapters/repository-files/node-repository-file-enumerator.ts:186-196`
- Description: directoryをpruneできるか判断するため、実在しない`${repositoryPath}/.enumeration-probe`をT300のfile-oriented `ReviewFileExclusionPolicy.evaluate()`へ渡している。この1個のsynthetic childがglobへ一致しただけでdirectory全体をpruneするため、globが実際には全descendant fileへ一致しない場合も対象fileを列挙から消す。
- Reproduction:
  - repository: `src/direct.ts`, `src/nested/deep.ts`
  - user glob: `src/*`
  - T300 policyの直接判定: `src/nested/deep.ts`は`excluded: false`
  - enumerator結果: `included=[]`, `excludedDirectories=[{ path: "src", reason: { kind: "user-glob", pattern: "src/*" }}]`
- Impact:
  - PR進捗側のT300判定では対象となるdeep fileがGlobal側だけ分母から消え、「同じpolicyを再利用する」契約が破れる。
  - `src/.*`や`.enumeration-probe`のようにprobe名だけへ一致する合法的設定でも、非一致fileを含むdirectory全体が消える。
  - `excludedDirectories`は配下fileを展開・推定しない契約のため、後段T504/T505では誤pruneを検出・回復できない。
- Prior closure assessment: `.git` / `dist`等の既定globを早期pruneする部分はaddressedのままだが、任意のT300 user globに対するsibling caseが未解決であるため、`T503-IR-001`の全体closureは成立しない。
- Required action:
  - T300側にdirectory/subtree全体を安全に除外できる明示的decision contractを追加するか、全descendantへの一致を証明できないglobではdirectoryをpruneせず各実fileへpolicyを適用する。
  - 少なくとも`src/*` + `src/nested/deep.ts`、`src/.*` + non-hidden child、literal `.enumeration-probe` globを回帰testへ追加する。

### T503-IFR-001 — high — directory-only `.gitignore` ruleが同名regular fileを除外する

- Origin: introduced by change
- Location: `src/adapters/repository-files/node-repository-file-enumerator.ts:89-106,199-204`
- Description: parserはtrailing `/`を`directoryOnly`として一度認識するが、その情報をruleへ保持せず、regex suffix `(?:/.*)?$`のoptional部分に変換する。matcherにはentry kindも渡さないため、`cache/`はdirectory `cache`だけでなくregular file `cache`にも一致する。
- Evidence: temporary Git repositoryでroot `.gitignore`を`cache/`、regular fileを`cache`とした。`git check-ignore -q -- cache`はexit 1（not ignored）だが、enumeratorは`cache`を`{ kind: "gitignore", pattern: "cache/" }`として`excluded`へ入れた。
- Impact: Gitが対象とするregular fileがGlobal分母から除外され、`.gitignore`判定とT503の分母候補が不一致になる。directory/file同名は通常の有効filesystem stateであり、完全wildmatch互換というheld範囲に依存しない。
- Required action:
  - ruleに`directoryOnly`を保持し、entry kindをmatcherへ渡してregular fileへdirectory-only ruleを適用しない。
  - 同名regular fileとdirectory、およびnegated directory-only ruleの回帰testを追加し、`git check-ignore`の結果と一致させる。

### T503-IFR-002 — medium — lone-CR fileの非空行数を過少計数する

- Origin: introduced by change
- Location: `src/adapters/repository-files/node-repository-file-enumerator.ts:128-130`
- Description: `countNonEmptyLines()`は`/\r?\n/`だけでsplitし、CRLFとLFは扱うがlone CRをline separatorとして扱わない。
- Evidence: `countNonEmptyLines("a\rb\r")`は`1`。repository内の既存mapping契約・testはCRLF / LF / CRを別々の有効EOLとして扱っており、この内容の非空行は2行である。
- Impact: lone-CR fileのGlobal denominatorが実際のeditor line countより小さくなり、T504のrepository/file理解率が誤る。
- Required action: `\r\n|\r|\n`を区別してcountし、LF、CRLF、CR、mixed EOL、末尾separator、空行の回帰testを追加する。

### T503-IFR-003 — medium — pre-freeze task trackingとPR commentが実状態に同期していない

- Origin: pre-freeze finalization omission
- Location: `tasks/tasks-status.md:251`、同fileの「現在位置」・report参照、PR comment `https://github.com/ssaattww/RevMem/pull/34#issuecomment-5153670498`
- Description:
  - reviewed HEADは実装・4回のnormal fix verificationを完了しているが、T503行の状態は`未着手`のままである。
  - task fileの現在位置・branch・PR・実装状態・次回選択・report参照はT206/T207以前の状態で、T503 lifecycleを記録していない。current `main`側のT207 trackingとthree-way mergeしても、T503行の`未着手`は残る。
  - PR commentは実在しない`reports/issue-1-t503-review-followup-r4-20260802070000.md`を詳細reportとして案内している。実在pathは`reports/issue-1-t503-review-followup-r4-20260802065500.md`である。
- Impact: `tasks/tasks-status.md`のauthoritative進捗と実際の完了状態が矛盾し、review-enforcerのpre-freeze tracking gateを満たさない。次chatがT503を未着手として再選択し得て、review evidenceへの導線も一部brokenである。
- Required action:
  - `progress-sync-manager`等のrepository所定Skillを通して、T503状態、現在位置、PR/report参照、次回選択をcurrent `main`のT207完了状態と両立する形で同期する。
  - 誤pathのPR commentを訂正する。tracking変更後は通常review/fix verification、current-HEAD CI、独立closure確認の対象に含める。

### T503-IFR-004 — low — focused T503 testがWindows symlink権限なし環境で製品assertion前に失敗する

- Origin: introduced by test change
- Location: `test/unit/repository-file-enumerator.test.ts:9-29`
- Description: fixture setupがfile symlinkを無条件に作成する。WindowsでDeveloper Modeまたはsymlink privilegeがない通常環境では`EPERM`となり、列挙behaviorのassertionへ到達しない。
- Evidence: Windows local runは2 test中、line-count test 1件pass、main fixture 1件が`symlink(...linked-a.ts)`の`EPERM`でfailした。これはIssue #28のPOSIX path fixture failureとは別原因である。
- Impact: Windows contributorはfocused regressionを通常権限で再現できず、CIはUbuntu 1環境だけなのでWindows filesystem境界の継続検証が弱い。
- Required action: capability-aware setupでfile symlink caseを明示skip/分離し、Windowsで権限不要なjunction caseも追加するなど、unsupported capabilityと製品failureを区別する。Linux CIのfile/directory symlink coverageは維持する。

### T503-IFR-005 — low — locale comparatorがdistinct pathへtotal orderを与えず決定的sort契約を満たさない

- Origin: introduced by change
- Location: `src/adapters/repository-files/node-repository-file-enumerator.ts:121-122,139,153-155`
- Description: sort comparatorは`localeCompare(..., "en")`を使用する。Unicode canonical equivalentだがfilesystem上はdistinctになり得る`é.ts`と`e\u0301.ts`に対して、両方向とも`0`を返す。stable sortはその場合readdir入力順を維持するため、列挙順をtotalに決定していない。
- Impact: POSIX等で両名が共存するrepositoryでは、filesystem/readdir順により3配列の順序が変わり得る。設計・JSDocの「repository-relative path昇順」「決定的列挙」を厳密には満たさない。
- Required action: distinct pathに必ず非0を返すlocale非依存のcode-unitまたはUTF-8 byte comparatorを使用し、canonical-equivalent Unicode名を逆順に入力しても同一結果になるtestを追加する。

## Prior finding closure

| Finding | Source severity | Current disposition | Evidence |
|---|---:|---|---|
| T503-IR-001 | high | reopened | 既定directory pruneは改善したが、synthetic probeによるuser glob false pruneを再現した |
| T503-IR-002 | high | closed, no regression observed | `**/` 0-segment compileとroot/direct-child regressionを確認した |
| T503-IR-003 | medium | closed, no regression observed | file symlinkとWindows junctionをfollowせず`symbolic-link`理由で保持する |
| T503-FV-001 | high | closed, no regression observed | `ignored/` + `!ignored/keep.ts`ではparentをpruneしchildを再包含しない |

Severity reclassification recordはない。`T503-IR-001`はsource severity `high`を保持したまま、closure不足の新証拠によりreopenした。

## Required coverage dispositions

| Criterion | Disposition | Evidence |
|---|---|---|
| Requirement and design conformance | `checked_finding` | T503-IR-001、T503-IFR-001〜003、005 |
| Correctness and edge cases | `checked_finding` | user glob false prune、directory-only gitignore、CR EOL、Unicode sortを実行再現 |
| Scope discipline and unrelated changes | `checked_no_finding` | PR three-dot 15 pathはT503・契約・review・CIに限定。current-baseのT207差分はbranch divergenceでPR提案削除ではない |
| Changed files and direct dependencies | `checked_finding` | 15 changed path、T300 policy/service/test、current main integrationを確認。directory decision contract mismatchあり |
| API, data, configuration, workflow, compatibility | `checked_finding` | 任意user globのGlobal/PR不一致、tracking stale、Windows focused test portability |
| Error handling and failure diagnostics | `checked_no_finding` | 除外directoryをread前にpruneし、CI failure log/artifact wiringをT503 focused stepへ適用している |
| Security and secret handling | `checked_no_finding` | symlink/junctionをfollowせずrepository外escape/cycleを回避。secret、token、permission拡大なし |
| Tests and validation adequacy | `checked_finding` | matching CIはsuccessだがfinding reproductionが未coverage、Windows focused testはEPERM |
| Current-HEAD CI evidence | `checked_no_finding` | run `30720650746` / `30720648944`はreviewed HEADと一致しsuccess |
| Report, tracking, documentation accuracy | `checked_finding` | T503-IFR-003。historical finding severityは維持されている |
| Regression and maintainability risk | `checked_finding` | synthetic sentinel、entry-kindを失う独自matcher、非total comparatorがdownstreamで回復不能な結果を生成する |

## Held, unexplored, and remaining risks

### Held

- Issue #28: Windows POSIX path fixtureの既知failure。T503-IFR-004とは別原因で、本PRでは修正しない。
- nested `.gitignore`およびGit wildmatch完全互換。既存実装reportとnormal reviewでscope外と明示されている。
- T504/T505/T607のbackground chunking、UI、performance最適化。

### Unexplored / not rerun

- Full local suiteは再実行していない。reviewed HEADに一致する2本のfull CI successを再利用し、必要なfocused compileとdefect probeだけを実行した。
- file symlinkの製品assertionはWindows権限制約でlocal未到達だが、matching Linux CIでpassし、同じproduction branchのWindows junction挙動を別probeで確認した。
- Git wildmatchのheld領域、特殊filesystem entry、列挙中のconcurrent mutationに新規観点は広げていない。後二者の包括的failure policyはT606/T607側の残存リスクである。

## Verdict and next action

Verdict: `fail`

High required finding 2件（うち`T503-IR-001` reopen）、medium 2件、low 2件がある。Global分母候補のfile identity、root `.gitignore`結果、非空行数、tracking、focused test portability、決定的sortのいずれもreviewed HEADのままでは全契約を満たさない。

次のaction:

1. 実装側で全findingを一括修正し、必要なdesign/task/report同期をindependent-final freeze前に完了する。
2. 通常reviewerがfinding identity・severityを維持して全closureとsibling regressionをfix verificationする。
3. current-HEAD CI success、全non-final writeのcommit/push後、本reviewerはユーザー指定どおり上記既存findingのclosureだけを確認し、新規観点・新規findingを追加しない。

## Report attestation and merge boundary

- `report_attestation_allowed: false`
- fail verdictのため、本reportをpassing independent-final administrative attestationとしてcommitしてはならない。
- 予約pathは本review evidenceの保存先であるが、技術的verdictは`c0215bb3d715b152946c0e3eccae67a01ccc1985`にのみ属する。
- 将来passした場合でも、attestationはreviewed implementation HEADをfirst parentとするちょうど1 commit、変更pathは事前予約済みindependent-final-review reportだけ、attestation SHAはcommit後に外部記録、後続Git commitなし、というallowlistをcallerが再検証する必要がある。
- 本reviewではcommit、push、PR comment、mergeを行っていない。mergeは許可しない。
