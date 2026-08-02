# T601 独立 finding closure verification レポート

## Metadata

- repository: `ssaattww/RevMem`
- Pull Request: `#33`
- task: `T601`
- review mode: same independent reviewer / closure-only fix verification
- reviewer: independent reviewer 2/2（`/root/pr33_independent`）
- source reviewed implementation HEAD: `52850f596387ed8ac80ea157fc997ee22ad8fd16`
- reviewed closure fix HEAD: `9d9491509a1c6bb50baaaef2f3877ec4ac370612`
- base SHA: `a738019d5f42a0b976dbed9ee59634243ad5c245`
- source independent report: `reports/issue-1-t601-independent-final-review-20260802093000.md`
- follow-up report: `reports/issue-1-t601-independent-review-followup-20260802154500.md`
- reserved report path: `reports/issue-1-t601-independent-fix-verification-20260802163000.md`
- verdict: `fail`
- report_attestation_allowed: `false`

Technical verdict は上記 reviewed closure fix HEAD にだけ適用する。

## Scope and boundary

対象は既存 finding `T601-IFR-001` から `T601-IFR-006` の required action closure だけである。新規 review 観点、新規 finding、severity reclassification、広域 review、通常 review の再実行は行っていない。通常 review はユーザー指定および follow-up evidence のとおり完了済みとして扱った。

実装、test、tracking、design、workflow、他 report、handoff は変更せず、本予約 report だけを更新した。commit、push、PR comment、merge は行っていない。Issue #28 と T607 所有の大規模文書 LCS performance は既存 held のまま変更していない。

## Finding disposition

| Finding | Source severity | Disposition |
| --- | --- | --- |
| `T601-IFR-001` | High | closed |
| `T601-IFR-002` | High | closed |
| `T601-IFR-003` | High | open |
| `T601-IFR-004` | High | closed |
| `T601-IFR-005` | Medium | closed |
| `T601-IFR-006` | Medium | closed |

### T601-IFR-003 — High — open

- source required action: workspace/file ごとの authoritative latest generation だけを読み、latest が missing、corrupt、expired の場合は古い review evidence へ fallback せず未確認化する。save failure after unmark と retention cleanup を含む provider-level sibling test を追加する。
- addressed portion: `commitWithSnapshot()` は state commit 前に latest pointer を無効化し、commit 後に replacement generation を publish する。save failure after unmark の focused test は pointer が空のままになり、解除済み range を復活させないことを証明する。lookup も過去 entry を走査せず、単一 pointer だけを読む。
- still-open behavior: `SnapshotTrackingWorkspaceReviewStateSessionProvider.loadForDecoration()` は pointer が missing の場合に `base` をそのまま返し、latest の map 結果が corrupt、expired、または reviewed range なしの場合にも `base` をそのまま返す。`base` の content hash が現在内容と一致していれば、保存済みの確認済み range は除去されない。
- command/open path も同じである。latest が missing または map 不成立でも `super.open()` の current reviewed stateを保持し、そのまま `saveCurrentSnapshot()` で新しい authoritative generation として再 publish する。このため required action の「missing/corrupt/expired latest は未確認」が成立しない。
- reviewer counterexample: exact-head compiled artifact で同一内容の2行を確認済みにした後、(1) latest pointer を削除、(2) latest bytes を破損、(3) retention を超過、の3 sibling をそれぞれ作り `loadForDecoration()` を実行した。3ケースすべてで actual は `[{"startLine":0,"endLineExclusive":2}]`、expected は `[]` だった。
- existing test gap: `non-git-snapshot-tracker.test.ts` は指定 snapshot ID の direct `map()` が missing/corrupt/expired を返すことだけを確認する。provider の `base` fallback と open 時の再 publish は通らない。これは source IFR-003 が要求した provider-level sibling coverage の未完了であり、新規 finding ではない。
- required closure: pointer missing または latest map が missing/corrupt/expired の場合、current file の Context/Global reviewed evidence を read/open path の両方で fail closed にする。3 sibling を provider 経由で追加し、open が stale reviewed state を新 generation として再 publish しないことも固定する。
- severity: source `High` を維持する。reclassification なし。

## Closed finding evidence

- `T601-IFR-001`: Node codec/filesystem storage adapter、local extension snapshot route、composition root injection、normal command/decorations、durable adapter restart、provider restart、Extension Host の confirm/restart/unmark/restart 経路を確認した。
- `T601-IFR-002`: mapping evidence は CRLF、LF、CR、terminal newline、empty content を区別し、focused sibling が変更行を未確認化する。
- `T601-IFR-004`: merge base、PR base OID、`origin/main` は `a738019d5f42a0b976dbed9ee59634243ad5c245` で一致する。PR は `MERGEABLE` / `CLEAN`。`package.json` は T207 と T601 の unit/focused wiring を両方保持する。
- `T601-IFR-005`: `tasks/tasks-status.md` は PR #33/T601 を current/in-progress とし、T601 row と report references を同期する。`tasks/phases-status.md` は P6/T601 を in progress とし、残工程を既存 finding closure と CI に限定する。通常 review はユーザー指定どおり完了済みで再実行していない。
- `T601-IFR-006`: application は runtime-neutral codec/storage port と use case だけを所有する。Node crypto/zlib/Buffer/filesystem は adapter へ移り、architecture positive gate と application Node import negative fixture が機能する。

## Validation and identity evidence

- local HEAD、PR head OID、CI head SHA: `9d9491509a1c6bb50baaaef2f3877ec4ac370612` で一致。
- PR #33: base `main` / `a738019d5f42a0b976dbed9ee59634243ad5c245`、`MERGEABLE`、`CLEAN`。
- exact-head GitHub Actions: run `30725086235`、status=`completed`、conclusion=`success`。build、contract typecheck、architecture positive/negative、lint、unit、Git integration、GitHub mock、VS Code Extension Host の全 configured gate が成功した。
- reviewer focused run: `npm run test:t601` は 15/15 success。ただし上記 provider-level counterexample は既存15 testの未被覆経路である。
- reviewer architecture runs: `npm run validate:architecture` は success。`npm run validate:architecture:negative` は期待11 violation一致で success。
- follow-up evidence: compile、lint、contract typecheck、T601 15、T206/T207/T302/T303/T501 focused、architecture positive/negative、Extension Host は success。通常 review は完了済み。
- `git diff --check`: success。
- Markdown focused/full lint: repository-local `tools/lint/` と `lint:md` wiring がないため `unsupported`。本 report の末尾空白と予約文言は直接確認する。

## Verdict

- verdict: `fail`。
- required/open finding: `T601-IFR-003` High のみ。
- closed findings: `T601-IFR-001`、`T601-IFR-002`、`T601-IFR-004`、`T601-IFR-005`、`T601-IFR-006`。
- unexplored: closure 対象6 findingに必須項目なし。closure boundary 外の新規観点は追加していない。
- held/non-blocking: Issue #28 の Windows POSIX/temporary-directory portability と、T607 所有の大規模文書 LCS performance。
- `report_attestation_allowed: false`。既存 required finding が残るため administrative attestation commit、squash merge 準備へ進めない。
- next action: `T601-IFR-003` の missing/corrupt/expired provider-level fail-closed behavior だけを修正し、同じ finding identity/severity を維持した focused verification と新しい exact-head CI を実施する。その後、同じ独立 reviewer が IFR-003 closure だけを再確認する。
- merge boundary: 本 verification は commit、push、PR comment、merge、release を実行しない。
