# Sub-agent実行レポート

## タスク

- 目的: T203再レビューのblocking 4 findingをテスト先行で追加修正する
- タスク種別: review follow-up実装・回帰検証

## sub-agentを使う理由

- 理由: parserのtruncation、path、coordinate、escape validationへまたがる4件であり、同じTerra/high実装担当を再利用してT203 contractを一貫して修正する

## 対象範囲

- 対象: rename変更diff片側content-header truncation拒否、rename metadata pathのprefix保持、派生座標overflowと0/0 no-op hunk拒否、範囲外octal・NUL path拒否、および恒久回帰test

## 対象外

- 対象外: T204のrename/copy/delete file-state適用、T205以降、設計変更、origin/main由来release contract test失敗、branch/commit/PR操作

## 実行コマンド

- 実行コマンド: 指定された本report、r2 review、T203 source/testを全文確認した
- Red: `PATH`へ`C:\Program Files\nodejs`を追加して`npm run test:t203`を実行し、新規4 regression testにより15件中3件がfailすることを確認した。その後production parserを修正した
- Green: `npm run test:t203`は15/15 pass
- 検証: `npm run test:unit`、`npm run build`、`npm run lint`、`npm run typecheck:contracts`、`npm run validate:architecture`、`git diff --check origin/main`を実行した
- 結果: build、lint、contract typecheck、architecture、diff checkはexit 0。full unitは143/144 pass、1 fail（後述のorigin/main由来release workflow CRLF assertion）

## 対象ファイル

- 変更: `src/core/git-diff/git-diff-interval-mapping.ts`、`test/unit/git-diff-interval-mapping.test.ts`、本report
- 確認のみ: `src/core/git-diff/revision-interval-mapper.ts`。既存のauthoritative mapper re-exportであり、今回の4 findingでは変更不要だった
- 非変更: `src/core/git-diff/index.ts`、tracking、他report、design/package、branch/commit/PR metadata、T204 file-state適用

## 指摘事項

- 指摘要約: r2 reviewのblocking 4 findingをすべて修正した
- 1: old/new content headerの一方だけを持つsectionを`SyntaxError`で拒否するようにした。両headerなしのrename metadata-only sectionは引き続き受理する
- 2: `rename from/to`ではGitが付けない`a/`・`b/`を保持し、prefix除去は`---`/`+++` content headerだけに限定した。実Git形式の`rename from a/foo.txt`から`rename to b/foo.txt`を回帰test化した
- 3: `start + count`、expected new start、hunk delta、cumulative deltaのすべてでsafe integerを検証し、派生overflowを拒否するようにした。`@@ -0,0 +0,0 @@` no-op hunkも拒否し、実Git 0-count anchorは維持した
- 4: octal escapeをbyte範囲`0..255`に限定し、`\400`以上とdecoded NUL（`\000`を含む）pathを拒否するようにした。既存のvalid UTF-8 octal/tab/quote/backslashは維持する

## 結果

- 結果: **pass（T203 r2 follow-up scope）**。rename content truncationの両方向、headerless rename metadata、repository-relative `a/`/`b/` rename path、派生coordinate overflow、zero-zero no-op、octal byte overflow、NUL pathを恒久unit regressionとして追加し、T203 focused 15/15で検証した
- T204境界: 修正対象はparserの保守的validationとmetadata正規化のみであり、rename/copy/deleteのfile-state移送・一意性判定は実装していない

## リスク

- held・T203外: `npm run test:unit`は143/144 pass。唯一のfailは`release-vsix-contract.test.ts`の`workflow resolver increments one patch from the latest prerelease tag without backfilling commits`である。Windows worktreeの`.github/workflows/release-vsix.yml`がCRLFなのにtestがLF固定文字列でstep境界を探索する既知assertionであり、workflow/testは`origin/main`と同一で本T203差分とは無関係のため修正せず保留した
- held・T204境界: rename/copy/delete/分割/統合のfile-state適用と曖昧性判定は引き続きT204 scopeである。T203は正しいparser metadataと保守的failureまでに限定する
- 環境: `npm`が初期`PATH`になかったため、検証時だけ`C:\Program Files\nodejs`を追加した。ignored validation-only `node_modules` Junctionは既存のままである
