# T503 Fix Verification レポート

## メタデータ

- Repository: `ssaattww/RevMem`
- Issue: #1
- Task: T503 repository file列挙・gitignore・空行判定
- Pull Request: #34
- Review mode: fix verification
- Base: `main` `ec1ce78ab35867397c33d711095424e3eedd6e2c`
- Previous reviewed implementation HEAD: `bf36ad9a988199a670e4ce3fa7d2dbafc888a32a`
- Reviewed implementation HEAD: `3cd46ebd356f4c3709083915d26747e6b5200883`
- Fix range: `bf36ad9a988199a670e4ce3fa7d2dbafc888a32a..3cd46ebd356f4c3709083915d26747e6b5200883`
- Reviewer continuity: 前回T503レビューを実施した同一chatによるfix verification
- Verdict: `fail`

## 対象範囲

前回findingのidentityとseverityを維持して、次を確認した。

- T503-IR-001 high: 除外directory走査・read境界
- T503-IR-002 high: `.gitignore`の`**/` 0 directory segment semantics
- T503-IR-003 medium: symbolic linkの除外理由保持
- 修正diffと新規変更箇所
- 同一defect classのsibling case
- current HEADに一致するCI evidence

また、T503の終了条件、設計書のGlobal理解率分母、後続T505の除外file表示への影響を再確認した。

## 変更確認

Fix rangeで確認したfile:

- `src/adapters/repository-files/node-repository-file-enumerator.ts`
- `test/unit/repository-file-enumerator.test.ts`
- `reports/issue-1-t503-independent-review-20260801235000.md`
- `reports/issue-1-t503-review-followup-20260801235800.md`

## CI・検証証跡

- Reviewed HEAD: `3cd46ebd356f4c3709083915d26747e6b5200883`
- Matching workflow run: `30705165379`
- Workflow: `CI`
- Conclusion: `success`

別SHAのrunは採用していない。CIはcurrent HEADと一致する。ただし現在のfocused testは本レポートの残存findingと新規findingを検証していない。

## 前回finding disposition

### T503-IR-001 — high — `partial`

除外directoryを再帰前にpruneし、配下fileをreadしない点は修正された。走査負荷とread failure boundaryは改善している。

しかし、prune時に`ExcludedRepositoryFile`へdirectory path 1件だけを追加し、配下fileを列挙結果から消している。例えばfixtureの`dist/bundle.js`は結果に存在せず、`dist`だけが`default-glob`として返る。

T503はrepository file列挙と除外理由保持を要求し、設計上T505は除外file・除外数を表示する。directory aggregateへ契約を変更すると、配下の除外file identityとfile数を後続処理へ渡せない。前回findingのrequired actionにあった「内容をreadせずpathだけで除外理由を生成する」部分を満たしていない。

Required action:

- directoryをpruneしつつ、除外対象fileのidentityと理由を保持できる列挙方式へ変更する、またはdirectory aggregateを正式な別result型として設計し、T503終了条件・T505契約・count semanticsを更新する
- `dist/bundle.js`等の配下file pathが結果へ保持されることをtestする

### T503-IR-002 — high — `addressed`

`**/`を`(?:[^/]+/)*`へcompileし、root直下および中間directory 0個のcaseを許可している。`root-generated.ts`と`src/nested-generated.ts`の回帰testを確認した。

### T503-IR-003 — medium — `addressed`

symbolic linkをfollowせず、`{ kind: "symbolic-link" }`としてexcluded結果へ保持している。fixtureの`linked-a.ts`で理由を検証している。

## 新規finding

### T503-FV-001 — high — negation ruleがignored parent directory配下のfileを誤って再包含する

- Origin: introduced_by_fix
- Location: `src/adapters/repository-files/node-repository-file-enumerator.ts` の `matchingGitIgnoreRule()` と `walk()`
- Description: negated ruleが1件でも存在すると、gitignoreで除外されたdirectoryをpruneせず再帰する。各fileでは最後に一致したnegated ruleならincludedへ戻すため、親directoryがignoreされたままでも子fileを再包含できる。Gitは除外されたparent directoryを明示的に再包含しない限り、その配下fileだけを`!`で再包含できない。
- Reproduction:
  - `.gitignore`: `ignored/` と `!ignored/keep.ts`
  - repository file: `ignored/keep.ts`
  - Gitではparent `ignored/`が除外されたままなので`keep.ts`もignored
  - 現実装ではdirectoryへ再帰し、最後のmatching ruleがnegatedになるため`keep.ts`をincludedへ入れる
- Impact:
  - Gitがignoredと判断するfileがGlobal理解率の分母へ混入する
  - `.gitignore`適用結果とrepository表示が一致しない
  - negationを含む一般的なroot `.gitignore`で集計精度が壊れる
- Required action:
  - parent directoryのignore/re-include stateを階層的に保持し、parentが再包含されていない場合はchild negationを無効にする
  - `ignored/`, `!ignored/keep.ts`が再包含されないcaseと、`!ignored/`, `!ignored/keep.ts`等でparentも再包含したcaseをRed testとして追加する

## Required coverage dispositions

| Criterion | Disposition | Evidence |
|---|---|---|
| Requirement/design conformance | checked_finding | T503-IR-001 partial、T503-FV-001 |
| Correctness and edge cases | checked_finding | directory aggregate、negated child under ignored parent |
| Scope discipline | checked_no_finding | 修正は前回finding関連fileとreportに限定 |
| Changed files | checked_finding | fix range全4fileを確認 |
| Direct dependency impact | checked_finding | T505の除外file・除外数契約へidentity欠落が波及 |
| API/data/config compatibility | checked_finding | `ExcludedRepositoryFile`がfile pathからdirectory aggregateを混在させる |
| Error handling/failure diagnostics | checked_no_finding | policy/gitignore除外fileをread前に除外しfailure boundaryを改善 |
| Security/secret handling | checked_no_finding | symlink followを継続して回避 |
| Tests and validation adequacy | checked_finding | parent ignore + child negation、配下file identityを未検証 |
| Current-HEAD CI | checked_no_finding | run 30705165379、HEAD一致、success |
| Report/tracking/documentation accuracy | checked_finding | follow-up reportはIR-001をaddressedとするがfile identity欠落を扱っていない |
| Regression/maintainability risk | checked_finding | 独自gitignore state machineが階層stateを持たない |

## Held / unexplored

- Held: Git wildmatchの全仕様互換。今回のfindingは全仕様互換ではなく、parent directory ignoreとnegationの基本state semanticsに限定する。
- Unexplored: Windows junction/reparse pointの実行検証。current evidenceでは実行環境を確保できない。

## Verdict

`fail`

T503-IR-002とT503-IR-003はclosed。T503-IR-001はpartialのままであり、新規high finding T503-FV-001がある。修正後に同じreviewerによるfix verificationが必要であり、passing independent final reviewはその後に新しいchatで実施する。

## Merge境界

mergeは行っていない。
