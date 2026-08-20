# Sub-agent実行レポート

## タスク

- 目的: T406通常reviewで確定した5 findingだけを同じreviewerがclosure確認する。
- タスク種別: normal finding-limited closure verification
- source review: `reports/issue-70-t406-normal-review-20260820091339.md`
- reviewed fix HEAD: `824bf17941c4e809c5e7f1cfa699e2c90915a227`
- 対象finding: `T406-R001` High、`T406-R002` Medium、`T406-R003` Medium、`T406-R004` Medium、`T406-R005` Low

## sub-agentを使う理由

- 理由: source sol high reviewerが確定findingと直接修正だけを確認し、新観点を追加せず収束させるため。

## 対象範囲

- source review の `T406-R001` High、`T406-R002` Medium、`T406-R003` Medium、`T406-R004` Medium、`T406-R005` Low の5件だけ。
- fix range `8341d072523422da9f996ef69a109ae2e69ad7b5..824bf17941c4e809c5e7f1cfa699e2c90915a227` と各 finding の直接影響。
- follow-up report `reports/issue-70-t406-review-followup-20260820092341.md`、handoff `handoffs/issue-70-t406-review-followup-20260820092341.yaml`、提示された Red / Green / local validation、PR #71 の exact-head CI 状態。
- reviewer continuity: source review と同じ Codex sub-agent `/root/t406_normal_review`。実装・検証実行には参加していない。
- report type: `verification_report` / `fix_verification`。通常 closure のため report attestation は `false` / `not_applicable`。

## 対象外

- fresh / full review、新しい観点、新規 finding、source finding 以外の全差分探索。
- test / CI の起動、再実行、待機。実装、tracking 修正、commit、push、PR 操作、merge。
- source review の historical record の書き換え。closure は本 report に追記する。
- independent final review。open finding が残るため、この時点では開始条件を満たさない。

## 実行コマンド

- reviewer が実行したのは read-only の `git status`、`git rev-parse`、`git diff`、`git diff --check`、`rg`、`Get-Content` と、exact-head CI の一度だけの `gh pr view` / `gh run list` 観測である。
- reviewed fix HEAD は `824bf17941c4e809c5e7f1cfa699e2c90915a227`、fix base は `8341d072523422da9f996ef69a109ae2e69ad7b5`、fix range は1 commit / 12 files。`git diff --check` は出力なし。
- implementation report 提示の Red: R001 API 追加前の `npm run compile:test` failure。
- implementation report 提示の Green / local validation: `npm run test:t406` 28 pass / 0 fail、focused T405 composition 2 pass / 0 fail、build、contract typecheck、lint、architecture positive / expected-negative、CI workflow contract 10 pass / 0 fail、diff-check Green。reviewer は再実行していない。
- exact-head CI は 2026-08-20 09:44 JST に一度だけ観測した。pull_request run `32318273773` と push run `32318271864` はいずれも exact HEAD `824bf17941c4e809c5e7f1cfa699e2c90915a227` で `in_progress`。待機・再観測は禁止のため held とした。
- Markdown wording check は repository に `tools/lint/`、focused wiring、`lint:md` がなく、focused / full とも `unsupported`。lint command は実行していない。

## 対象ファイル

- source / follow-up evidence: `reports/issue-70-t406-normal-review-20260820091339.md`、`reports/issue-70-t406-review-followup-20260820092341.md`、`handoffs/issue-70-t406-review-followup-20260820092341.yaml`。
- R001: `src/application/review-contexts/current-pull-request-context.ts`、`src/t405-review-contexts-runtime.ts`、`src/ui/review-contexts/vscode-review-contexts-runtime.ts`、`test/unit/t405-review-followup.test.ts`、`test/unit/t405-composition-regression.test.ts`。
- R002: `src/application/operation-feedback/operation-feedback.ts`、`src/t405-review-contexts-runtime.ts`、`test/unit/t405-composition-regression.test.ts`。
- R003 / R004: `test/unit/t405-composition-regression.test.ts` と既存 production composition の直接 runtime / persistence seam。
- R005: `README.md`、`tasks/tasks-status.md`、`tasks/phases-status.md`、handoff と PR #71 metadata。
- fix range の残りの design / report 差分は、該当 finding の直接証拠としてだけ確認した。

## 指摘事項

### `T406-R001` — High — `open`

- location: `src/ui/review-contexts/vscode-review-contexts-runtime.ts:59-73,76-93`、`test/unit/t405-review-followup.test.ts:227-235`、`test/unit/t405-composition-regression.test.ts:871-901`
- impact: explicit branch / no-PR preference の永続 matrix が保たれず、別 repository / immutable HEAD で PR を明示選択すると、既存の branch sentinel が消える。さらに source finding が要求した saved PR 1件 + 0、saved PR 1件 + multiple cancel、branch context の実 mark / unmark と PR state 不変の production 証拠が揃わないため、通常 editor ownership が PR へ再推測される regression を closure できない。
- evidence: `selectBranch()` は `false` sentinel を保存し `prefersBranch()` は読み取る一方、`select()` は raw state から string 値だけをコピーする。そのため他 key の `false` を捨てる。helper test は suppression 引数だけを検証する。composition の cancel は persisted PR が2件、network fallback は PR #53 を closed にした単一 open PRだが、その後の実 branch mark / unmark と PR state 不変は検証しない。0-candidate production flow もない。
- action: `select()` でも他 key の string / `false` を保持し、repository / immutable HEAD 単位の explicit PR / branch matrix を永続化する。source required matrix の saved PR 1件 + unavailable / 0、saved PR 1件 + multiple cancel、実 branch mark / unmark と PR context 不変を production composition で追加し、同じ reviewer が R001 だけを再確認する。

### `T406-R002` — Medium — `closed`

- location: `src/application/operation-feedback/operation-feedback.ts:34-41,160-163`、`src/t405-review-contexts-runtime.ts` の unavailable branch、`test/unit/t405-composition-regression.test.ts:885-901`
- impact: source finding の「branch fallback を成功させながら privacy-safe diagnostic を exactly once 残す」契約は回復した。
- evidence: typed `GITHUB_PR_DETECTION_UNAVAILABLE` は reason を `rate-limit | network | api` に限定し、Output は code / reason のみを整形する。production composition は network unavailable 後の branch context、同 diagnostic 1件、成功 operation、raw error / repositoryRoot / targetHeadSha 非出力を assert する。
- action: なし。source severity Medium を保持して closed。

### `T406-R003` — Medium — `closed`

- location: `test/unit/t405-composition-regression.test.ts:662-711`
- impact: source finding の post-outage immutable recovery / cache B identity 不足は解消した。
- evidence: live A、stale offline A、cache write failure の後に repository を recovered HEAD B へ進め、live redetect / refresh を実行する。PR base / head、Global current revision、Context / Global file revision、registered document URI、cache JSON が B に一致し、old A URI は stale、cache は A head を B として保持しないことを assert する。
- action: なし。source severity Medium を保持して closed。

### `T406-R004` — Medium — `open`

- location: `test/unit/t405-composition-regression.test.ts:730-845`
- impact: PR #52 / #53 の両方向 isolation を transaction ごとに証明できず、PR #52 unmark が PR #53 state / history owner を汚染する regression と、各 later transaction の誤 owner history を検出できない。
- evidence: PR #53 mark 後の PR #52 不変と、その batch の history owner は exact に検証する。PR #52 mark 後の PR #53 不変も検証する。しかし PR #52 unmark 後、PR #53 を読み出して不変確認する前に PR #53 も unmark しており、後続操作が contamination を覆い隠せる。history は最初の PR #53 mark batch 以外、全体配列に PR #52 / #53 が含まれることだけを確認し、各 mark / unmark transaction の owner を固定しない。restart comparison はこの欠落を補わない。
- action: PR #52 mark、PR #52 unmark、PR #53 mark、PR #53 unmark の各 transaction 前後で history checkpoint を取り、追加 event が対象 context ID のみであることを assert する。各 transaction 直後、次の sibling operation より前に sibling の original / modified ranges と metadata が不変であることを assert し、同じ reviewer が R004 だけを再確認する。

### `T406-R005` — Low — `closed`

- location: `tasks/tasks-status.md:10-17,340,386`、`tasks/phases-status.md:40,139`、`README.md:26,58-59`、`handoffs/issue-70-t406-review-followup-20260820092341.yaml:1-8`
- impact: restart / handoff が PR lifecycle と次工程を誤認する source risk は解消した。
- evidence: tracking、README、handoff は PR #71 draft / open、通常 review fail、R001〜R005 follow-up、same-reviewer closure 待ち、main 統合前を一貫して記録する。一度の外部観測でも PR #71 は draft / OPEN、head OID は reviewed fix HEAD と一致した。
- action: なし。source severity Low を保持して closed。

severity reclassification は行っていない。closure は R002 / R003 / R005 の3件、open は R001 / R004 の2件である。新規 finding は追加していない。

## 結果

- verdict: `fail`
- finding closure: R001 `open`、R002 `closed`、R003 `closed`、R004 `open`、R005 `closed`。
- required coverage disposition:
  - source finding identity / severity / required action: 5 / 5 checked、reclassification なし。
  - fix range / direct impact: 12 / 12 files を finding との関係に限定して checked。R001 / R004 は `checked_open`、R002 / R003 / R005 は `checked_closed`。
  - supplied Red / Green / local validation: checked。実行 report と test body を突合し、reviewer rerun なし。
  - API / data / cache / config / workflow / compatibility / error / security / privacy: finding に直接関係する範囲を checked。R001 selection persistence は open、R002 privacy-safe diagnostic と R003 cache identity は closed、R004 PR isolation は open、R005 workflow tracking は closed。
  - tests / CI wiring: finding に直接関係する test body は checked。exact-head CI は in progress のため held。
  - fresh review / new perspective / new finding: intentionally not performed。
- unexplored: なし。finding限定 scope の全5件と direct impact に disposition を付けた。
- independent final review: 進行不可。R001 / R004 の follow-up と同じ normal reviewer による finding限定再 verification が先である。全5件 closed かつ exact-head CI 成功後にのみ independent final review へ進める。

## リスク

- `H406-C001` — exact-head CI は唯一の観測時点で pull_request / push の2 run とも `in_progress`。GitHub Actions 完了状態は held であり、本 report は成功を証明しない。
- `H406-C002` — Markdown wording lint は repository-local `tools/lint/`、focused wiring、`lint:md` がなく `unsupported`。本 closure report の focused / full Markdown gate は held。
- `H406-C003` — source / follow-up report が保持する既存 dependency audit high severity 4件は lockfile が fix range で変わらず本 closure scope 外。既存 security backlog / release gate に held。
- R001 の sentinel preservation と required production matrix、R004 の各 transaction 単位 isolation / history ownership が未 closure のため、技術 verdict を `pass_with_held` にはできない。
- repository status は report 記入前後とも task branch tracking clean に加え、本予約 report だけが untracked。implementation、tracking、GitHub state は変更していない。
