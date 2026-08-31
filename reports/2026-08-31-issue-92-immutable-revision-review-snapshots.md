# Issue #92 immutable revision review snapshot implementation report

- 対象: Issue #92 / PR #94
- 実装branch: `issue-92-pr-progress-context-menu`
- 状態: 実装・自己検証完了、独立レビュー未実施
- merge: 未実施

## 1. 背景

PR Progressから開いたdiffで選択範囲を確認済みにできるようにする過程で、確認状態を現在revisionだけに保持すると、`A -> B -> C -> A`のように既知のimmutable revisionへ戻った際、CからAへのreverse mappingによってAの既確認行が未確認へ戻る問題が判明した。

期待する挙動は次のとおりである。

```text
A: 全行確認済み
A -> B: Bで変化した行だけ未確認
B: 全行確認済み
B -> C: Cで変化した行だけ未確認
C: 全行確認済み
C -> A: 保存済みのexact A状態を復元し、Aは全行確認済み
```

## 2. 設計変更

恒久設計を `doc/design/vscode-review-range-tracker-design.md` rev9へ更新し、補足詳細設計を `doc/design/immutable-revision-review-snapshots.md` に記録した。

### 2.1 Identity

- Context/Globalのmodified/current状態はlowercase full SHA-1またはSHA-256のHEAD revisionをkeyにする。
- Original側だけに存在する削除行・置換前行は従来どおり`${baseSha}..${headSha}`で分離する。
- branch、tag、`HEAD`、短縮SHA、revision rangeをsnapshot keyとして使用しない。

### 2.2 Snapshot優先

遷移先revisionに検証済みsnapshotが存在するlayerは、そのexact snapshotを復元する。現在revisionからreverse mappingしない。snapshotが存在しないlayerだけ、既存のdiff mappingで未変更範囲を追従し、変更範囲を未確認にする。

Context hit / Global missまたはその逆も許容するが、最終結果は同じContext/Global CAS transactionでatomicに公開する。

### 2.3 Legacyとfail-closed

- `revisionSnapshots`を持たない既存stateは現在revisionだけをlazy seedする。
- 過去revisionをappend-only historyから推測・復元しない。
- snapshot key、revision、file identity、path、line count、content hash、interval boundsの不整合は部分採用せず拒否する。
- 初期実装では有効snapshotを自動削除しない。

## 3. 選択範囲操作

PR Progressから実際に開いたexact diff tabでは、既存7件の`editor/context` contributionを維持したまま、次の4操作を表示する。

- 選択範囲を確認済みにする
- 選択範囲の確認済みを解除する
- ファイル全体を確認済みにする
- ファイル全体の確認済みを解除する

Original側の選択は次の規則で処理する。

1. 両側に存在するcontext行はimmutable diff座標を用いてModified側の現在行へ投影する。
2. Original側にしか存在しない削除行・置換前行はcurrent `${baseSha}..${headSha}`のoriginal rangeへ保存する。
3. 削除行と追加行を内容類似や位置だけで対応付けない。
4. Modified Context、Global、Original pairの複数状態が変わる場合もrepository commitは1回のatomic transactionとする。
5. PR revision pair更新後の旧diff tab、PR Progress以外のdiff、同一URIを持つ別tabには操作を公開・適用しない。

## 4. TDD

設計変更後、先に次の契約をテストへ追加した。

- Aのcurrent revisionだけをlegacy stateからseedする。
- active revisionでの確認・解除がそのrevision snapshotだけを更新する。
- Cからexact Aへ戻るとreverse diff evidenceを読み込まずA snapshotを復元する。
- Context snapshot hit / Global snapshot missをatomicに処理する。
- BASEだけが変わっても過去のoriginal comparison rangeを保持する。
- 壊れたexact snapshotを部分復元しない。
- Aへ復元後の操作がA snapshotだけを更新しC snapshotを変更しない。
- JSON persistence後もsnapshotが再帰stateを含まず復元できる。
- Original側選択のcontext行投影とoriginal-only行分離。
- PR Progress由来diffで選択範囲メニューが公開される。

テスト-only状態では未実装APIおよび未公開menu契約によりRedになることを確認した後、実装を追加した。

## 5. 実装

主な実装箇所は次のとおりである。

- `src/core/contracts/review-state.ts`
  - Context/Global revision snapshot modelを追加。
- `src/core/review-state/revision-snapshot-service.ts`
  - snapshot検証、current state同期、exact restoreを実装。
- `src/core/review-state/review-state-service.ts`
  - state transactionとsnapshot整合を維持。
- `src/application/github-pr-context/immutable-pull-request-revision-mapper.ts`
  - Context/Globalそれぞれのsnapshot hit/missを判定し、restore / map / mixedを処理。
- `src/application/github-pr-context/github-pull-request-context-layer-store.ts`
  - mapping dispositionを保持し、履歴reasonを通常mappingとexact restoreで区別。
- `src/application/review-commands/original-selection-review-plan.ts`
  - OriginalからModifiedへの確実な行投影とoriginal-only範囲分離。
- `src/application/review-commands/diff-editor-review-command-service.ts`
  - Original側の複合操作を1回のatomic commitへまとめる。
- `src/t405-pull-request-review-runtime-base.ts`
  - immutable diffからprojectionとsession evidenceを構築し、PR state commit時にcurrent revision snapshotへwrite-throughする。

## 6. 自己検証

一時repair workflowは、次の全処理が成功した場合だけ技術commitをbranchへpushする構成とした。

```text
npm ci
npm run build
npm run lint
npm test
git diff --check
```

失敗時はpushせず、`tools/run-ci-command.mjs`が各commandの結果、標準出力、標準エラー、combined logを`test-output`へ保存し、workflow artifactとしてuploadする。

一時worker script、repair workflow、connector probeは技術commit作成前に除去する。

## 7. CI判定

このreport commit後のPR current HEAD SHAとworkflow runの`head_sha`が一致するpull-request runだけを最終CI判定に使用する。別SHAの成功runは代用しない。一致runがなければCI未実施として扱う。

## 8. レビュー状態

独立レビューは未実施である。PRはDraftのまま維持し、mergeしない。
