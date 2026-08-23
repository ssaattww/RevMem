# Sub-agent実行レポート

## タスク

- Issue #78 / PR #83 の独立final reviewで確定した `T610-IFR-001`〜`003`を、同一batchで実装・検証する。

## sub-agentを使う理由

- 独立reviewerはfinding確定だけを担当し、実装は親workerが既存T610 compositionとlifecycle ownershipを保ったまま行うため。

## 対象範囲

- durable stopのrestore-before-mutation、running snapshotのI/O前publication、resume marker削除失敗時のtransactional state、focused regression、T610機能gate、static gate。

## 対象外

- 性能workload、CI、GitHub操作、設計本文・BreakingChanges・tracking・historical reportの変更、独立closure判定、merge。

## 実行コマンド

- Red: `npm run compile:test`後、`node --test --test-name-pattern='T610-IFR-00[123]' test-dist/test/unit/t610-folder-understanding.test.js`を1回実行し0/3。
- Green: 同じfocused commandを1回実行し3/3。`npm run test:t610`は69/69、`npm run build`、`npm run lint`、`git diff --check`は成功。
- T607性能test、Extension Host、CIは0回。

## 対象ファイル

- `src/application/global-understanding/folder-understanding-scope-controller.ts`
- `src/t505-global-understanding-source.ts`
- `src/ui/global-understanding/global-understanding-ui-model.ts`
- `src/t305-extension.ts`
- `test/unit/t610-folder-understanding.test.ts`
- 本report

## 指摘事項

- `T610-IFR-001`: owner restoreを単一promiseで直列化し、durable markerを既存session recordより優先。open/start/stop/resumeはmutation前にrestoreをawaitし、stopped openはsubtree enumeration前に終了する。
- `T610-IFR-002`: recalculationは各scopeの`begin()`直後、content I/O前にrunning folder snapshotをrefresh hostへpublishする。公開された同一rowからstopするとscope signalがabortし、stale contentをpublishしない。
- `T610-IFR-003`: resumeはdurable marker削除をcommit pointとし、成功後だけdescendant・state・generationを遷移する。fallback storeもadd/remove mutationを保存集合へ適用する。

## 検証結果

- Red: IFR001はmarker load未実行、IFR002はrunning progress未publish、IFR003は失敗後state=`running`をそれぞれ実測。
- Green: default false/trueのstartup openはいずれもstopped、running row stopはowner content capture 0、resume保存失敗はstopped/activeFolders空を維持。
- Markdown専用lintはrepositoryに`tools/lint/`と`lint:md` wiringがなくunsupported。既存設定は変更していない。

## 最終結果

- `T610-IFR-001`〜`003`はlocal-ready。独立reviewerのfinding-limited closure、current-head focused Host、attestation、exact-head non-performance CI、mergeを残す。
