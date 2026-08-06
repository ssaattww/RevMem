# T602 レビュー指摘対応報告

## メタデータ

- Repository: `ssaattww/RevMem`
- Pull Request: #49
- Mode: review follow-up
- Base: `main` (`112198c33823a5fc6681399a19e0c5361614143f`)
- Reviewed implementation HEAD: `d1a2b5ffd69ca5154a426072c63942cfb3b177a6`
- Follow-up implementation HEAD before this report commit: `a1d87cbe455416fb4b5bc90ec515b596569a2e1f`
- Merge: not performed

## 対象finding

正式な再レビュー結果に従い、`T602-R001`, `T602-R003`, `T602-R004`, `T602-R005`, `T602-R006`, `T602-R007`, `T602-R008`, `T602-R009`, `T602-R010`, `T602-R011`を対象とした。`T602-R002`はレビュー側で撤回済みのため対象外とした。

## 変更

- `T602-R004`: `rev-parse`はexit 1だけをmissing revisionとして扱い、exit 128を含むその他の非0終了を`GitCommandFailedError`として保持した。
- `T602-R005`: current tree列挙例外を空候補へ変換しないようにし、current revision消失、invalid encoding、missing revision、読取例外を不完全証拠としてfail-stopさせた。
- `T602-R006`: snapshotで残存したreviewed range数をfile identity判定に使用しないよう変更した。same-path以外はunique exact-content identityが別途証明された場合だけsnapshot mappingを採用する。
- `T602-R007`: ContextとGlobalに共通するfile IDは両側のdestinationが一致する場合だけ保持し、片側欠落またはpath不一致は両側をunresolvedにした。
- `T602-R008`: latest pointerのsnapshot envelopeをrestoreし、expected scope/file IDと一致したsnapshotだけをmappingへ渡すようにした。
- `T602-R009`: 1回のmap処理内で`objectExists`観測をcacheし、availability precheckとdirect mapperが同じPromise結果を共有するよう変更した。
- `T602-R001` / `T602-R010`: delegate commit前のsnapshot invalidationを廃止し、永続commit成功後のsnapshot置換へ変更した。snapshot公開処理はprovider内で直列化し、後着した古いcommitが新しい世代を追い越さないようにした。post-commit snapshot失敗時は両pointerを未公開化し、永続commit自体の成功をsnapshot失敗として返さない。
- `T602-R011`: duplicate direct adapterをproduction経路では使用しない境界として明記し、copy metadataをstable identity移送として受理しないよう明示的にrejectした。
- `T602-R003`: 本report、PR本文、PRコメントをfollow-up後のHEAD状態へ更新する。旧implementation report/handoffは履歴証跡として改変せず、本reportで訂正する。

## テスト

追加した回帰テスト:

- `test/unit/local-git-tree-list.test.ts`: exit 128 fatalの回帰
- `test/unit/history-rewrite-recovery-conservative.test.ts`: reviewed-range survivalだけでidentityを選ばない回帰
- `test/unit/history-rewrite-review-findings.test.ts`: copy identity拒否

Red test commits:

- `f86d4837434ddedf7ff33920c56cfd3e44f04e80`
- `719aedfdcc884a0c16615250a6ade4c83dea71b5`

GitHub connectorで各commitをpushしたが、follow-up implementation HEAD `a1d87cbe455416fb4b5bc90ec515b596569a2e1f`に一致するpull-request workflow runは取得時点で存在しなかった。別SHAのrunは代用していない。したがってbuild、typecheck、lint、unit、focused、integration、VS Code Extension Hostの最終判定は**CI未実施**であり、成功とは扱わない。

## 変更commit

- `f86d4837434ddedf7ff33920c56cfd3e44f04e80`: fatal revision lookup Red test
- `719aedfdcc884a0c16615250a6ade4c83dea71b5`: snapshot identity Red test
- `97446d4a6ac9479b0c7e5dc3a540d802af5a7184`: fatal revision lookup修正
- `96ff43640378525682f992da4548aa2418f9737b`: object availability観測共有とtree failure保持
- `27d4c2387b08a5c68b7986aa9f7bee68fa5041e1`: snapshot identity証明分離
- `fabe78d4f5134be523be2b5a6db10aa4923d3f87`: catalog完全性、snapshot所有者、Context/Global整合
- `a68c21cf70f32867fcab6f256b85551b2bfea408`: post-commit直列snapshot公開
- `ddcdccb9415704cf2072fa600f9171dedc48dc2a`: copy identity拒否
- `a1d87cbe455416fb4b5bc90ec515b596569a2e1f`: copy回帰テスト

## 未確認・残存リスク

- current HEADに一致するCI runがないため、コンパイル・全テスト結果は未確認。
- connector経由ではローカル実行環境を使用していないため、Red commitの失敗artifactも未取得。既存workflowの失敗時artifact upload構成は維持されている。
- snapshot storage自体は複数pointerの原子的batch CASを提供しない。provider内直列化と失敗時invalidateで本PR内の競合を閉じたが、将来別provider instanceから同一pointerを更新する場合はT604のcross-window排他が必要となる。

## 次のaction

follow-up最終HEADに一致するCI runを実行・確認し、失敗時は同runのdiagnostic artifactだけを使用して修正する。その後、同じnormal reviewerによるfix verificationを行う。mergeは利用者が行う。
