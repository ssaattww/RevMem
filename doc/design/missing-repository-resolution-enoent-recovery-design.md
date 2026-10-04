# Missing repository resolution: ENOENT recovery design

## 目的

削除・移動済みdocumentを開いたままでも、Current Context、Review Contexts、Global Understandingを独立して更新できるようにする。候補単位のENOENTはその候補だけを無効として残りの候補を処理する。最寄りの存在祖先へ暗黙に遡ってrepository ownerを推測しない。composition側のvisible editor/fallback inspectionもresolverが検証した候補とownership boundaryを使い、document pathを別経路からGit cwdへ渡さない。

Current Contextのdocument候補はdocument自身でなく親directoryを一度だけinspectionする。親directoryも欠落していればその候補をskipし、opened document、known root、workspace folderの明示候補へ進む。workspace root候補はcomposition内でも再inspectionされるため、そこが消失していればそのworkspace candidateだけskipする。Global Understandingではrepository rootが存在する間、消失したactive folder scopeを空のscopeとして扱い、同じrepository内の他scopeを更新する。repository root自体が消失した場合は成功した空inventoryとして保存しない。

documentのrepository owner判定に使う境界はknown rootだけとする。workspace folderは列挙sourceであり、repository内subdirectory workspaceをrepository境界として扱わない。nested repositoryの所属が確定できないdocumentからouter rootを採用しない。明示された別candidateから有効なrepositoryを列挙する。

## 確認した現行コードと失敗経路

- `src/adapters/local-git/node-local-git-adapter.ts` の`normalizeInspectionStartPath`は実在fileならdirname、directoryならそのままを返す。statのENOENTだけは元pathを返してexecutorで再確認する。EACCES/EPERM等は伝播する。
- `src/adapters/local-git/local-git-adapter.ts` はcwdなしの`git --version`後、inspection start pathをcwdとして`rev-parse --show-toplevel`を実行する。
- `src/adapters/local-git/node-git-command-executor.ts` はGit起動前にcwdを`stat()`する。失敗は元のNode `ErrnoException`としてrejectし、code/syscall/pathを保持する。child spawnのENOENTはGit実行ファイル不在として別分類する。このexecutorの契約を変えない。
- `src/application/review-context/repository-resolution.ts` はactive document、opened documents、known roots、workspace foldersの順に候補を検査し、Gitが返すroot pathで重複排除する。候補自身のstat ENOENTは既にskipする。dirname inspectionがENOTDIRや別pathのENOENT等を返す場合は失敗する。候補列挙を止めるerrorの扱いは変えない。
- `src/composition/extension.ts`はresolverにdocument path、選択中contextのknown root、workspace folderを渡し、候補をCurrent Context snapshotに使う。visible editorの直接inspectionと`resolveFallback`の直接inspectionはresolverのdirname/stat ENOENT/nested ownership処理を迂回していた。workspace列挙はrepository resolver後に`isNonGitCurrentContextWorkspace`でもworkspace pathを再inspectionするため、消失workspace rootの候補単位ENOENT回復が必要。APIにdocument owner fieldはない。
- `src/adapters/repository-files/node-repository-file-path-enumerator.ts` の`enumerateDirectFolders`はactive folder scopeごとに`readdir(directory)`を呼び、エラーをそのまま上位へ返す。folder scopeがbranch切替後に消えていると一候補のENOENTでGlobal Understandingのfolder refreshが中断する。
- `src/composition/global-understanding/global-understanding-source.ts`はGlobalのfolder scope refresh失敗を`path-discovery` / `folder-scope-refresh`として診断する。Current Context候補解決とGlobal folder列挙は別経路であり、前者の成功が後者を回復させる保証はない。
- `test/unit/t609-repository-resolution.test.ts`はresolverの候補順、重複排除、stat ENOENT、EACCES等、nested boundary、Windows path比較を検証する。`test/unit/t610-folder-understanding.test.ts`はfolder scopeとGlobal sourceを検証するが、消失scopeのENOENT回復は未カバーである。
- `package.json`にはNode標準`node:test`、TypeScript build/test compile、ESLint、既存Git fixtureを使うtest scriptがある。

Global sourceは一度に一つのselected ownerを更新する。Current Contextが別workspace rootを選んだ後、そのownerをGlobal sourceへ設定して再計算する。消失rootと残存rootをGlobal sourceが並列に切り替える仕様はない。

実機ではbranch切替後、削除済みtabがactiveでもCurrent Context/Review Contextsのrefreshに成功する場合がある一方、Global folder refreshは同じ削除済みpathを含む間ENOENTで失敗し、tabを閉じると成功に戻った。これはCurrent ContextとGlobalが異なる候補集合・失敗境界を持つことを示す観測であり、原因をGlobal enumeratorの一箇所に断定するものではない。両経路を合成fixtureで個別に再現する。

## 実装契約

### Current Contextのdocument候補

`activeDocumentPath`/`openedDocumentPaths`はdocument pathとして扱い、resolverから`dirname(documentPath)`を一度だけinspectionする。dirnameが欠落し、そのcwdのstatがENOENTなら、そのdocument候補をskipする。親へ反復して遡らない。既存Node adapterのfile/directory正規化は保つ。

known rootとworkspace folderはpath自体をinspectionし、ENOENTなら当該候補だけskipする。候補ごとのinspection errorは次の全条件を満たす場合のみmissing candidateとする。

- `code === "ENOENT"`
- `syscall === "stat"`
- error `path`が候補cwdと同じfilesystem path（OSのseparator/case semanticsを適用）

別pathのENOENT、裸ENOENT、EACCES、EPERM、EIO、AbortError、GitExecutableNotFoundError、GitCommandFailedError、spawn error、Error以外のreject値は握りつぶさず、元の値のままrejectする。`node-git-command-executor.ts`のcwd stat契約は変更しない。

### nested repository境界とinventory

各document pathを含むknown rootから最深のpath boundary Bを選ぶ。選択結果はknown-root配列順に依存しない。workspace folderはboundary選択に含めない。

document inspectionのroot RがBの厳密な祖先なら、そのdocument由来candidateだけを抑止する。RがBと同じ、またはB内側のrootならdocument由来candidateを維持する。known boundaryがなければ別の所有根拠を推測しない。したがってnested treeと全中間directoryが消失しknown rootもない場合、active documentはskipされ、外側repositoryが別document等から解決されるならそのsourceで列挙される。

known-root candidateはinspection結果のrootがknown root path自身と一致する場合にinventoryに加える。Node adapterが実pathのrealpathで得たinspection start directoryとGit返却rootのcanonical identityがともに存在して一致する場合に限りdirectory-link aliasも加える。realpath失敗またはidentityがないadapterでは既存path一致に戻し、ancestor/descendantの別rootを採用しない。workspace-folderは列挙候補であり、owner boundaryではない。候補は既存source順に重複排除し、sourceは最初の有効なinventory evidenceを示す。

### Global Understandingの消失folder scope

`enumerateDirectFolders`でfolder scopeごとにdirectoryを列挙する際、ENOENTをskipできるのは、errorが`code === "ENOENT"`で`syscall === "scandir"`相当、かつ`path`がそのscopeの期待directoryとfilesystem path比較で一致する場合だけとする。Node実装で`readdir`の`syscall`値が異なる場合はテストで実値を確認して契約に明記する。ENOENT以外、別pathのENOENT、または分類できないエラーは従来どおり伝播する。Abortは常に伝播する。

scope単位で回復し、後続のlive scopeの列挙を続ける。消失scopeから返すfile/directoryは空とし、そのscopeに以前属したfileを次の成功snapshotから取り除く。消失folderの再帰探索、存在祖先へのfallback、別repositoryへの付け替えはしない。

repository root自身が消えている場合はmissing scopeとして成功扱いしない。root全体の削除を空repositoryとして確定すると誤った成功表示や不整合なowner stateを作るため、候補inspectionのerror boundaryへ伝播する。複数workspace rootではCurrent Contextの次回更新が消失rootを候補から除き、残存rootを選択してからGlobalをそのownerで再計算する。Global source自身に別rootの自動再解決callbackを追加しない。

既存Global sourceはscopeごとに成功分をaccept/publicationし、失敗scopeは旧行を保持したpartial表示になる。消失scopeをskipした場合、そのscopeは空の正常列挙として処理し、以前の消失file entryを除き、live sibling scopeの結果を更新する。別scopeの非ENOENT failure時は既存partial UI/retained rows契約を保つ。全scope atomic publicationへ変更しない。

## 回帰検証計画

既存の`createTemporaryGitRepository`、`test/unit/t609-repository-resolution.test.ts`、`test/unit/t610-folder-understanding.test.ts`、`test/unit/node-git-command-executor.test.ts`と既存のCurrent Context/Global source harnessを利用する。必要なら専用integration testを追加し、OS保護pathやACL変更を使わない。

### Current Context / Review Contexts

1. 実在directory内でdocument fileだけ削除する。dirname inspectionは成功し、候補sourceはactive-document。
2. documentとその親directoryを削除する。document候補だけskipし、後続opened document、known root、workspace folderの検査が続く。削除階層の途中にGit rootがあっても暗黙に採用しない。
3. branch切替で`fixtures/branch-switch-disappears.ts`を消し、別の`apps/web/src/app.ts`を残す合成Git fixtureを作る。削除済みdocument tabをactive/opened候補に残し、手動refresh後のCurrent ContextとReview Contextsが新branchへ揃い、残存file側のroot/branchを表示する。
4. known nested rootの`.git`だけを消し、document/tree/outer repositoryを残す。known nested boundaryの外にあるouter rootをdocument由来で採用せず、明示workspace candidateからouterを列挙する。
5. nested repository treeと全中間directoryを削除し、known root/workspace boundaryがない。active documentをskipし、outer rootが別opened documentから発見されたときだけopened-document sourceで一件となる。
6. nested documentのworkspace folderをrepository内subdirectoryにする。workspace subdirectoryはowner boundaryにならず、document sourceでrepository rootを得る。
7. known-root順を入れ替えてstale nested rootとvalid outer rootを両方指定する。deepest boundary判定とsourceが順序に依存しない。
8. stale ancestorとlive child nested repositoryを組み合わせる。live child rootをactive-document sourceで保持する。
9. 複数workspace rootの一つを削除し、残るrootのcandidateを列挙する。Current Contextから消失rootを除き、同じrootを復元した後は再検出する。root全削除を空の成功snapshotとして扱わない。

### Global Understanding folder refresh

10. branch切替でactive folder scope `fixtures`を削除し、`apps/web/src`を残す。inactiveの削除済みdocument tabは開いたままにする。Global refreshがmissing scopeだけ空扱いし、live scopeも処理し、旧branchの削除fileを新snapshotから除き、新branchのlive fileを含める。
11. 消失scopeが複数ある、全scopeが消失する、root直下scope `""`を含む場合を確認する。rootが存在する条件下で空scopeの扱いと古いfile entryの除去を確認する。
12. 削除済みtabを閉じた場合も成功する。これにより、tabのcloseが必要条件でないことを確認する。
13. repository rootを削除した場合はscope-levelのENOENT recoveryにしない。消失ownerを有効な空repositoryとして表示せず、複数rootの残存ownerを更新し、root復元後の再検出を確認する。
14. scopeの先行候補でENOENT、後続候補でEACCESまたはENOTDIRを注入する。missing scopeだけをskipし、後続の非ENOENT errorは元の値のまま伝播する。別pathのENOENT、裸ENOENT、AbortErrorも握りつぶさない。
15. sourceが成功scopeをacceptし、失敗scopeの既存file rowをpartial状態で保持する現行仕様を回帰確認する。ENOENT scopeは正常な空scopeとして受理され、該当旧entryを除去する。他scopeの失敗時に全root atomic publicationへ変更しない。

### path / adapter error境界

16. unitでWindows drive pathのcase/separator差を同一候補として扱い、異なるpathをrejectする。Error以外のreject値を元のまま伝播する。
17. adapterのstat境界を注入し、候補自身へのstat ENOENTだけ回復し、別pathのENOENTとEACCESは同じerrorのまま伝播する。OS保護pathへのアクセスやACL変更は行わない。
18. executorのcwd statがENOENTをrejectしcode/syscall/pathを保持する現行契約を回帰確認する。Git executableのspawn ENOENTがstat ENOENTと混同されないことも確認する。
19. directory link/junctionのrealpath identity一致時だけknown-root aliasを採用する。identity不一致・不在、独立したGit root、nested `.git`消失後のouter rootは採用しない。Windows case差と絶対path一致は維持する。

## 実行順と確認項目

1. 変更前にCurrent Context resolverとGlobal direct-folder enumerationの回帰を追加し、原因ケースがREDになることを確認する。
2. resolverのdocument inspectionをdirname一回へ限定し、候補固有のstat ENOENTだけ候補単位で回復する。ownership boundaryはknown rootのみに限定する。
3. Globalの消失folder scopeを候補単位で空として処理し、root消失・他error・cancellation・atomic snapshot publicationを保つ。
4. focused tests、Git/Current Context/Global関連suite、T609 Extension Host branch-switch/multi-root fixture、lint、build、architecture validationを実行する。
5. branch `design/repository-resolution-enoent-recovery`でcommit/pushしDraft PR #135を更新する。mergeせず、更新したexact HEADのCI結果を記録する。

依存追加・lockfile変更なし。既存のNode標準test runner、TypeScript、ESLint、Git fixtureを使う。private validation repository、GitHub connector/APIは今回使わない。

追加検証: Global direct-folder enumerationは開始前にrepository rootの存在を検証し、root自体のENOENTを空snapshotとして扱わない。scope単位ENOENTをskipする直前にもAbortSignalを確認する。Current Contextは現在のactive workspace candidateを以前のGit root保持より優先し、消失root内に開いたdocumentでは独立した生存candidateが一つだけなら復帰する一方、nested ownerを含む生存outer repositoryへの誤所属はunresolvedのまま保つ。
scope読取の最中にroot自体が消える競合も再現可能なfilesystem seamで検証し、missing-scope recovery時にrootを再statして消失を伝播する。active editorがない手動refreshや複数の独立survivorがある場合は既存Quick Pickへ委譲し、無関係な旧ownerを自動選択しない。
