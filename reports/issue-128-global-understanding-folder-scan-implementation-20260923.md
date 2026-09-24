# Issue #128 Implementation Report

## Metadata

- generated_at: 2026-09-23T13:45:21Z
- repository: ssaattww/RevMem
- issue: #128
- pull_request: #129
- branch: fix/issue-128-global-understanding-folder-scan
- base: df1501358be6ad0e6e03989ddc9e08f67a6e1996
- technical_head: 3ffc3ad401c7d51b45bf66774ecad519d856ce1d
- execution_environment: FA780 / Windows / PowerShell / Remote Desktop Commander
- verification_capability: local_execution_available
- merge: not performed

## Purpose

Global Understanding の明示 folder start で、未オープン file の本文・非空行数を実 filesystem から集計できない問題、本文取得失敗時に discovery 済み file 件数が消える問題、Output の一般失敗が `details were redacted` だけになる問題を修正した。

## Scope

- 明示開始済み folder scope 内の未オープン file を既存 Node file source で読み取る。
- discovered path/file count と content/line evidence を分離する。
- failed/incomplete scope を partial として公開する。
- privacy-safe な構造化失敗診断を Output に残す。
- ordinary refresh / 単純 file open で無制限 repository-wide 本文 scan を復活させない。

## Non-goals

- repository-wide auto scan の復活。
- T608、他Issue/PRの修正。
- merge。

## Implementation

### I128-IMPL-001: unopened filesystem evidence

- `NodeGlobalUnderstandingFileSource` を active folder scope の未オープン path に再利用した。
- line progress row 数と VS Code で実際に open 済みの file 数を分離した。
- `root.txt=2`、`child/nested.txt=3` の fixture で total 5 行を確認した。
- ordinary refresh の開始前は total 0 / discovered 0 のままで、repository-wide本文scanは行わない。

訂正（2026-09-24）: I128-IMPL-001 の original Red-before-Green chronology は、このimplementation chatが直接観測した証拠も、当時保存された失敗artifactも確認できないため **unverified** とする。trackingに存在した `0 != 5` の記録だけをTDD実行証明として扱わない。2026-09-24にpre-implementation HEAD `af71e1f9571380853c4753537620e1b04c9cf38d`へ同等のregression testだけを一時適用し、`0 != 5` をretrospectiveに再現したが、これは当時のRed-before-Green時系列を証明するものではない。

### I128-IMPL-002: discovery retention

- path discovery 成功時点の file path を provisional evidence として保持する。
- 後段の本文取得が失敗しても、発見済み path と file count を lifecycle snapshot に残す。
- invalid UTF-8 fixture で Red: `discoveredFilePaths === undefined` を直接確認した。
- Green: discovered 2件、opened 0、unopened 2、repository partial、failed child scope、status非%表示を確認した。

### I128-IMPL-003: privacy-safe diagnostics

- 元の Error / TypeError を別例外へ置換せず、WeakMap で安全な診断metadataを関連付ける。
- Output へ `stage / operation / scope / error name / allowlist code / category / discovered / processed` を出す。
- source本文、file path、repository path、secretを出力しない。
- Red: `Operation failed; details were redacted.` のみを直接確認した。
- Green: content-read TypeError と owner-capture EACCES の構造化診断を確認した。

## Changed files

- `src/composition/global-understanding/global-understanding-source.ts`: filesystem evidence collection、provisional discovery retention、diagnostic attachment。
- `src/ui/global-understanding/global-understanding-ui-model.ts`: progress row と opened count の契約を分離。
- `src/application/operation-feedback/operation-feedback.ts`: Global Understanding failure diagnostic metadata と安全なOutput projection。
- `test/unit/t610-folder-understanding.test.ts`: filesystem、partial failure、privacy-safe diagnostic回帰。
- `test/unit/global-understanding-ui.test.ts`: unopened file がline progressを持つUI契約。
- `tasks/tasks-status.md`、`tasks/phases-status.md`: Issue #128 tracking。

## Commits

- `af71e1f9571380853c4753537620e1b04c9cf38d` — Issue #128 tracking。
- `cea770bc6107a20d4e8c846ec7ddcb93ac20d7e2` — explicit folder evidence collection と failure時discovery保持。
- `3ffc3ad401c7d51b45bf66774ecad519d856ce1d` — privacy-safe structured diagnostics。

## Validation

- Issue #128 focused: 4/4 pass。
- `npm run test:t610`: 90/90 pass。
- `npm run test:t606`: 223 pass / 2 skip / 0 fail。
- Full local equivalence gate on technical HEAD `3ffc3ad401c7d51b45bf66774ecad519d856ce1d`:
  - `npm run build`: pass
  - `npm run typecheck:contracts`: pass
  - `npm run validate:architecture`: pass
  - `npm run validate:architecture:negative`: pass
  - `npm run lint`: pass
  - `npm test`: pass
- stdout/stderr: `test-output/issue128/`。CI workflow の failure artifact は既存 `Upload failure diagnostics` を利用する。

## Remaining evidence and next action

このreportとhandoffを含む最終candidateをlocal commitした後、同じfull local gateをexact candidate HEADで再実行してからpushする。push後は PR #129 の current HEAD SHA と一致する pull_request workflow run のみをCI証拠として扱う。別SHAのrunは代用しない。

正常review / independent final review はこのimplementation chatでは実施しない。次のreview chatは最終candidate HEADを再解決してレビューする。

## Remaining risks

- I128-IMPL-001 の original TDD Red chronology は unverified。2026-09-24のbaseline再現は元実装の不具合再現証拠であり、当時のTDD順序の証明ではない。
- exact-head CIはreport生成時点では未実施。最終結果はPRコメントへ外部同期する。
