# Sub-agent実行レポート

## タスク

- 目的: PDS-02 既存PR差分経路の行数不一致を修正する。
- タスク種別: implementation。PR #120。

## sub-agentを使う理由

- 利用者指定のterra high実装担当を継続利用し、親は追跡とレビュー統合を行う。

## 対象範囲

- PDS-02、本文取得からPR session・実コマンドまでの末尾改行契約とテスト。

## 対象外

- block機能の接続、後続タスク、設計本文への実装メモ追加、無関係なWindows全体修正、push、merge。

## Dispatch profile

- selection inputs: implementation / bounded_technical / uncertainty medium / radius cross_module / criticality high / sequential_dependencies / context retained。
- selection source: user_override; 実装terra highを継続。
- decomposition policy: sequential single task。
- requested profile: gpt-5.6-terra / high、初回fork none。
- role plan: 初回runtime default、config.tomlにagents overrideなし。
- planned runtime profile: 初回gpt-5.6-terra / high。
- applied profile: null。
- application status: reused_existing_agent_profile; identity /root/line_contract。
- profile observability: final_profile_hidden、初回reportの証拠を維持。
- reasons / constraints: 高い互換性リスクは明確な設計と実経路テストで検証する。利用者overrideを変更しない。

## 実行コマンド

- Red（製品実装前、fixture補正後）: `node tools/run-ci-command.mjs pds-02-runtime-lines-red-product C:\Windows\System32\cmd.exe /d /s /c 'npm run compile:test && node --test test-dist/test/unit/t405-pull-request-review-runtime.test.js'`。exit 1。23件中17 pass / 6 fail。LF終端の追加・削除・終端追加置換・終端削除置換の4件は `Immutable diff tail does not preserve a one-to-one context mapping`、末尾表示行は同じ不整合で、bare CRの表示fragmentは誤って `applied`。結果・stdout・stderr・統合logは `test-output/ci/pds-02-runtime-lines-red-product.*`。
- 先行診断: `pds-02-runtime-lines-red` は73件中65 pass / 8 fail（exit 1）。追加したfixtureが既存 `file-1` の古いhashを残したため、上記製品失敗に加えhash不一致も混在した。fixtureを空files状態から開始するよう補正した。
- fixture補正確認: `pds-02-runtime-lines-red-fixture-corrected` は `--test-name-pattern` をWindows `cmd.exe` 経由で渡した結果、Nodeが対象ファイル1件だけを実行しexit 0となった。個々のtestを選別できた証拠ではないためGreenには用いず、全23件を実行する上記Redへ置換した。結果は `test-output/ci/pds-02-runtime-lines-red-fixture-corrected.*`。
- Green: `node tools/run-ci-command.mjs pds-02-runtime-lines-green-final C:\Windows\System32\cmd.exe /d /s /c 'npm run compile:test && node --test test-dist/test/unit/t405-pull-request-review-runtime.test.js'`。exit 0、23 pass / 0 fail。`test-output/ci/pds-02-runtime-lines-green-final.*`。
- 本文identity Red: `node tools/run-ci-command.mjs pds-02-body-identity-red C:\Windows\System32\cmd.exe /d /s /c 'npm run compile:test && node --test test-dist/test/unit/t405-pull-request-review-runtime.test.js'`。本文text照合呼出しを外した状態でexit 1、22 pass / 1 fail。same-countの`other` hunk本文がmutation前に拒否されず、`Missing expected rejection`となった。`test-output/ci/pds-02-body-identity-red.*`。
- 本文identity Green: `node tools/run-ci-command.mjs pds-02-runtime-lines-green-body-identity-confirmed C:\Windows\System32\cmd.exe /d /s /c 'npm run compile:test && node --test test-dist/test/unit/t405-pull-request-review-runtime.test.js'`。exit 0、23 pass / 0 fail。`test-output/ci/pds-02-runtime-lines-green-body-identity-confirmed.*`。
- 行契約: `node tools/run-ci-command.mjs pds-02-document-line-contract C:\Windows\System32\cmd.exe /d /s /c 'npm run test:document-line-contract'`。exit 0、4 pass。
- 型契約: `node tools/run-ci-command.mjs pds-02-typecheck-contracts C:\Windows\System32\cmd.exe /d /s /c 'npm run typecheck:contracts'`。exit 0。
- 構造: `node tools/run-ci-command.mjs pds-02-architecture C:\Windows\System32\cmd.exe /d /s /c 'npm run validate:architecture'`。exit 0。
- lint: `node tools/run-ci-command.mjs pds-02-lint C:\Windows\System32\cmd.exe /d /s /c 'npm run lint'`。exit 0。
- 最終本文identity sourceで再実行: `pds-02-document-line-contract-final`（4 pass）、`pds-02-typecheck-contracts-final`（exit 0）、`pds-02-architecture-final`（exit 0）、`pds-02-lint-final`（exit 0）。各々同じ`tools/run-ci-command.mjs`経由の結果を`test-output/ci/`に保存した。
- 検出契約: `node tools/run-ci-command.mjs pds-02-default-discovery-contract node -e "const p=require('./package.json'); if (!p.scripts['test:unit'].includes('test-dist/test/unit/t405-pull-request-review-runtime.test.js')) process.exit(1); console.log('test:unit includes runtime line-contract coverage');"`。exit 0。新規ケースを置いた既存runtime testを`test:unit`へ追加した。今回の範囲では全unitは再実行していない。
- `git diff --check` はexit 0。

## 対象ファイル

- `src/composition/pull-request/pull-request-review-runtime-base.ts`: 同一revisionの本文read cacheからPDS-01のline contractを導出する。存在しないsnapshot側だけを`absent`とし、snapshotにpathがあるのに本文readがfound以外ならfail-closedにする。editor countはsession選択境界、Git content countはhunk/mappingに分離し、各hunk lineのtextを同じimmutable bodyのGit LF座標で照合する。CRLFのdelimiter CRだけを除き、bare CRは本文のまま比較する。
- `src/application/review-commands/diff-editor-review-command-service.ts`: runtime sessionが提供するmodified Git content countまでselection intervalを切り詰める。末尾LF/CRLFの表示専用行とbare CRでeditorだけに現れるfragmentは`no-op`となる。既存の非PR sessionはoptional field未提供時に従来のtarget line countを用いる。
- `test/unit/t405-pull-request-review-runtime.test.ts`: local Git patch builder→snapshot→runtime registration→virtual document content read→open diff→mark/unmark→memory storage/historyの実経路を追加した。
- `package.json`: 上記既存runtime testを`test:unit`の既定リストへ追加した。

## 指摘事項

- Red product source fingerprint（HEAD `bf7ff438a4fd8eb4a09a9f91256fdce3a9478024`）: runtime-base `bb1bf20afe9a2d68a62363048013fa8b78b88c8a`、command service `6285df36a327a121cc5af3bf5feb4f1a31d878d8`。fixture補正後のRedはこの製品sourceで実行した。
- 最終Green working-tree fingerprint: runtime-base `b5f52b10b42211802ef51fe8c6207a6543dc21bc`、command service `f47967a8319fd20cf6b651448f47b3b3da76fc82`、runtime test `f8ef8eacc96288c5caa227a8efa4378162b6abb7`、package `b417e9347ac1602293933d3e54081c36239e4c76`。
- 7条件は不存在→`new`/`new\n`、`old`/`old\n`→不存在、`old\n`→`new\n`、`old`→`new\n`、`old\n`→`new`を、各々mark/unmark、2 commit、2 historyで検証した。空の既存ファイル、CRLF、末尾表示行、bare CR、truncated patch、hunk count、line coordinate、same-countのhunk textを改竄したinconsistent snapshotも追加した。
- bare CRは`a\rb`→`a\rc`のlocal Git hunk（Git content coordinateは各側1行）を、editor側のline 1で操作する。PDS-01ではeditor count 2、Git content count 1であり、検証は`no-op`、commit/history 0となる。text照合もbare CRを削らず同じ1内容行として行う。
- PDS-03が利用できる値はsessionの`originalContentLineCount`/`modifiedContentLineCount`と、既存の完全hunk・original-to-modified mappingである。PDS-02はblock導出・block modeの接続を行わない。

## 結果

- `normal_persistence: repository_file`
- 本文の存在有無と本文から導くPDS-01 contractをPR runtime sessionへ通し、選択検証のeditor座標とhunk/mapping/completenessのGit内容座標を混在させないようにした。末尾表示行とbare CRのeditor-only fragmentは状態、commit、historyを生成しない。
- 不完全なpatchはsnapshot builderで拒否し、hunk count・line coordinate・same-count wrong bodyと本文content countの矛盾はruntimeでcommit/history前に拒否する。
- テストは既存`test:unit` discoveryに登録済み。これはPDS-02の実装・証拠完了であり、機能全体、block操作、統合レビュー、全unit gateの完了を示さない。

## リスク

- `DiffEditorReviewStateSession`のcontent countはoptionalである。既存の非PR composition/testsを一括変更せず、PR runtimeのみが正確なcontent countを供給する互換境界にした。PDS-03以降でblock入力を消費する際は、optional fallbackへGit座標を渡さないこと。
- 手製patch fixtureは一行本文のEOL境界を対象にする。複数hunk・変更ブロック展開と三成分の受入行列はPDS-03以降の範囲である。
