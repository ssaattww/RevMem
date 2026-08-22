# 実装レポート

## メタデータ

- 対象: Issue #78 / PR #83
- branch: `task/issue-78-folder-understanding`
- technical HEAD: `b29b756ba144d85f45d39411650ff46bb9aae222`（変更前）
- verification capability: `local_execution_available`
- persistence: repository file / commit pending

## 目的

- PC、runner負荷、仮想化方式に左右されるT607性能workloadをCIのmerge gateから外し、developer-localの手動検証として維持する。

## 変更

- `.github/workflows/ci.yml`からT607専用stepを削除した。
- `test:t607`はローカル入口として維持し、通常`test:unit`とCIから除外される静的契約を追加した。
- 設計とtask/phase trackingへlocal-only方針を同期した。
- `Design/BreakingChanges.md`は変更していない。製品の公開動作ではなく検証workflowの変更であるため、破壊的変更ではない。

## 検証

- `npm run compile:test`: pass。
- `node --test --test-name-pattern='T607 performance workloads remain local-only' test-dist/test/unit/ci-workflow-contract.test.js`: 1/1 pass。
- `git diff --check`: pass（LF-to-CRLF warningのみ）。
- `test:t607`、性能fixture、Extension Host、CIは実行していない。
- Markdown wording lintは`tools/lint/`と`lint:md`が存在しないため`unsupported`。pass扱いにはしていない。

## 結果

- T607性能workloadはローカル手動実行だけに残り、CIは軽量な分離契約のみを検査する。
- commit/pushは本レポート作成時点ではpending。CI waitとmergeは未実施。

## リスクと次の対応

- ローカル性能結果はadvisory evidenceであり、機種間の数値比較やCI合否には使用しない。
- T607を手動実行しない期間の性能劣化は自動検出されないため、性能変更時に開発者が明示的にローカル実行する。
