# T605 independent finding closure report

## タスク

- T605 / Issue #74 / draft PR #75 の independent final review で記録した T605-IFR-001〜003について、同一 independent reviewer（`sol` / high）として finding-limited closure を実施した。
- original independent reviewed HEAD: `e5eb2caa851e7bf2439257e42ff883bbfcbf12cf`
- reviewed fix HEAD: `2c685e6fabf2f8ee70f43627206099551070f4d9`
- 照合 range: `e5eb2caa851e7bf2439257e42ff883bbfcbf12cf...2c685e6fabf2f8ee70f43627206099551070f4d9`
- ローカル HEAD と PR #75 head は、照合時点で reviewed fix HEAD に一致した。

## sub-agentを使う理由

- finding-limited closure は同一 reviewer が一括して行う必要があり、sub-agent の使用は禁止されていたため使用していない。

## 対象範囲

- original independent final review report と follow-up report を基準に、次の既存 finding の required action だけを read-only で照合した。
  - T605-IFR-001: active-root / generation による stale・in-flight・remove/re-add 拒否。
  - T605-IFR-002: production descriptor と Current Context における shared URI eligibility と production composition regression。
  - T605-IFR-003: master design/history の整合、workspace owner 間の non-mixing regression、T605 focused wiring。
- fix delta の該当 production code、直接テスト、設計、package wiring、follow-up evidence を確認した。
- 提供済み evidence として `test:t605` 67 passing、build（compile:test を含む）、typecheck、lint、architecture positive/negative、diff-check の成功記録を評価した。これらのコマンドは再実行していない。
- criterion disposition は本レポートの「結果」で全件処分し、`unexplored: none` とした。

## 対象外

- 新規観点、新規 finding、severity 変更、sibling exploration、full-scope review、normal reviewは実施していない。
- implementation、自動修正、commit、push、merge、GitHub/PR/Issue/code/tracking/branch の変更は実施していない。
- test、build、lint、CI の再実行、CI の起動または待機は実施していない。
- Markdown 検査は repository-supported command が存在しないため held とし、代替 checker の導入や設定変更は行っていない。

## 実行コマンド

- `git rev-parse HEAD`
- `git status --short --branch`
- `git diff --name-status e5eb2caa851e7bf2439257e42ff883bbfcbf12cf...2c685e6fabf2f8ee70f43627206099551070f4d9`
- `git diff e5eb2caa851e7bf2439257e42ff883bbfcbf12cf...2c685e6fabf2f8ee70f43627206099551070f4d9 -- <finding-relevant paths>`
- `git show` / `git log` による original report、fix commit、reviewed ancestry の read-only 確認。
- `gh pr view 75 --repo ssaattww/RevMem --json ...` による PR head/state の read-only 確認。CI は待機していない。
- `Get-Content` と `rg` による report、source、test、design、package wiring の限定照合。
- 検証コマンドは提供済み evidence の評価だけとし、再実行していない。

## 対象ファイル

- `reports/issue-74-t605-independent-final-review-20260820221041.md`
- `reports/issue-74-t605-independent-review-followup-20260820222155.md`
- `handoffs/issue-74-t605-independent-review-followup-20260820222155.yaml`
- `src/adapters/workspace-review-state/workspace-root-runtime-registry.ts`
- `src/adapters/document-review-state/document-review-state-session-provider.ts`
- `src/t305-extension.ts`
- `test/unit/t605-multi-root-remote-boundaries.test.ts`
- `test/unit/review-history-jsonl-store.test.ts`
- `doc/design/vscode-review-range-tracker-design.md`
- `package.json`
- 上記 finding と提供済み evidence の記録に直接関係する fix delta 内 report / tracking 差分。

## 指摘事項

### T605-IFR-001 — Open（Medium、severity 維持）

- Evidence: `WorkspaceRootRuntimeRegistry` は削除時に `activeGenerations` の entry を削除し、再追加時に generation を再び `1` で初期化する。したがって remove 前に取得した generation `1` と remove/re-add 後の generation `1` を `assertCurrent` が区別できない。追加されたテストも active root の事前 reconcile と root B の追加を確認する内容であり、遅延中の open/load/commit を remove/re-add したときに拒否する regression を含まない。
- Impact: remove 前の stale/in-flight session が同じ root の再追加後に current と誤認され、状態または snapshot commit を新しい root lifecycle へ反映できる。
- Required action: root key ごとの generation を remove/re-add をまたいで単調に更新または tombstone として保持し、stale runtime/session が再利用されないようにする。遅延 open/load/commit と remove/re-add を組み合わせ、古い処理が拒否される production-path regression を追加する。

### T605-IFR-002 — Open（Medium、severity 維持）

- Evidence: descriptor validation と Current Context の workspace/editor filtering には filesystem-like scheme と query/fragment の検査が追加されたが、両 production path は共通 eligibility primitive を使わず同じ規則を別々に保持している。また fix delta のテスト追加は runtime registry の active-root 設定に限定され、Git acquisition の suffix-bearing URI、virtual workspace、untitled document、outside-workspace document を production composition で fail-closed にする regression は追加されていない。
- Impact: production consumers 間で URI eligibility が将来ずれる余地が残り、Git/PR acquisition と Current Context が同一境界を fail-closed にすることを regression suite が保証しない。
- Required action: scheme/authority/query/fragment と workspace membership を一つの共有 eligibility rule から production descriptor と Current Context の双方へ適用し、Git acquisition suffix、virtual workspace、untitled、outside-workspace の各 production composition regression を追加する。

### T605-IFR-003 — Open（Medium、severity 維持）

- Evidence: master design の history path は root-scoped contract に更新され、`test:t605` に history suite が追加され、既存 test の path assertion も `workspaces/<workspace-id>/history` へ更新された。しかし history test は単一 workspace owner と external owner を扱うだけで、同一 repository の異なる workspace root owner 間で履歴が混在しないことを検証していない。
- Impact: focused suite の wiring と path contract は改善したが、same repository を複数 root で開いた場合の owner-separated history という required behavior の regression protection がない。
- Required action: 異なる workspace root owner（same repository の複数 root を含む）へ履歴を書き込み、各 owner の load/append/compaction 結果が混在しないことを明示的に検証する focused regression を追加する。

## 結果

- Technical verdict: **fail**
- Required findings: **3 open / 0 closed**

| Criterion | Disposition | 根拠 |
| --- | --- | --- |
| T605-IFR-001 required action | fail / open | generation が remove/re-add で再利用され、stale/in-flight/re-add regression もない。 |
| T605-IFR-002 required action | fail / open | production checks は追加されたが shared rule と指定された production composition regressions がない。 |
| T605-IFR-003 required action | fail / open | design、path assertion、focused wiring は更新されたが workspace owner 間 non-mixing regression がない。 |
| Provided `test:t605` evidence | pass（evidence assessment） | 67 passing の記録を確認した。ただし上記 required scenarios を含まないため finding closure の根拠としては不足する。 |
| Provided build/typecheck/lint/architecture/diff-check evidence | pass（evidence assessment） | 成功記録を確認した。再実行していない。 |
| Markdown wording check | held | repository-supported command がない。 |
| Post-attestation exact-head PR CI merge gate | held | attestation 後の exact-head `pull_request` CI を merge gate として確認する段階で評価する。今回は起動・待機していない。 |
- `unexplored: none`
- `report_attestation_allowed: false`。technical verdict が fail かつ required finding が3件残るため、attestation commit の条件判定には進まない。本レポートを即時 attestation として扱うことも許可しない。
- Report persistence mode: reserved repository report のみ。GitHub publication は行っていない。

## リスク

- T605-IFR-001〜003 の required action が未完了のため、PR #75 は independent closure gate を通過していない。
- Held は、repository-supported Markdown check が存在しないこと、および将来の有効な report attestation 後に exact-head `pull_request` CI merge gate を確認することの2件だけである。
- 本判断は finding-limited closure に限定される。新しい scope や sibling behavior に関する結論は追加しておらず、`unexplored` は none である。
