# Sub-agent実行レポート

## タスク

- 目的: local base/headをPR相当として、実際のExtension Host・local Gitでdiff全体操作とPR Progress投影を受入試験し、AC-14〜AC-17の証跡を追加する。
- タスク種別: 初期実装（TDD）

## sub-agentを使う理由

- 理由: 親agentから限定されたT306実装、Red/Green、検証、予約レポート記入を委譲されたため。

## 対象範囲

- 対象: `test/vscode/t306-suite`の実Extension Host試験、local Gitのbase/head fixture、focused実行配線、Test modeだけの最小runtime seam。original側をfocusedにして全体確認を行い、modified追加行とoriginal削除行が進捗へ反映されること、全解除、ユーザー除外の分母除外・理由、rename-only分類、binary分類とtext diff非呼出しを確認した。

## 対象外

- 対象外: T505、T404以降、通常のPR/Tree View本番composition、design/BreakingChanges、親所有の`tasks/tasks-status.md`と`tasks/phases-status.md`、commit、push、PR、merge。

## 実行コマンド

- 実行コマンド:
  - `npm ci`: pass。初回Red前に依存が未導入で`tsc`が見つからなかったため、実際の製品gapを得るために実行した。auditはhigh severity 3件を報告したが、本タスクで変更しない。
  - `npm run test:t306`（Red）: fail。実Extension Hostで`TypeError: extensionApi.loadLocalPullRequestProgress is not a function`。production変更前の実際の欠落を確認した。
  - `npm run test:t306`（Green、最終）: pass。10.4秒。local Git fixture、実VS Code Extension Host、local diff取得、original focusedの全体確認、解除、PR Progress投影、binary selectionを通過した。
  - `npm run build`: pass（focused Green内で実行）。
  - `npm run typecheck:contracts`: pass。
  - `npm run validate:architecture`: pass。
  - `npm run validate:architecture:negative`: pass（期待どおり11件のnegative fixture違反）。
  - `npm run lint`: pass。
  - `npm run test:unit`: fail。441件中420 pass、19 fail。`DocumentReviewStateSessionProvider`のWindows path境界で`document path is outside the resolved Git working tree.`となる既知の本タスク外失敗で、修正・再実行はしていない。
  - `npm run test:git`: pass。33 pass、3 skip（WindowsでPOSIX専用fixtureをskip）。
  - `npm run test:vscode`: failed/Held。T306の設定cleanup修正後、124秒でtimeoutし診断出力なし。focused T306は別途pass済みだが、default suite成功には扱わない。
  - `git diff --check`: pass。

## 対象ファイル

- 変更または確認したファイル:
  - `src/extension.ts`: Test modeに限り、既存のlocal Git acquisition、DiffEditorReviewCommandService、PR Progress Tree projectionを結ぶ受入用seamを追加した。本番activation APIは変更しない。
  - `test/vscode/t306-suite/index.ts`: 実Git repositoryをbase/head commitとして作成し、AC-14〜AC-17を検証するExtension Host試験を追加した。
  - `test/vscode/run-extension-host.ts`: default suiteへT306を一度だけ追加し、`--t306`ではfocused suiteだけを実行するようにした。
  - `package.json`: `test:t306`を追加した。
  - `tasks/tasks-status.md`、`tasks/phases-status.md`: 親所有の既存変更として確認のみで、編集していない。

## 指摘事項

- 指摘要約または「指摘なし」: 指摘なし。Redで確認した未結線をTest modeの最小seamで接続した。ユーザー向けcontract、新規本番機能、破壊的変更は追加していない。

## 結果

- 結果: T306 focused Greenは成功した。AC-14/AC-15はoriginal focusedでもファイル全体確認がmodified追加・original削除の2行を確認済みにし、全解除で0へ戻すことで証明した。AC-16はユーザー除外fileを分母0かつ理由付きexcludedへ分離して証明した。AC-17はrename-onlyを行以外の変更、binaryを行単位対象外へ分類し、binary selectionがtext diff hostを呼ばないことで証明した。commit/push/PR/mergeは未実施。

## リスク

- 未解決のリスクまたは後続対応: default `test:vscode`は124秒timeoutのためfailed/Heldであり、CIまたは後続のExtension Host診断でclosureが必要。`test:unit`のWindows path境界19失敗も本タスク外Held。Markdown lintはrepositoryの`tools/lint/`と`lint:md` wiringがなくunsupportedであり、本レポートのfocused lintは実行不能。Test mode seamは受入試験専用で、本番のPR取得・Tree View compositionはT404以降の担当範囲として残す。
