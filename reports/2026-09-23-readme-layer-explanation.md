# READMEのレイヤー切り替え説明の補足

## 対象と権限

- repository: `ssaattww/RevMem`、PR: #127、branch: `docs/readme-restructure-20260923`、base: `main`。
- 作業開始HEAD: `575027e04b834e15e3eaedd9093cee38996ded86`。
- 検証したREADMEのblob: `29524d9b6cc1d8c52222fe79598a02e55ac02a54`。
- 実行環境: FA780、Windows、PowerShell、Remote Desktop Commander。Node.js v24.20.0、npm 11.19.0。
- 作業場所: `C:\Users\donabe\Project\RevMem-readme-restructure-20260923`。開始時はcleanで、GitHub connector取得のPR HEADと一致。
- verification capability: `local_execution_available`。変更、commit、push、PR更新・コメントは今回の依頼とProject Instructionの範囲で実施する。mergeしない。
- 今回の変更はREADMEと本レポートのみ。製品コード、テスト、設定、設計、既存タスクの状態は変更しない。

## 要求と変更内容

利用者から「レイヤーの切り替えがどういう機能かよくわからないので説明を補足」と依頼された。
READMEのContext / Global説明の直後に、レイヤーの定義、操作場所、GlobalのON/OFF比較表、確認済み解除との違いを追加した。
Globalに1〜5行目、現在のContextに2〜3行目の確認状態がある例で、OFFにしても現在のContextのグレー表示は残ることを説明した。
Current Contextの選択やフォルダー収集の停止とは別操作であることも追記した。
PRレイヤーは表示への接続が不足しているため、一覧の機能説明から制限へリンクし、表示切り替えが動くと誤解させない記述にした。

## 実装から確認した事実

| 対象 | 実装と確認結果 |
| --- | --- |
| Global切り替え | `src/ui/global-understanding/global-understanding-ui-model.ts:551-560` は設定を反転し、装飾と理解率表示を更新する。`src/composition/extension.ts` は `showGlobalReviewed` の読書きを渡す。 |
| Globalの表示 | `src/application/editor-decoration/normal-editor-decoration-model.ts:408-582` はOFF時にGlobal由来の範囲だけを外し、現在のContext由来の範囲を残す。現在のPRの未確認変更行をGlobalだけで確認済みにしない。 |
| PR切り替え | `src/composition/review-contexts/review-contexts-runtime.ts:1416-1425` は `decorationEnabled` を保存する。PR表示設定の既定値はopenでON、closed・mergedでOFF。明示設定は優先される。 |
| PRの表示制限 | `git grep` で製品コード全体の `decorationEnabled` / `isPullRequestDecorationEnabled` 参照を確認した。設定保存と一覧表示以外に利用がなく、通常エディタの実行経路 `src/extension.ts:315-342` から表示モデルへも表示可否を適用していない。 |
| 他Contextの重ね表示 | 表示モデルには `otherContextStates` 入力があるが、通常エディタの実行経路からは渡していない。保存済みPRのレイヤーをONにすれば別PRの行が重なる、とは説明しない。 |

PRレイヤーの接続不足は今回のREADME変更より前から存在する。今回は事実を説明する文書変更に限定し、製品修正や別Issueの作成はしていない。

## 検証と証拠

TDDは適用外。製品挙動の変更や新規実装はなく、既存実装との照合と文書検証を行った。変更後のテスト成功をTDD実施の証拠とは扱わない。

診断保存先は作業場所内の `test-output/readme-layer-explanation/`。既存の `tools/run-ci-command.mjs` で標準出力、標準エラー、結合ログ、終了コード付き結果JSONを保存し、同フォルダーへ複製した。

| 検証 | 結果 |
| --- | --- |
| `npm run compile:test` | 成功。`readme-layer-compile.*` に記録。 |
| `node test-output/readme-layer-explanation/probe.mjs` | 成功。実際のコンパイル済み非同期表示モデルを使用。GlobalのON/OFFによる表示差、入力状態が不変であること、PR設定OFFでも現在のPRの表示モデルが変わらないことを確認。`readme-layer-probe.*` に記録。 |
| README・レイヤー関連テスト6ファイル | 64件成功、失敗0件。`readme-layer-focused.*` に記録。 |
| `git diff --check` | README変更で成功。commit前にも確認する。 |
| Markdown専用lint | `tools/lint/`、`lint:md`、cspell設定がないためunsupported。既存ESLintの成功とは区別する。 |

関連テストの実行コマンドは次のとおり。

```text
node --test test-dist/test/unit/release-vsix-contract.test.js test-dist/test/unit/t405-review-followup.test.js test-dist/test/unit/github-pr-context-layer-store.test.js test-dist/test/unit/normal-editor-decoration-model.test.js test-dist/test/unit/global-review-mapping-display-priority.test.js test-dist/test/unit/global-understanding-ui.test.js
```

probeは表示モデルの実行確認であり、VS Code画面で実際にボタンをクリックした試験ではない。PR diffについては製品コード全体の参照調査に基づく。両者の検証範囲を混同しない。

## 診断workflowの確認

作業開始時に `.github/workflows/ci.yml` と `tools/run-ci-command.mjs` を確認した。
既存workflowがテスト結果、標準出力、標準エラー、失敗時の環境情報と調査用ファイルを `ci-failure-diagnostics-*` へ保存するため、workflowは変更していない。

## 文言の自己点検

アップロード済み `chatgpt-worker-skills 4.zip` のChatGPT実装手順を使用した。
`document-wording-review/SKILL.md` と `references/decision-examples.md` をFA780から読み、今回のREADME差分全体と本レポートを現在のチャットで点検した。RDCの実行成功を文言レビューの代わりにはしていない。
同SkillのSHA-256は `090A4DAD84842EE9A2DDAC2EA2573F83C32EF3F3FFB441CDCB1377838C215818`、参考例は `01C85DFAD9A581D4301D73909247308FBAF4EE79DD8460B5630D70667019B564`。
READMEは開始HEADの本文全体と変更後の差分を照合した。追加した説明は保存操作・表示操作・集計を区別し、実際のUI名と設定キーを維持している。意味・用語の識別・読みやすさの自己点検では追加修正を要する点は見つからなかった。
独立レビューは実施しておらず、自己点検を独立レビューの合格とは扱わない。Markdown専用lintのunsupportedも解消していない。

## 公開時の検証と引き継ぎ

本レポート保存時点は `commit_pending` / `push_pending` / `ci_wait_pending`。自分自身の将来のcommit SHAは記載しない。
READMEの検証済みblobとcommitした内容を照合し、公開候補のHEADで `build`、`typecheck:contracts`、architecture正負、`lint`、`npm test` を1回実行してログを保存する。
最終push後はGitHub connectorでPRのcurrent HEADを読み直し、同じ `head_sha` の `pull_request` workflow runだけをCI確認に用いる。旧HEADのCI成功は代用しない。
公開候補HEAD、標準検証の終了結果、最終CI runとartifact、commit/pushの結果は、このレポートを参照するPRコメントへ記録する。CI状態を追記するためだけの追加commitは作らない。

残る制限はPRレイヤーの行表示への未接続と、Markdown専用lintがないこと。製品修正を今回の説明補足へ混在させない。次の利用者判断はPRの文書確認とmergeであり、workerはmergeしない。
