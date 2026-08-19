# PR #69 Issue #67 finding 限定再レビュー

## メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: `#69`
- Issue: `#67`
- Review mode: fix verification
- Reviewer continuity: 初回通常レビューと同一 chat / reviewer
- Initial review report: `reports/issue-67-pr69-review-202608190844.md`
- Review follow-up report: `reports/issue-67-pr69-review-followup-202608190933.md`
- Initial reviewed implementation HEAD: `3e4e5cd4a0e63a2aad1d942f7c1dedaaba105097`
- Follow-up start HEAD: `71a4729adb51e9b508387f6b615c53d9405423ca`
- Reviewed fix implementation HEAD: `5b9c4ac13379d2980b90bdd8b097494b236f42cc`
- Base SHA: `7d4df08e6a55b40ecb1d0faf515005912274258d`
- Merge: 実施しない
- Verdict: `pass_with_held`

## Scope

初回通常レビューで発行した次の3 finding の closure verification のみを行った。全範囲 initial review は繰り返していないが、fix diff で新たに変更された sibling code と直接依存は、新規 defect 混入確認のため追跡した。

- `PR69-R001` High — Global file node の owner/revision identity と immutable PR HEAD open
- `PR69-R002` High — PR Progress `line-review-unsupported` file node の file open
- `PR69-R003` Low — Global file open 専用 error reporting

修正範囲 `71a4729adb51e9b508387f6b615c53d9405423ca..5b9c4ac13379d2980b90bdd8b097494b236f42cc` は7 commit、13 fileで、production code、behavioral regression tests、follow-up report/handoffから構成されることを確認した。

## Diagnostics workflow / TDD 確認

既存 `.github/workflows/ci.yml` は、各 CI command の出力を `test-output/` に保存し、失敗時に test output、stdout/stderr相当ログ、生成物、`src/`、`test/`、環境情報、Git状態、workflowを diagnostics artifact として保存するため、追加変更は不要である。

レビュー指摘対応は Red-first で行われている。

- Clean Red HEAD: `cc00ea5ce7f7765ccfec6c41a26becc8a0b1fcf3`
- exact-head pull_request CI: `32202551461`
- Result: `failure`
- Failure: `TS2339: Property 'openTarget' does not exist on type 'GlobalUnderstandingFileNode'.`
- Failure diagnostics artifact: `9348022545` / `ci-failure-diagnostics-32202551461-1`
- Artifact head SHA: `cc00ea5ce7f7765ccfec6c41a26becc8a0b1fcf3`

production実装前に、R001/R003用の新しい node open contract が存在しないことを clean Red で確認できている。途中の build / compatibility failure も follow-up report に記録され、別 SHA の run を成功証拠として代用していない。

## current-HEAD CI

レビュー対象 fix implementation HEAD と workflow run の `head_sha` が完全一致する run のみを採用した。

- Reviewed fix implementation HEAD: `5b9c4ac13379d2980b90bdd8b097494b236f42cc`
- Workflow run: `32204232884`
- Event: `pull_request`
- run `head_sha`: `5b9c4ac13379d2980b90bdd8b097494b236f42cc`
- Status: `completed`
- Conclusion: `success`

同 run で以下を含む全 step が成功している。

- Build
- Contract typecheck
- Architecture validation
- Architecture negative contract
- Lint
- Unit tests
- T602 history rewrite recovery tests
- T603 schema migration and corruption recovery tests
- T403 GitHub cache tests
- T404 GitHub PR context layer tests
- T405 Review Contexts follow-up tests
- T304 PR progress tree tests
- T502 Global mapping and display priority tests
- T503 repository enumeration tests
- T504 Global understanding tests
- T505 Global understanding tests
- T506 Global multi-context integration
- Temporary Git integration tests
- Mock GitHub integration tests
- VS Code Extension Host tests

## Finding closure

### PR69-R001 — High — closed

初回 finding の required action はすべて満たされている。

#### 実装修正

- `GlobalUnderstandingTreeSnapshot` / `GlobalUnderstandingFileNode` に snapshot-bound `openTarget` を導入した。
- target は repository ID、context ID、revision ID、canonical repository path を保持し、working-tree では生成時の concrete file path、PRでは exact HEAD content source identity を保持する。
- `T505GlobalUnderstandingSource.recalculate()` が Global progress を生成した同じ owner/revision から target を作るため、クリック時に mutable `currentContext` を再解決しない。
- `GlobalUnderstandingFileOpenController` が現在 model の node identity を保持し、clear/replacement 後の旧 node を stale として拒否する。
- Current Context の recompute / explicit accept では `globalRuntime.clear()` が新 Context の dependent refresh より前に実行される。
- PR target は `PullRequestReviewRuntime.createHeadFileDocumentUri()` を通り、registered HEAD と requested revision が不一致なら stale として拒否する。
- PR file は local working tree を代用せず canonical `review-range-diff` の exact `git-commit` HEAD document を開く。

#### Behavioral evidence

- repository A の Global snapshot target を生成後に source Context を repository B へ変更しても target が repository A の identity/path を保持する test がある。
- PR HEAD にだけ存在し local working tree にない added file の snapshot target が exact PR HEAD identity を保持する test がある。
- `createHeadFileDocumentUri()` から canonical virtual document を開き、content provider が exact HEAD / modified side を読む test がある。
- 同 Context を新 HEAD に再登録した後、旧 revision target が stale として拒否される test がある。
- controller clear 後の旧 Global node は file-open host へ到達しない test がある。

#### Assessment

初回 finding の原因であった「表示 node の path だけを mutable Current Context へ再解決する経路」は除去され、PR Global evidence と open content の revision source も一致した。`PR69-R001` は **closed**。

### PR69-R002 — High — closed

初回 finding の「line-reviewability と file-openability が混同されて silent no-op になる」問題は解消している。

#### 実装修正

- `PullRequestProgressTreeHost` に non-review `openFile` boundary を追加した。
- reviewable node は従来どおり canonical text diff を開く。
- `line-review-unsupported` node は `openFile()` を呼び、`opened-file` result を返す。
- unsupported node で text diff host は呼ばれない。
- stale node protection は従来どおり維持される。

#### Behavioral evidence

- `binary`
- `invalid-encoding`
- `unsupported-encoding`

上記3 reason をそれぞれ provider `select()` へ渡し、file host が1回呼ばれ text diff host が0回である unit test がある。

さらに VS Code Extension Host test では real command `reviewRange.openPrProgressItem` で binary node を選択し、対応する `binary.bin` が通常 file open host を通って開かれ、review diff は増えないことを確認している。reviewable text node の既存 diff open / mark / unmark も同一 acceptance suite で成功している。

`PR69-R002` は **closed**。

### PR69-R003 — Low — closed

Global refresh error と file-open error の reporting boundary は分離された。

- refresh error は従来の `reportError`。
- file-open error は `reportOpenError`。
- formatter は `Global のファイルを開けませんでした: <cause>` を生成する。
- stale target、missing target、host open failure は `GlobalUnderstandingFileOpenController` の open boundary から専用 reporter へ流れる。
- behavioral test で `permission denied` を open host から発生させ、専用 reporter と operation-specific message に到達することを確認している。

`PR69-R003` は **closed**。

## Fix diff regression assessment

修正で新たに変更された以下の領域を、finding の直接影響・sibling case として確認した。

- Global model の open target count/path consistency validation
- old snapshot compatibility（対象 file 0件では `fileOpenTargets` を省略）
- PR runtime の registered HEAD replacement / stale target behavior
- PR Progress reviewable / unsupported 分岐
- Local Base/Head Extension Host の binary normal-open path
- Current Context 切替時の Global presentation clear ordering
- dedicated error boundary と既存 refresh boundary の分離

上記に新規 required finding は検出しなかった。

## Held boundary

初回レビューの held を維持する。

- Remote SSH / Dev Containers / Codespaces の file-open 実機 behavior は、この fix verification で独立実行していない。
- README が multi-root / Remote 系の完全な統合・受け入れを `T605` 所管として明示している。
- 今回の fix は workspace folder URI を利用できる場合に scheme を保持するよう実装されているが、T605 の未完了範囲を本 PR だけで完了扱いにはしない。

owner: `T605`

この held は今回の3 finding の closure を妨げる required finding ではない。

## Coverage summary

| 観点 | disposition | 結果 |
| --- | --- | --- |
| PR69-R001 | closed | snapshot identity / stale / immutable PR HEAD / added-only を確認 |
| PR69-R002 | closed | binary / invalid / unsupported encoding と real binary command を確認 |
| PR69-R003 | closed | dedicated open reporter と error message を確認 |
| Fix diff sibling cases | checked_no_finding | 新規 required finding なし |
| TDD Red | checked_no_finding | clean Red exact SHA failure + diagnostics artifact 確認 |
| Current exact-head CI | checked_no_finding | `5b9c4ac...` / run `32204232884` success |
| Diagnostics workflow | checked_no_finding | 既存 artifact workflow で必要情報を保存 |
| Security / path boundary | checked_no_finding | canonical path validation と immutable PR URI boundary を維持 |
| Held integration boundary | held | Remote/Dev Containers/Codespaces の実機 acceptance は T605 |
| Merge boundary | checked_no_finding | merge は reviewer が行わない |

## Verdict

`pass_with_held`

`PR69-R001`、`PR69-R002`、`PR69-R003` はすべて closed。fix diff から新しい required finding は検出していない。初回レビューで明示した T605 所管の Remote / container 系実機 acceptance の held だけを維持する。

## Next action

本 fix verification 上は PR #69 の required review finding は残っていない。merge は利用者が実施するため reviewer は行わない。

## Report persistence

この report は reviewed fix implementation HEAD `5b9c4ac13379d2980b90bdd8b097494b236f42cc` に対する finding 限定 verification を記録する。report/handoff 保存 commit は review artifact のみを追加する administrative commit とし、保存後に PR current HEAD と一致する pull_request CI の有無・結果を別途確認して PR コメントへ記録する。
