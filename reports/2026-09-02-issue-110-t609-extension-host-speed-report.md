# Issue #110 T609 Extension Host performance implementation report

Date: 2026-09-02
Repository: `ssaattww/RevMem`
Issue: #110
Pull request: #111
Implementation branch: `issue-110-t609-test-speed`
Code-validation HEAD: `ab6dea535622562ed89a3f8c26394cca6e6efa2c`
Code-validation workflow run: `33582422518`

## 1. Result

T609 Extension Host の約3分の停滞原因を、`single-root` phase の live encoding transition fixture に特定した。

原因は製品処理そのものではなく、Shift-JIS document の encoding を変更する際に fixture が通常ファイルの tab を閉じ、その後 `vscode.workspace.onDidCloseTextDocument` を待っていたことだった。VS Code は tab close と TextDocument model disposal を同一タイミングでは行わず、この fixture では close event まで約3分待機していた。

最終実装では document を閉じず、VS Code の `workspace.openTextDocument(uri, { encoding: "utf8" })` を使って、既に開いている document を別 encoding で再decodeする。これにより actual VS Code encoding transition と RevMem の production document-routing / mapping / decoration 経路を維持したまま、model disposal 待ちだけを除去した。

## 2. Test policy for this work

この作業では利用者の明示指示により TDD の Red-first 手順は適用せず、既存テスト・契約テスト・Extension Host テスト・required CI が通ることを完了条件とした。

作業開始時に `.github/workflows/ci.yml` を確認し、失敗時の診断 artifact 契約が既に存在することを確認した。CI command は `tools/run-ci-command.mjs` 経由で実行され、`test-output/` に stdout、stderr、combined log、result metadata を保存し、failure 時には関連ソース、生成物、設定、workflow とともに artifact 化する。このため診断 workflow の追加変更は不要だった。

## 3. Investigation

### 3.1 Baseline

Issue #110 の baseline では T609 required CI step が約3分38秒を要していた。追加の診断では T609 unit 自体は約1秒で、遅延は `test:t609:extension-host`、特に `single-root` phase に集中していることを確認した。

### 3.2 Disproved hypotheses

調査途中で以下を候補として確認したが、いずれも主因ではなかった。

- VS Code の初回 download
- Current Context の Quick Pick 待ち
- URI boundary fixture の dirty `untitled:` document close
- Extension Host の shutdown / deactivate

Quick Pick 仮説は実際の selection request が発生していないことから除外した。`untitled:` close の変更を試した際も T609 全体の約3分は変化せず、主因ではないことを確認した。これらの診断用変更は最終差分から除去した。

### 3.3 Timing isolation

計測用 instrumentation を一時的に追加し、`single-root` の checkpoint を比較した。

Diagnostic HEAD: `796a3c60cba5e95a0702f1b4c2e5456fbd7c6891`
Workflow run: `33580679112`

- `mixed-encoding`: 2,422 ms
- `live-encoding`: 181,698 ms
- live encoding transition 単体: 179,276 ms

したがって、約3分のほぼ全量が `assertLiveEncodingTransition()` 内にあることを確定した。

同関数を追跡すると、encoding 設定変更後に対象 tab を閉じ、`onDidCloseTextDocument` を待機していた。tab close 自体ではなく TextDocument model の disposal/close event が遅延していたことがボトルネックだった。

## 4. Implementation

### 4.1 T609 live encoding fixture

File: `test/vscode/t609-suite/index.ts`

変更前の概念:

```ts
await configuration.update("encoding", "utf8", ...);
await closeDocument(shifted);
await waitForCloseEvent;
const reopened = await vscode.workspace.openTextDocument(shiftedUri);
```

変更後:

```ts
await configuration.update("encoding", "utf8", ...);
const reopened = await within(
  "re-decode Shift-JIS document as UTF-8",
  vscode.workspace.openTextDocument(shiftedUri, { encoding: "utf8" })
);
await vscode.window.showTextDocument(reopened, { preview: false });
assert.equal(reopened.encoding, "utf8");
```

その後は従来どおり production API を drain / refresh して persisted Git review state を検証する。

維持した検証内容:

- actual VS Code document を Shift-JIS から UTF-8 へ再decodeすること
- encoding change 後に production document review runtime が処理を完了すること
- Shift-JIS file の Context / Global reviewed range が同一revision内で conservative に clear されること
- unrelated UTF-8 BOM file の Context / Global state が変化しないこと
- unrelated UTF-8 BOM document が開いたままであること
- Test-only state mutation seam を使わないこと

### 4.2 Gate contract update

File: `test/unit/t609-gate-wiring.test.ts`

旧契約は live encoding transition が対象tabを閉じ `onDidCloseTextDocument` を待つことを固定していた。これを、新しい仕様に合わせて以下へ変更した。

- `openTextDocument(shiftedUri, { encoding: "utf8" })` を使うこと
- reopened document の encoding が UTF-8 であること
- live encoding transition 内で `closeDocument(shifted)` / `onDidCloseTextDocument` / `tabGroups.close` を使わないこと
- unrelated UTF-8 BOM document の open 状態を維持すること

これにより将来の変更で3分のmodel-disposal待ちが再導入されることを防ぐ。

### 4.3 T404 month rollover test repair

File: `test/unit/github-pr-context-layer-store.test.ts`

Issue #110 作業中、2026-09-01 UTC への月跨ぎにより既存T404 unit test が再現性を持って失敗した。

旧fixtureは `events-2026-08.jsonl` を固定で読んでいたため、August の `context-created` と September の revision history が別monthly fileに分かれると後半eventを読めなかった。

修正後は `events-YYYY-MM.jsonl` を列挙・sortし、対象monthly history filesを時系列に連結してevent typeを検証する。製品history persistence仕様は変更していない。

## 5. Performance evidence

### 5.1 Root-cause diagnostic

HEAD: `796a3c60cba5e95a0702f1b4c2e5456fbd7c6891`
Run: `33580679112`

- live encoding transition: 179.276 s
- single-root fixture body: 181.698 s

### 5.2 Instrumented fix proof

HEAD: `faa08f25222bfd84abc4ec3e3f95b551cc5f79df`
Run: `33581601811`

- `mixed-encoding`: 3.308 s
- `live-encoding`: 4.844 s
- live encoding transition: 1.536 s
- single-root fixture body: 4.844 s

Reduction:

- live encoding transition: 179.276 s -> 1.536 s, about 99.1% reduction
- single-root fixture body: 181.698 s -> 4.844 s, about 97.3% reduction

### 5.3 Clean final code proof

HEAD: `ab6dea535622562ed89a3f8c26394cca6e6efa2c`
Run: `33582422518`

The temporary timing instrumentation had already been removed for this run.

- T609 step start: 2026-09-02T02:16:59.915Z
- next T610 step start: 2026-09-02T02:17:43.266Z
- clean T609 required CI step: about 43.35 s

The earlier diagnostic T609 step was about 222 s, so the clean required T609 gate is shorter by about 179 s, approximately 80%.

## 6. Validation

Exact code HEAD `ab6dea535622562ed89a3f8c26394cca6e6efa2c` was validated by workflow run `33582422518`, whose `head_sha` exactly matches that HEAD.

Result: Green.

Successful required stages included:

- build
- contract typecheck
- architecture positive/negative validation
- lint
- default unit tests
- T602 / T603 / T403 / T404 / T405 / T406
- T304 / T502 / T503 / T504 / T505 / T506
- T604 / T605 / T606
- T609 repository and encoding tests
- T610 folder Global Understanding tests
- temporary Git integration
- mock GitHub integration
- general VS Code Extension Host tests
- user-validation packaging and artifact upload

T609 focused unit result in the clean run: 81 passed, 0 failed.

The final report commit changes the PR HEAD after this code-validation run. Per repository CI policy, the report-only final HEAD must receive its own exact-head workflow run before completion is declared; that final exact-head run is recorded in the PR summary/comment rather than retroactively substituting this code HEAD run.

## 7. Final diff scope

Functional/test changes are limited to:

- `test/vscode/t609-suite/index.ts`
- `test/unit/t609-gate-wiring.test.ts`
- `test/unit/github-pr-context-layer-store.test.ts`

No production `src/` implementation was changed for the T609 speed fix. The bottleneck was in the Extension Host acceptance fixture lifecycle.

Temporary instrumentation and disproved-hypothesis changes were removed before the clean validation run.

## 8. Conclusion

Issue #110 の約3分のT609停滞は、live encoding fixture が通常file tab close後の TextDocument close/disposal eventを待っていたことが原因だった。

Open document を VS Code API で明示的に再decodeする方式へ変更することで、production encoding/mapping coverage を維持しつつ、live encoding transition を約179秒から約1.5秒へ削減した。clean required T609 CI stepも約222秒から約43秒へ短縮され、code-validation HEADではrequired CI全体がGreenとなった。
