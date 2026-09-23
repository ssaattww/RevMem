# Issue #128 / PR #129 Normal Fix Verification

## Metadata

- generated_at: 2026-09-24T08:12:26.8543230+09:00
- repository: ssaattww/RevMem
- issue: #128
- pull_request: #129
- review_mode: fix verification
- reviewer_continuity: same normal reviewer as the initial PR #129 review
- previous reviewed implementation HEAD: 255d8247fe7d9d97b8f9656f7ae2a4c6049be5b2
- previous review record HEAD: 95471dc843d25a73e202f568974b2757128206ec
- Red-only HEAD: d7481d143b6d3daa090764582f0a59291e5fd9f0
- product fix HEAD: 1895d4101a78604acd843263c06bd8bd1732376f
- reviewed implementation HEAD: f398e68f17bc1805574876bec6fc445d0ba8bc4f
- execution_environment: FA780 / Windows / PowerShell / Remote Desktop Commander
- verdict: fail
- merge: not performed

## Scope

前回normal reviewの I128-NR-001 / I128-NR-002 / I128-NR-003 だけをfinding-limitedに再検証した。
95471dc..f398e68 のfix diff、各findingのrequired action、production path、actual composition fixture、focused evidence、tracking/report correction、current-HEAD CIを確認した。
新規の通常レビュー基準は追加していない。

## Source identity

review開始時のFA780 worktreeはbranch `fix/issue-128-global-understanding-folder-scan`、HEAD `f398e68f17bc1805574876bec6fc445d0ba8bc4f`、tracked dirtyなし。
`1895d41..f398e68` はreport / handoff / task trackingだけで、product source/test差分はない。
GitHub PR #129 current HEADも `f398e68f17bc1805574876bec6fc445d0ba8bc4f` と一致した。

## Completeness matrix

| Finding | Required action | Production path | Actual composition fixture | Focused evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| I128-NR-001 / High | explicit-folder filesystem fallbackでもbinary / invalid UTF-8を既存契約どおり除外し、denominatorへ入れずexcluded countへ反映 | `NodeGlobalUnderstandingFileSource`のtyped exclusion → `T505GlobalUnderstandingSource`のdynamic exclusion | NUL binary / invalid UTF-8 のactual `createT305GlobalUnderstandingSource` fixture | Red `d7481d1`; reviewer focused 3/3; reviewer binary recheck total 0 / excluded 1 | **closed** |
| I128-NR-002 / High | PR ownerではauthoritative immutable PR HEAD evidenceがないworking-tree contentをline evidenceへ昇格しない | direct filesystem fallbackにはPR fence追加済み。ただしproduction `createGlobalUnderstandingOpenDocumentReader` → `captureOpenedDocuments` がworking-tree documentをPR HEAD revisionとしてline evidenceへ昇格する経路が残存 | implementation fixtureは `readOpenDocuments: () => []` のため残存経路を非実行。reviewer actual production reader fixtureでlocal open document混入を再現 | supplied Red/Green fixtureは限定ケースのみ。reviewer probe: path-only open docで total 3 != 1、same-path open docで total 2 != 1 | **not closed** |
| I128-NR-003 / Medium | original I128-IMPL-001 Red chronologyを捏造せず、証拠がない場合はunverifiedと記録 | tracking/report only | pre-implementation HEADのretrospective reproductionをoriginal chronologyと分離 | tasks/reportにoriginal chronology=unverifiedを明記。NR-001/002はtest-only Red commit + CI failure artifactを保存 | **closed** |

## I128-NR-001 verification

### Production fix

- repository enumeratorの既存NUL binary判定を `isRepositoryFileBinaryContent` として共有した。
- `NodeGlobalUnderstandingFileSource` はNUL binaryとfatal UTF-8 decodeを `NodeGlobalUnderstandingFileExcludedError` で表す。
- folder sourceはそのtyped exclusionだけをscope failureにせず、pathをline evidence/discoveredから外し `excludedFileCount` へ加算する。
- unrelated I/O failureは従来どおりfailureとして扱う。

### Reviewer verification

current sourceをbuild後、前回のbinary再現fixtureを再実行した。

- existing repository enumerator: `payload.bin` = binary / excluded
- current PR composition: total 0
- progress files: []
- excludedFileCount: 1
- discoveredFilePaths: []

また current compiled testで以下3件はpassした。

- I128-NR-001 NUL binary exclusion
- I128-NR-001 invalid UTF-8 exclusion
- I128-NR-002 supplied path-only fixture

I128-NR-001のrequired actionは満たされているためclosed。

## I128-NR-002 verification

### Implemented part

`T505GlobalUnderstandingSource` のunopened filesystem fallbackは
`owner.target.kind !== "pull-request"` に限定され、PR ownerで `NodeGlobalUnderstandingFileSource` を直接使うfallbackは停止した。
supplied regression fixtureでは `readOpenDocuments: () => []` とし、immutable providerが返さない `unchanged.ts` をpath-onlyに保つため、このケースはGreen。

### Remaining production path

実際のextension compositionは `src/composition/extension.ts` で
`createGlobalUnderstandingOpenDocumentReader` を `readOpenDocuments` として常時注入する。

`createGlobalUnderstandingOpenDocumentReader` はworking-treeのopen document本文を読み、
そのevidenceの `revisionId` に `owner.currentRevisionId` を設定する。
PR ownerではこの値はPR HEAD revisionである。

その後 `captureOpenedDocuments` はそのworking-tree evidenceを `evidenceByPath` へ入れ、
scope処理はfilesystem fallback fenceより前に `included` へ昇格する。
さらに同一pathについてはcurrent open-document evidenceがretained PR HEAD evidenceを上書きする。

したがって「immutable PR HEAD sourceがcontentを供給したpathだけをPR line evidenceにする」という
I128-NR-002のrequired actionはまだ満たされていない。

### Reviewer actual-composition reproductions

レビュー用scratchでproductionの `createGlobalUnderstandingOpenDocumentReader` と
`createT305GlobalUnderstandingSource` を組み合わせてcurrent buildを実行した。

Case A: immutable providerは `changed.ts=1行`、local-only `unchanged.ts=2行` をworking-tree documentとしてopen。

Expected:
- PR total 1
- progress.files = changed.ts only
- unchanged.ts = path-only / uncollected

Actual:
- PR total 3
- progress.files = changed.ts, unchanged.ts
- assertion: `3 !== 1`

Evidence:
- `C:\Users\donabe\Project\RevMem-review-evidence\issue128-f398e68\pr-open-boundary-after-build.stdout.log`
- `C:\Users\donabe\Project\RevMem-review-evidence\issue128-f398e68\pr-open-boundary-after-build.stderr.log`

Case B: immutable providerは `changed.ts=1行`、同じ `changed.ts` のworking-tree open documentは2行。

Expected:
- immutable PR HEADがauthoritativeなのでtotal 1

Actual:
- total 2
- open-document evidenceがimmutable PR HEAD evidenceを上書き
- assertion: `2 !== 1`

Evidence:
- `C:\Users\donabe\Project\RevMem-review-evidence\issue128-f398e68\pr-open-overrides-head.stdout.log`
- `C:\Users\donabe\Project\RevMem-review-evidence\issue128-f398e68\pr-open-overrides-head.stderr.log`

### Required action

I128-NR-002はHighのままopenとする。
PR ownerではworking-tree open-document evidenceもPR line evidenceへ昇格させない、またはimmutable PR HEAD evidenceをauthoritativeに保つ明示的なowner-kind境界を設けること。
少なくとも次のactual production composition regressionをRedで先に固定すること。

1. local-only/open working-tree pathはimmutable PR providerが返さない限りuncollectedのまま。
2. PR HEADに存在するpathをworking treeで編集・openしてもimmutable PR HEAD本文を上書きしない。

## I128-NR-003 verification

`tasks/tasks-status.md` と original implementation reportの両方で、
I128-IMPL-001 の original Red-before-Green chronologyを **unverified** と訂正済み。
pre-implementation HEAD `af71e1f...` への後日test適用はretrospective reproductionであり、
当時のTDD順序の証拠ではないと明記されている。

またNR-001/002についてはtest-only commit `d7481d1` を製品fixより先に作成し、
exact-head CI #4694 / run 35924811150 がT610 failureとなり、
failure diagnostic artifact id 10779260305 が同じRed HEADに紐づくことを確認した。

I128-NR-003はclosed。

## Validation assessment

### Reviewer local checks on current reviewed HEAD

- `npm run build`: pass
- `npm run compile:test`: pass
- focused `I128-NR-001|I128-NR-002` supplied tests: 3/3 pass
- previous binary-contract fixture recheck: expected exclusionへ改善
- actual production open-document PR boundary probe A: **fail** (`3 !== 1`)
- actual production open-document PR boundary probe B: **fail** (`2 !== 1`)

### Red evidence

- Red-only HEAD: `d7481d143b6d3daa090764582f0a59291e5fd9f0`
- exact-head CI #4694 / run 35924811150: failure
- failure artifact id 10779260305
- artifact workflow head SHA matches Red-only HEAD

### Current-HEAD CI

- reviewed/current HEAD: `f398e68f17bc1805574876bec6fc445d0ba8bc4f`
- exact-head CI #4701 / run 35926303223: success
- all required jobs reported success, including T610 and VS Code Extension Host
- user-validation artifact: `review-range-user-validation-0.1.56-pre+f398e68`
- artifact id: 10778932970
- artifact workflow head SHA matches current HEAD

CI Green does not close NR-002 because the suite's NR-002 fixture disables the actual open-document production path.

## Required coverage dispositions

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| requirement / design conformance | checked_finding | NR-002 immutable PR evidence boundary remains violated by open-document path |
| correctness / edge cases | checked_finding | local-only open doc and same-path local edit both reproduced |
| scope discipline | checked_no_finding | fix changes remain within Issue #128 review findings |
| changed files / direct dependencies | checked_finding | open-document direct dependency exposes incomplete NR-002 fix |
| API / data / compatibility | checked_finding | working-tree evidence can still carry PR HEAD revision identity |
| error handling / diagnostics | checked_no_finding | NR-001 exclusions no longer become generic scope failure; existing diagnostics retained |
| security / secret handling | checked_finding | mutable local content still affects immutable PR-context evidence |
| tests / validation adequacy | checked_finding | supplied NR-002 fixture omits production open-document path |
| current-HEAD CI | checked_no_finding | exact current-head #4701 success; artifact head matches |
| report / tracking accuracy | checked_no_finding | NR-003 correction is explicit and evidence-faithful |
| regression / maintainability | checked_finding | two parallel evidence sources need an explicit PR-owner authority rule |
| workflow / failure artifact | checked_no_finding | Red CI failure artifact exists and matches d7481d1 |

## Findings status

- I128-NR-001 / High: **closed**
- I128-NR-002 / High: **not closed**
- I128-NR-003 / Medium: **closed**
- New finding IDs: none

## Held / unexplored

- held: none
- unexplored: no verdict-blocking area remains outside the bounded NR-001〜003 scope

## Verdict

**fail**

I128-NR-002 remains a required High finding.
NR-001 and NR-003 do not need further work unless the next fix changes their production paths.

## Next action

Implementation chat should address only I128-NR-002 with Red-first actual production composition tests covering both:
- local-only/open path with no immutable PR evidence
- local modification/open document for a path that does have immutable PR HEAD evidence

After the fix, return to this same normal-review chat for I128-NR-002-only fix verification.
Do not merge.
