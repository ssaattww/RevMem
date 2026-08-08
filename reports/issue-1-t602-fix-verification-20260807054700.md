# T602 修正確認レポート（再レビュー）

## メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: #49
- Review mode: fix verification
- Reviewer continuity: 前回normal reviewerと同一ChatGPT chat
- Base: `main` (`112198c33823a5fc6681399a19e0c5361614143f`)
- Previous reviewed implementation HEAD: `0108703fa9e7ab3e2aa8d8ef32e2288a4de155fe`
- Reviewed implementation HEAD: `77d25c9da0e554e7ceec10ab3bc585bcb6bccfe7`
- Fix range: `0108703fa9e7ab3e2aa8d8ef32e2288a4de155fe..77d25c9da0e554e7ceec10ab3bc585bcb6bccfe7`
- Pre-review PR HEAD: `015411655ac5fc70356a7da4e77c74d51521682c`
- Verdict: **fail**
- Merge performed: No

ZIP内の `chat-review-worker`、`work-context-manager`、`review-worker`、`chat-report-writer`、`chat-handoff-manager` を再確認し、前回残存finding `T602-R010`、`T602-R011`、`T602-R003` のfix verificationと、今回のfix差分のsibling caseを確認した。

`77d25c...` 以降、pre-review PR HEAD `015411...` までの2 commitは `reports/issue-1-t602-review-followup-20260807054400.md` と `reports/issue-1-t602-implementation-handoff-20260807054400.yaml` のみで、product/test実装変更はない。そのため技術レビュー対象は `77d25c...` とした。

## CI

Reviewed implementation HEAD `77d25c9da0e554e7ceec10ab3bc585bcb6bccfe7` に一致するpull-request workflow runは存在しない。

pre-review PR HEAD `015411655ac5fc70356a7da4e77c74d51521682c` に一致するrunも存在しない。

したがってbuild、typecheck、architecture、lint、unit、T602 focused、Git/GitHub integration、VS Code Extension Hostは**未実施 / unavailable**として扱う。別SHAのrunは代用していない。

## Finding dispositions

### T602-R001 — high — addressed

前回fix verificationでclosure済み。今回の差分で再発は確認しなかった。

### T602-R003 — medium — addressed（CI validationは別途unavailable）

新しいschema v3 implementation handoff `reports/issue-1-t602-implementation-handoff-20260807054400.yaml` が追加され、技術実装HEAD `77d25c9da0e554e7ceec10ab3bc585bcb6bccfe7`、fix range、finding disposition、exact-head CIが存在しない事実を明示している。旧handoffを最終証跡として誤用する問題は解消した。

CI run自体が存在しないためGreen validationは未確認だが、これは証跡の虚偽・stalenessではなくvalidation availabilityの問題として別途扱う。

### T602-R004 — high — addressed

前回fix verificationでclosure済み。今回の差分で再発は確認しなかった。

### T602-R005 — high — addressed

前回fix verificationでclosure済み。今回の差分で再発は確認しなかった。

### T602-R006 — high — addressed

前回fix verificationでclosure済み。今回の差分で再発は確認しなかった。

### T602-R007 — high — addressed

前回fix verificationでclosure済み。今回の差分で再発は確認しなかった。

### T602-R008 — high — addressed

前回fix verificationでclosure済み。今回の差分で再発は確認しなかった。

### T602-R009 — high — addressed

前回fix verificationでclosure済み。今回の差分で再発は確認しなかった。

### T602-R010 — high — **not addressed**

- Origin: introduced_by_fix
- Location: `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`, `open`, `readProvenContent`, `enqueueSnapshotCommit`
- Description: open-time `replaceSnapshots` 自体はqueueへ移されたが、古いsession stateを取得した後の `readProvenContent(...)` はqueue外でawaitされる。古いopenがこのimmutable readで遅延している間に、既存sessionの新しいcommitがqueueへ入り、永続状態とlatest snapshotを新状態へ進められる。その後、遅延openのreadが完了すると、古い `session.contextState/globalState` を持つpublicationが**後からqueueへ追加**され、新しいlatest pointerを古いreview stateへ巻き戻せる。
- Impact: explicit unreview後にも古いreviewed rangesをlatest snapshotへ再発行でき、次回rebase/force-push recoveryで解除済み範囲を確認済みとして復元し得る。T602の保守性要件とR010の本来の世代競合問題が残る。
- Evidence:
  - `open()` は `const content = await this.readProvenContent(...)` の完了後に初めて `enqueueSnapshotCommit(...)` を呼ぶ。
  - 追加されたrace testは `saveLatest` をqueue内で遅延させ、古いopen publicationを先にqueueへ入れた後、新commitを後続queueへ入れる順序だけを検証する。この順序ではqueueが正しく保護するが、`readProvenContent`遅延により**新commitが先にenqueue/完了し、古いopenが後着enqueueする順序**を検証していない。
- Required action: snapshot publication requestの世代/expected persisted stateを取得時点から保護する。例として、openのstate取得からpublicationまでを同じgeneration tokenで検証し、publication直前にrepository current stateまたはmonotonic generationと一致しない古いopenをdiscardする。単純にimmutable readをqueue内へ移すだけでも全体queueの長時間占有・別file阻害を招くため、少なくとも同一coordinates単位のgeneration validationを設けること。`readProvenContent`を意図的に遅延させ、newer unreview commitを先に完了させた後にstale openを後着させる回帰testを追加する。

### T602-R011 — high — addressed

copy判定はraw oldPath equalityから、parsed file sectionと対応するraw sectionの`copy from` / `copy to` metadata存在判定へ変更された。quoted、space、tab、octal escaped UTF-8 pathの回帰testも追加され、以前のquoted path bypassは解消した。

## 新規変更範囲の追加確認

R010/R011 fix差分、追加runtime test、更新implementation handoffを確認した。R010以外に独立した新規required findingは確認しなかった。

ただしexact-head CIが存在しないため、TypeScript compile、lint、全unit/integration/VS Code testsの実行結果は未確認である。

## Coverage

| Criterion | Disposition | Evidence |
| --- | --- | --- |
| Requirement/design conformance | checked_finding | R010のstale evidence publicationが残存 |
| Correctness/edge cases | checked_finding | enqueue前immutable-read delayによるreverse arrival order |
| Scope discipline | checked_no_finding | fix差分はR010/R011/R003範囲内 |
| Changed files/direct dependencies | checked_finding | provider、recovery adapter、runtime/copy tests、handoffを確認 |
| API/data/config/workflow compatibility | checked_finding | snapshot latest generationのorderingに残存問題 |
| Error handling/failure diagnostics | checked_no_finding | 今回のfixで新規fatal分類問題なし |
| Security/secret handling | not_applicable | secret/token処理変更なし |
| Tests/validation adequacy | checked_finding | R010の後着enqueue順序testが欠落 |
| Current-HEAD CI evidence | unexplored | exact-head runなし |
| Reports/tracking/documentation accuracy | checked_no_finding | updated handoffはcurrent technical HEADとCI unavailableを正しく記録 |
| Regression/maintainability risk | checked_finding | queue投入前の非同期処理でgeneration順序が保証されない |

## Held / unexplored

- Held: なし
- Unexplored: reviewed implementation HEADに一致するCI runが存在しないため、自動build/test結果。

## Verdict

**fail**。

`T602-R011` と `T602-R003` はclosureできたが、`T602-R010` highが同一欠陥クラスの別arrival orderで残存している。さらにexact-head CIは未実施扱いである。

## 次のaction

1. `T602-R010`についてqueue投入前に古いopenがstale化する経路を閉じる。
2. `readProvenContent`を遅延させ、newer commitを先に完了させてからstale open publicationを後着させるtestを追加する。
3. 修正後の新しいimplementation HEADに一致するCIだけを確認する。
4. 同じnormal review chatでfix verificationを継続する。
5. mergeは利用者が行う。
