# T605 independent finding closure R2 report

## タスク

- T605 / Issue #74 / draft PR #75 の independent finding T605-IFR-001〜003について、同一 independent reviewer（`sol` / high）として finding-limited closure R2 を実施した。
- 前回 closure HEAD: `a38852e03c165a5aec91436352b058997262a31b`
- reviewed fix HEAD: `877af7146bf83b732831ed611090a3db4f2c1b3e`
- 照合 range: `a38852e03c165a5aec91436352b058997262a31b...877af7146bf83b732831ed611090a3db4f2c1b3e`
- reviewed fix commit の first parent は前回 closure HEAD と一致し、ローカル HEAD は reviewed fix HEAD と一致した。

## sub-agentを使う理由

- finding-limited closure は同一 reviewer が一括して行う必要があり、sub-agent の使用は禁止されていたため使用していない。

## 対象範囲

- 前回 closure report と R2 follow-up report を基準に、継続していた required action だけを read-only で照合した。
  - T605-IFR-001: monotonic/tombstone generation と、遅延 open/load/commit の remove/re-add 拒否および新 generation 成功 regression。
  - T605-IFR-002: descriptor と Current Context が実際に呼ぶ単一 shared typed URI eligibility、および suffix/virtual/untitled/outside の production regression。
  - T605-IFR-003: 実 `JsonlReviewHistoryStore` 操作による、same remote repository の異なる workspace root owner 間 non-mixing regression。公開 API が append-only であることを前提に、存在する操作範囲で判定した。
- 提供済み evidence として `test:t605` 70 passing、build（compile:test を含む）、typecheck、lint、architecture positive/negative、diff-check の成功記録を評価した。これらのコマンドは再実行していない。
- 3件の disposition をすべて確定し、`unexplored: none` とした。

## 対象外

- 新規観点、新規 finding、severity 変更、sibling exploration、full-scope review、fresh independent review、normal reviewは実施していない。
- implementation、自動修正、commit、push、merge、GitHub/PR/Issue/code/tracking/branch の変更は実施していない。
- test、build、lint、CI の再実行、CI の起動または待機は実施していない。
- Markdown 検査は repository-supported command が存在しないため held とし、代替 checker の導入や設定変更は行っていない。

## 実行コマンド

- `git rev-parse HEAD`
- `git status --short --branch`
- `git show -s --format=... 877af7146bf83b732831ed611090a3db4f2c1b3e`
- `git merge-base --is-ancestor 2c685e6fabf2f8ee70f43627206099551070f4d9 877af7146bf83b732831ed611090a3db4f2c1b3e`
- `git diff --name-status a38852e03c165a5aec91436352b058997262a31b...877af7146bf83b732831ed611090a3db4f2c1b3e`
- `git diff a38852e03c165a5aec91436352b058997262a31b...877af7146bf83b732831ed611090a3db4f2c1b3e -- <finding-relevant paths>`
- `Get-Content`、`rg`、`Test-Path` による report、handoff、source、test、公開 history API、実在 path の限定照合。
- 検証コマンドは提供済み evidence の評価だけとし、再実行していない。

## 対象ファイル

- `reports/issue-74-t605-independent-finding-closure-20260820222815.md`
- `reports/issue-74-t605-independent-review-followup-r2-20260820223327.md`
- `handoffs/issue-74-t605-independent-review-followup-r2-20260820223327.yaml`
- `src/adapters/workspace-review-state/workspace-root-runtime-registry.ts`
- `src/application/workspace-identity/workspace-identity-service.ts`
- `src/application/workspace-identity/index.ts`
- `src/adapters/document-review-state/document-review-state-session-provider.ts`
- `src/adapters/document-review-state/persisted-document-review-state-session-provider.ts`
- `src/t305-extension.ts`
- `src/adapters/state-repository/jsonl-review-history-store.ts`
- `test/unit/t605-multi-root-remote-boundaries.test.ts`
- `test/unit/review-history-jsonl-store.test.ts`

## 指摘事項

### T605-IFR-001 — Closed（Medium、severity 維持）

- Evidence: `WorkspaceRootRuntimeRegistry` は active entry と別に `knownGenerations` tombstone を保持し、root が inactive から active になるたびに既知 generation を単調増加させる。remove は active generation と runtime だけを破棄するため、remove/re-add 後の `assertCurrent` は旧 selection を拒否する。production registry regression は旧 generation の遅延 open/load/commit を並行して開始し、remove/re-add 後に全3件が reject されること、旧 commit callback が publish しないこと、新 generation の open が新 runtime で成功することを検証する。
- Impact resolution: remove 前の stale/in-flight session が再追加後の root lifecycle へ結果または commit を反映できないことが、実装と focused regression の双方で確認できた。
- Required action disposition: fulfilled。finding を closed とする。

### T605-IFR-002 — Closed（Medium、severity 維持）

- Evidence: exported typed primitive `resolveWorkspaceResourceEligibility` が scheme、authority、query/fragment、longest workspace membership を一箇所で fail-closed に解決する。production descriptor validation はこの primitive を Git/persistence acquisition 前に呼び、outer persisted provider も open/load の入口で同 validation を呼ぶ。Current Context の workspace folder と visible editor filtering も同じ primitive を Git inspection 前に呼ぶ。production export の `DocumentReviewStateSessionProvider` を使う regression は suffix-bearing URI、virtual URI、untitled URI、outside-workspace URI を渡し、Git inspector に到達する前の rejection を検証する。
- Impact resolution: descriptor routing と Current Context filtering の URI boundary が一つの typed rule に接続され、対象4境界の production fail-closed behavior が regression で保護された。
- Required action disposition: fulfilled。finding を closed とする。

### T605-IFR-003 — Closed（Medium、severity 維持）

- Evidence: regression は同じ `vscode-remote` authority の同一 repository 配下を表す2つの workspace root identity を生成し、実 `JsonlReviewHistoryStore.append` で各 owner の event を保存する。root-scoped route が異なる history file を選ぶことと、各 file が自 owner の event だけを含み他 owner の event を含まないことを実データで検証する。`JsonlReviewHistoryStore` の公開 contract は append-only であり、存在しない load/compaction API は closure 条件に追加していない。
- Impact resolution: same repository の複数 workspace root owner が history storage で非混線となることを、利用可能な実 adapter 操作と永続化結果で確認できた。
- Required action disposition: fulfilled。finding を closed とする。

## 結果

- Technical verdict: **pass_with_held**
- Required findings: **0 open / 3 closed**

| Criterion | Disposition | 根拠 |
| --- | --- | --- |
| T605-IFR-001 required action | pass / closed | tombstone generation、旧 open/load/commit 拒否、旧 publish 抑止、新 generation 成功を確認した。 |
| T605-IFR-002 required action | pass / closed | shared typed eligibility が descriptor と Current Context の実経路で使われ、4種の production rejection regression がある。 |
| T605-IFR-003 required action | pass / closed | 実 JSONL append と永続化結果で異なる workspace owner の history non-mixing を確認した。 |
| Provided `test:t605` evidence | pass（evidence assessment） | compile:test を含む70 passing の記録が3件の focused regressions を含むことを確認した。再実行していない。 |
| Provided build/typecheck/lint/architecture/diff-check evidence | pass（evidence assessment） | 成功記録を確認した。再実行していない。 |
| Markdown wording check | held | repository-supported command がない。 |
| Post-attestation exact-head PR CI merge gate | held | 有効な attestation 後の exact-head `pull_request` CI を merge gate として確認する。今回は起動・待機していない。 |
- `unexplored: none`
- `report_attestation_allowed: true`。許可条件は、reviewed fix HEAD `877af7146bf83b732831ed611090a3db4f2c1b3e` の直後に作る単一 commit であること、first parent が同 HEAD と一致すること、本レポートだけを含み他 path を含まないこと、その後に non-attestation commit が存在しないこと。条件を満たさない commit は attestation として無効である。
- Report persistence mode: reserved repository report。GitHub publication は行っていない。

## リスク

- T605-IFR-001〜003 の required action は全件 closed であり、finding-limited technical gate は通過した。
- Held は、repository-supported Markdown check が存在しないこと、および有効な report attestation 後に exact-head `pull_request` CI merge gate を確認することの2件だけである。
- 本判断は finding-limited closure R2 に限定される。新しい scope や sibling behavior に関する結論は追加しておらず、`unexplored` は none である。
