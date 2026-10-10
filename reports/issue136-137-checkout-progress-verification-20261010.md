# Issues136/137: checkout/list/PR Progress 連続検証

対象は既存 PR138 の branch `issue-136-137-refresh-and-safe-diagnostics`、開始 HEAD `92207925967454ce86331938859c4377878ef7a6`。Issue136 の checkout→一覧更新→対象 PR Progress と、Issue137 の同一 operation/generation の診断追跡を検証する通常実装・検証 report である。自分の変更に独立レビュー合格の判定は付けない。後続の最新 main `72082d336f8d00480f3e50908f929e88529bcaf8` 統合は、このテスト追加の小単位 commit/push 後に行う。

## 変更と検査範囲

- `test/helpers/pr108-production-fixture.ts`: 既存 default を維持し、opt-in で extension composition と同じ coordinator→Current Context PR views→実 PR runtime→Progress publication を結線。実一時 Git repository の branch checkout/tracking ref、PR ごとの登録 HEAD、既存 mock HTTP の gate、原本の診断 entry を観測する。
- `test/unit/issue-136-checkout-progress.test.ts`: 登録済み PR52/B→PR53/C の切替、no-match branch の空 Tree、Issue123 tracking-ahead B→C、遅延した旧 branch 結果の非公開を詳細 OFF/ON の6件で検査。選択 context、immutable BASE/HEAD/diffId、実ファイル node/openTarget と公開 Tree の一致を要求する。package.json の既存 unit gate に登録した。
- `test/vscode/t609-suite/index.ts`: 既存の refresh 回数 assertion に加え、実 Host Tree に古い PR snapshot を載せてから実 checkout/list command を実行し、検証済み branch と古い PR Tree の除去を検査する assertion を追加。
- tasks/phases と tasks/status に今回の小範囲を追跡。製品コード、依存関係、環境設定は変更していない。

一覧更新は未登録 PR を自動登録する契約ではない。最初の fixture は2PRを同一初期 HEAD に置いたため曖昧になり、次の fixture はC対象を未登録にしたため `no-matching-pr` になった。初回ログを残し、要求どおり「対象PRを選択できる登録済み状態」を正しいHEADでseedした。期待するcontext/immutable snapshot/Treeのassertは緩和していない。製品挙動修正を行っておらず、これらを製品 TDD Red→Green の証拠とは扱わない。

## 検証結果

FA780 の既存 Node/TypeScript/node_modules/Git を使用。stdout/stderr、終了コード、時刻、SHA-256 を外部 `pr138-flow-validation-20261010` に保存した。独立した Node プロセスで検証し、検証プロセスは終了した。

| 検証 | 結果 | ラベル |
| --- | --- | --- |
| compile:test | exit 0 | compile-5 |
| build | exit 0 | build-1 |
| lint | exit 0 | lint-1 |
| 新しい連続組合せ OFF/ON | 6成功、0失敗、0skip | chain-3 |
| 既存 Issue136/137、Issue90、Issue116、PR108 cache 回帰 | 45成功、0失敗、0skip | existing-1 |
| 既存失敗/取消/formatterテストの診断採取 | exit 0、期待する失敗・取消はassert通過 | failure-cancel-traces-1 |
| packaging/gate/source-layout contract | exit 0 | tooling-1 |
| FA780 T609 Extension Host | 起動前の環境阻害、assert未実施 | host-1 |

`chain-3` の実 formatter 出力は selection/acquisition/registration/Progress/Tree の同一 operation/generation と context/snapshot ordinal、files/Tree counts を保持した。旧 `op=5/generation=2` の started stage は `supersededByGeneration=3/causedByOp=6` と対応し、旧 operation は CANCEL、新 generation は成功した。no-match は理由付き空表示で成功し、tracking-ahead はローカル B と別の C snapshot を実際に公開した。通常/詳細とも repository/branch/path/token/source/diff の検査用生値は出力に含まれない。既存失敗/取消テストからも実 production feedback entry を formatter に通して採取し、root terminal と refresh stage terminal を区別した。

## Host の正確な阻害と未検証

既存 VS Code 1.130.0 cache を明示して利用し、新規ダウンロードはしていない。Code は `checkInnoSetupMutex: vscode-updating is held` で31秒待機後 `Code is currently being updated` として終了した。launch diagnostic は `status=failed`、`workerError=Test run failed with code 1`、`ownedExtensionHostPids=[]`。したがって Extension Host は開始しておらず、追加 Host assertion の合否は不明である。

外部 cache 指定 wrapper が cleanup worker にも launch config を要求した誤りで、runner 終了ログの最後には wrapper error が出た。原本 launch diagnostic を先に退避し、cleanup worker はそのまま元 launcher へ渡す形に wrapper を修正した。mutex 阻害が判明したため再起動は重ねず、他の updater/process や設定を操作していない。最初の失敗時の一時 fixture cleanup 完了は確認できないため、完了とは扱わない。task-owned launch worker の停止は launcher が記録した。

物理 UI、実 GitHub 接続によるユーザーの元再現環境、Linux supervisor/subreaper は未検証。Node の production seam 成功を実 Host や実機の成功として扱わない。Host assertion は公開後の同一 HEAD CI で確認し、FA780 環境阻害とは区別して引き継ぐ。

## 公開と次の作業

この report は commit 前の通常記録で、結果 SHA は commit/push 後に外部 handoff と PR138 コメントへ記録する。build 成功の小単位を通常 commit/push し、最新 main の通常統合では PR141 の timeout retry/stdout 分離/親子path分割/型移動/abort guard と、PR138 の診断・cancel/refresh/cache/registration、Issue139 closed PR/選択 HEAD 分離を保持する。GitHub PR138 merge、force push、新しい branch/PR/Issue、依存・環境設定変更は行わない。
