# T405 レビュー指摘対応レポート

## Metadata

- report type: `review_followup_report`
- repository: `ssaattww/RevMem`
- task: `T405`
- pull request: `#54 T405 Review Contexts ViewとPRコンテキスト操作を実装`
- branch: `feature/t405-review-contexts`
- base ref: `main`
- source review report: `reports/2026-08-16-t405-review.md`
- source review handoff: `handoffs/issue-1-t405-review-20260816152300.yaml`
- reviewed implementation HEAD: `b0ee79dc84e27363b805bd6ffa440bfb9b351f72`
- validated technical HEAD: `47d032b20fe5e0563254b960ad7bfd012e7f8863`
- exact-head validation run: `31941214324`
- merge boundary: merge は実施しない。利用者が merge する。

## 結果

通常レビューで指摘された `R405-1`〜`R405-9` を実装・回帰テスト・文書へ反映した。技術変更を含む HEAD `47d032b20fe5e0563254b960ad7bfd012e7f8863` に完全一致する GitHub Actions CI run `31941214324` は全 step `success` となった。

この follow-up では、既存の PR Review State / Current Context / canonical review diff / PR progress の各 contract を再利用し、T405 が独自経路で状態・diff・進捗を持たないよう production composition を修正した。

## 作業開始時の診断 artifact workflow 確認

`.github/workflows/ci.yml` を作業開始時に確認した。既に以下を保存する失敗診断 workflow が存在していたため、診断目的だけの追加変更は不要と判断した。

- 各 npm/test command の標準出力・標準エラーを `2>&1 | tee test-output/ci/*.log` へ保存
- failure 時に Node/npm/runner/SHA/ref を `environment.txt` へ保存
- `git status` と生成ファイル一覧を保存
- `test-output/`, `dist/`, `test-dist/`, `src/`, `test/`, `tools/`, `type-fixtures/`, manifest/tsconfig/eslint/workflow を failure artifact へ upload

本 follow-up で T405 固有回帰 suite を CI へ接続し、そのログも `test-output/ci/test-t405.log` として同じ診断 artifact contract に含めた。

## TDD / regression evidence

レビュー指摘の再現 test は実装修正より先に branch 上へ追加されていた。代表的な Red/focused test commits は以下。

- `20ce97a...` — review findings の再現 test
- `710e809...` — lifecycle / canonical diff findings の再現 test
- `2c95045...` — persisted current PR inference test
- `0dfdd646...` — immutable revision evidence test
- `94d2441...` — current context hide regression test
- `0a27579...` — selected PR normal-editor ownership test
- `db7323b...` — PR context identity test

その後、production composition 修正を積み、`package.json` に `test:t405` を追加して以下の suite を一括実行するようにした。

- `review-contexts-runtime-wiring`
- `review-contexts-storage`
- `review-contexts-ui`
- `t405-github-lifecycle`
- `t405-pull-request-review-runtime`
- `t405-review-followup`
- `t405-revision-evidence`
- `t405-selected-pr-session`

CI の `T405 Review Contexts follow-up tests` step も追加し、technical HEAD の run `31941214324` で成功を確認した。

## Findings disposition

| Finding | Severity | Disposition | 主な対応 |
| --- | --- | --- | --- |
| R405-1 | Medium | addressed | base/head revision 更新を T404 の immutable revision evidence / mapping 経路へ接続し、同じ PR context を継続するよう修正。revision evidence regression test を追加。 |
| R405-2 | Medium | addressed | 保存済み PR identity から lifecycle を取得し、open→closed/merged を永続 state へ同期する経路を追加。lifecycle test を追加。 |
| R405-3 | Medium | addressed | Review Contexts 起点の PR diff を T302/T303 の canonical review diff runtime へ統合。original/modified side、review command、state/progress を共有。 |
| R405-4 | Medium | addressed | hidden presentation identity を current/saved の双方へ適用し、current context の hide が no-op にならないよう修正。 |
| R405-5 | Medium | addressed | Review Contexts の PR item に canonical PR review progress を投影する production 経路を接続。 |
| R405-6 | Low | addressed | runtime が参照しない `reviewRange.closedPullRequestLayerDefault` を manifest から削除。旧 test も現仕様へ整合。 |
| R405-7 | High | addressed | 保存済み・選択済み PR を Current Context candidate / normal-editor session ownership へ接続。通常 editor の確認操作・装飾が選択 PR state を利用可能にした。 |
| R405-8 | Medium | addressed | current PR を一時 in-memory state 先行で公開せず、永続 PR state と exact HEAD から導出する形へ変更。rediscovery は persistence 成功後に refresh/publication する。 |
| R405-9 | Low | addressed | README を T405 production runtime の接続状態、Review Contexts 操作、canonical PR diff、残る T406/T506 境界へ更新。 |

Severity は元レビューから変更していない。

## Follow-up commits

レビュー後に branch へ追加された主要な実装・test commit に加え、この対応セッションでは以下を追加した。

- `0e8f1dbf1212e43061ccf045aaaae982a0cfbb37` — VS Code diff command の `Thenable<void>` を await して Promise contract を満たす
- `13e8ecc151cb17ebf25c827c3903be20e69ec54a` — dead setting 削除と `test:t405` suite 配線
- `8912e942aeca3015c0ff77861abccc7ebe9976fa` — CI に T405 follow-up regression step を追加
- `36c790fabe73e59f3c64fcc3015b079fe13322e1` — README を T405 接続状態へ更新
- `2a1e13c8229f158cad755d8d8332b20ec418a5ee` — T405 runtime wiring の lint/初期化順を修正
- `9e058f1cc7d2b974532782d0c92ff769c6e2453c` — unused import を削除
- `f1e255ca8ec3ab8dd03f3187900543859ea15861` — selected PR test repository の readonly serialization fixture を修正
- `47d032b20fe5e0563254b960ad7bfd012e7f8863` — 旧 manifest wiring test を dead setting 削除後の contract へ整合

## Exact-head CI and failure diagnostics

別 SHA の workflow run は代用していない。各失敗は、その時点の PR HEAD と run `head_sha` が一致するものだけを調査した。

| HEAD | Run | Result | Failure / evidence | Artifact |
| --- | --- | --- | --- | --- |
| `1c8575c95ddca44e43a3824c60ecba4427a42dbb` | `31934416515` | failure | Build: `src/t305-extension.ts` の VS Code `Thenable<void>` → `Promise<void>` 型不一致 | `9260222592` |
| `36c790fabe73e59f3c64fcc3015b079fe13322e1` | `31940274843` | failure | Lint: `prefer-const` 3件 + unused arg 1件 | `9261822712` |
| `2a1e13c8229f158cad755d8d8332b20ec418a5ee` | `31940813360` | failure | Lint: unused `RegisteredCurrentContextRuntime` import | `9261958025` |
| `9e058f1cc7d2b974532782d0c92ff769c6e2453c` | `31940956674` | failure | `compile:test`: selected PR test fake が deep-readonly transaction を mutable commit へ generic clone していた型不整合 | `9262000710` |
| `f1e255ca8ec3ab8dd03f3187900543859ea15861` | `31941146886` | failure | Unit: 旧 T405 wiring test が削除済み dead setting の `default=false` を要求 | `9262053326` |
| `47d032b20fe5e0563254b960ad7bfd012e7f8863` | `31941214324` | **success** | Build/typecheck/architecture/Lint/Unit/T405/T304/T502-T505/Git/Mock GitHub/VS Code Extension Host 全成功 | failure artifact なし |

### Successful run `31941214324`

成功を確認した step:

- Install dependencies
- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T602 history rewrite recovery tests
- T403 GitHub cache tests
- T404 GitHub PR context layer tests
- **T405 Review Contexts follow-up tests**
- T304 PR progress tree tests
- T502 Global mapping and display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- T505 Global understanding tests
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

## Documentation / tracking

README は T405 の実装状態へ更新済み。

`tasks/tasks-status.md` / `tasks/phases-status.md` は repository instruction 上、task manager 系 Skill の所有範囲である。今回提供された worker Skill set には該当 manager Skill がないため、この follow-up では更新していない。これは実装未対応ではなく、tracking write-boundary による held item とする。

## Held / non-goals

以下は元レビューでも T405 の non-goal とされており、この follow-up では T405 の指摘対応へ拡張していない。

- `T406`: GitHub 未認証公開 repository、401/403/404/429、network 断、patch 欠落、複数 PR candidate、closed PR の end-to-end failure integration
- `T506`: 複数 context の変更追従と Global 集計の統合 / Extension Host validation
- `T604+`: cross-window lock、cleanup、総合 error policy 等
- merge

## Administrative finalization

この report と lossless handoff の repository 保存は technical HEAD `47d032b2...` の成功確認後に行うため、保存 commit により PR HEAD は進む。report/handoff 以外の product code を変更しない administrative HEAD についても、その新しい HEAD SHA に一致する CI run を別途確認し、結果は PR comment / PR metadata に記録する。別 SHA の成功 run は代用しない。
