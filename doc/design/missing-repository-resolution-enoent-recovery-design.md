# Missing repository resolution: ENOENT recovery design

## 目的

削除・移動済みdocument pathを含むCurrent Contextのrepository列挙を継続する。ENOENTによる回復はdocumentが直接指すdirectory一つをinspectionする範囲に限定する。documentの親directoryも欠落している場合、そのdocument候補はskipし、別に明示されたknown root/workspace folder/document候補の探索へ進む。最寄りの存在祖先まで自動で遡らない。

documentのrepository owner判定に使う境界はknown rootだけとする。workspace folderは列挙sourceであり、通常のrepository内subdirectory workspaceをrepository境界として扱わない。documentがknown nested repositoryのownerと確定できない場合、そのdocumentのinspectionで外側rootが返ればdocument由来候補を除外し、明示的な別候補からouter repositoryを一覧化する。

## 現行コードとerrorの発生元

- `src/adapters/local-git/node-local-git-adapter.ts` の`normalizeInspectionStartPath`は実在fileならdirname、directoryならそのままを返す。statのENOENTだけは元pathを返してexecutorで再確認する。EACCES/EPERM等は同adapterから伝播する。
- `src/adapters/local-git/local-git-adapter.ts` はcwdなしの`git --version`後、inspection start pathをcwdにして`rev-parse --show-toplevel`を実行する。
- `src/adapters/local-git/node-git-command-executor.ts` はGit起動前にcwdを`stat()`する。その失敗は元のNode `ErrnoException`としてrejectし、code/syscall/pathを保持する。child spawnのENOENTはGit実行ファイル不在として別分類される。
- `src/application/review-context/repository-resolution.ts` はactive document、opened documents、known roots、workspace foldersの順で候補を検査し、Gitが返すroot pathで重複排除する。一候補のrejectで残りの走査が中断していた。
- `src/composition/extension.ts`はresolverにdocument path、選択中contextのknown root、workspace folderを渡し、候補をCurrent Context snapshotに使う。APIにdocument owner fieldはない。

## 実装契約

### document inspection start

`activeDocumentPath`/`openedDocumentPaths`はdocument pathとして扱い、resolverから`dirname(documentPath)`を一度だけinspectionする。dirnameが欠落しておりそのcwdのstatがENOENTなら、そのdocument候補をskipする。親へ反復して遡らない。既存Node adapterのfile/directory正規化は保つ。

known rootとworkspace folderはそのpath自体をinspectionし、ENOENTなら当該候補だけskipする。候補ごとのinspection errorは次の全条件を満たす場合のみmissing candidateとする。

- `code === "ENOENT"`
- `syscall === "stat"`
- error `path`が候補cwdと同じfilesystem path（OSのseparator/case semanticsを適用）

別pathのENOENT、裸ENOENT、EACCES、EPERM、EIO、AbortError、GitExecutableNotFoundError、GitCommandFailedError、spawn error、Error以外のreject値は握りつぶさず、元の値のままrejectする。executorのcwd stat contractは変更しない。

### nested repository境界とinventory

各document pathを含むknown rootから最深のpath boundary Bを選ぶ。選択結果はknown-root配列順に依存しない。workspace folderは境界選択に含めない。

document inspectionのroot RがBの厳密な祖先なら、そのdocument由来candidateだけを抑止する。RがBと同じ、またはB内側のrootならdocument由来candidateを維持する。known boundaryがなければ別の所有根拠を推測しない。したがってnested treeと全中間directoryが消失しknown rootもない場合、active documentはskipされ、外側repositoryが別document等から解決されるならそのsourceで列挙される。

known-root candidateはinspection結果のrootがknown root path自身と一致する場合にinventoryに加える。Node adapterが実pathのrealpathで得たinspection start directoryとGit返却rootのcanonical identityがともに存在して一致する場合に限り、directory-link aliasも加える。realpath失敗またはidentityがないadapterでは既存のpath一致に戻し、ancestor/descendantの別rootを採用しない。workspace-folderは列挙候補であり、そのsubdirectoryがGit rootより内側でもworkspace-folderをowner boundaryには使わない。候補は既存source順に重複排除し、sourceは最初の有効なinventory evidenceを示す。

## 回帰検証

実Git fixtureは既存`createTemporaryGitRepository`を利用し、既存unit/integration test fileへ追加する。確認するケース:

1. 実在directory内でdocument fileだけ削除: dirname inspection成功、repository sourceはdocument。
2. nested repositoryの`.git`だけを削除しdocument/tree/outer repoを残す: known nested boundaryより外のouter rootをdocument由来にせず、明示workspace候補からouterを列挙。
3. nested repository treeと全中間directoryを削除、known root/workspace boundaryなし、outer rootは別opened documentから発見: active documentはskip、outerはopened-document sourceで列挙。親祖先をたどらないことを確認。
4. nested documentのworkspace folderをrepo内subdirectoryにする: repository rootとdocumentを解決しsourceはactive-document。workspace subdirectoryはowner boundaryではない。
5. known-root順を入れ替え、stale nested rootと有効outer rootを両方指定: outer rootはknown-root sourceで一件。
6. stale ancestor下にlive child nested repository: root childはactive-document sourceで維持。
7. unitでWindows drive pathのcase/separator差を同一候補として扱い、異なるpathをrejectすること、Error以外のreject値を元のまま伝播することを確認。
8. Node adapterのstat境界を注入し、EACCESは同じerrorのまま伝播し、候補自身へのstat ENOENTだけ保持し、別pathのENOENTは伝播することを確認する。OSの保護pathへアクセスせず、ACLを変更しない。
9. 実directory link/junctionのrealpath identity一致時だけknown-root aliasを採用し、2つの独立した実Git rootのidentity不一致とnested .git消失後のouter root解決は拒否する。identity不在時のdisjoint pathは拒否し、絶対path一致とWindows case差の従来判定は維持する。

## 実行順と現在の結果

1. 新integration/unit回帰を実装変更前に追加しREDを確認。
2. documentのinspectionをdirname一回へ限定し、ownership boundaryをknown rootだけにする。Windows path error比較に共通filesystem path比較を使う。Node adapterのstat catchを候補start pathのENOENTに限定し、権限errorは直接伝播。
3. focused tests、Git/Current Context関連suite、lint、build、architecture validationを実行。
4. branch `design/repository-resolution-enoent-recovery`上でcommit/pushしDraft PR #135を更新。mergeは行わずexact-head CI結果を記録する。

依存追加・lockfile変更なし。private validation repositoryやGitHub connector/APIは使用しない。
