# Sub-agent実行レポート

## タスク

T609 independent-final-review IFR005 の R13 follow-up。Git revision 再計算の range-mapping 設定が通常の live-edit 経路と異なり既定値へ落ちる合成欠落を修正し、実際の Extension Host semantic matrix で確認する。

## sub-agentを使う理由

実装・TDD・ローカル検証を親のレビューおよび GitHub 操作から分離するため。

## 対象範囲

`reviewRange.ignoreWhitespaceChanges` と `reviewRange.ignoreEolChanges` の真偽値検証を一つの composition helper に集約し、通常 live-edit と `DocumentReviewStateSessionProvider` の Git revision mapping の双方へ同じ投影値を渡す。undefined と非 boolean は false とする。

## 対象外

設定契約・設計書・CI・GitHub・task tracking・commit/push・review・Host の timeout/sleep を変更しない。Host は一回だけ実行し、失敗時に同一コマンドを再試行しない。

## 実行コマンド

- Red: `npm run compile:test` 後 `node --test test-dist/test/unit/t609-gate-wiring.test.js` は 15 件中 14 pass、追加した production composition test が `readReviewRangeMappingOptions` 未存在で fail。
- Green: `npm run test:t609` は 64/64 pass。
- `npm run build`、`npm run compile`、`npm run lint`、`git diff --check` はすべて exit 0（`git diff --check` の LF/CRLF warning は non-failing）。
- exact Host 一回: `npm run test:t609:extension-host` は 268.1 秒で fail。`t609-single-root` は succeeded、`t609-prepare` は whitespace-only Git transition の期待 reviewed interval `[{ startLine: 0, endLineExclusive: 1 }]` に対し実測 `[]` で failed、fixture cleanup は succeeded。診断は `test-output/vscode-launch-diagnostics/t609-prepare-1787363015989.json`。

## 対象ファイル

- `src/application/configuration/review-range-mapping-options.ts`: validated mapping option reader を追加。
- `src/extension.ts`: Git document-session provider に shared mapping options を注入。
- `src/t305-extension.ts`: live-edit 経路を同じ reader に統一。
- `test/unit/t609-gate-wiring.test.ts`: 実際の production composition の wiring gate を追加。
- `test/unit/t609-normal-review-followup.test.ts`: true 以外を false とする shared-reader regression を追加。
- このレポート。

## 指摘事項

R12 の Host failure は、production activation の `DocumentReviewStateSessionProvider` に `gitMappingOptions` が渡されず default false/false になることを示した。R13 はその欠落を解消した。R13 Host の次の失敗は同一設定の値が multi-root prepare launch で実際に有効になっていない、または対象の provider が設定済みインスタンスではないことを示す。exact run は一回だけであり、この原因は未確定のまま残す。

## 提案内容

親は次の狭い follow-up で multi-root prepare launch の workspace/configuration scope と provider creation identity を診断し、`true/true` の effective setting が actual instance に到達することを public Host phase で確定する。R13 の shared helper、最小 production fix、focused Green は保持する。

## 未解決事項

- IFR005: incomplete。実際の Host matrix は single-root を通過したが、multi-root whitespace-only Git transition が未解決。
- reviewed technical HEAD は `b281c56b02019ffcc44918017fc21d58774b6dd4`。本 task は commit/push を行わないため、変更は未コミット。
- CI は未確認・未待機。
