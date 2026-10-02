# Missing repository resolution: ENOENT recovery design

## 目的

削除・移動済みdocumentを含むrepository候補が欠落しても、Current Contextのrepository列挙を残りの候補まで継続する。回復対象は「候補cwdそのものがstat時点で存在しない」と確認できた場合に限定する。Git実行ファイル不在、権限エラー、別I/O障害をmissing candidateとして扱わない。

documentが既知nested repositoryの配下にあり、そのrepositoryの所有状態を確認できない場合、そのdocumentを外側repositoryのownerとして採用しない。一方、workspace folderまたは有効なknown rootから明示的に発見した外側repositoryは、repository一覧に残す。repository inventoryとdocument-owner帰属は別の判定である。

この文書は実装と回帰検証の結果を反映する。新規依存・lockfile変更は行わない。

## 現行コードと失敗の発生源

- `src/adapters/local-git/node-local-git-adapter.ts` の `normalizeInspectionStartPath` は `stat(startPath)`でdirectory/fileを区別し、失敗時は現在すべての例外を握って元のpathを返す。
- `src/adapters/local-git/local-git-adapter.ts` の `inspectRepository` はcwdなしの`git --version`の後、inspection start pathをcwdにして`rev-parse --show-toplevel`を実行する。
- `src/adapters/local-git/node-git-command-executor.ts` はGit起動前にcwdへ`stat()`する。この`stat(cwd)`がENOENTなら、生のNode `ErrnoException`（`code`, `syscall`, `path`）を呼び出し元へrejectする。
- 同executorはspawn childの ENOENT を GitExecutableNotFoundError に包む。cwdなしの初回git --versionでこのerrorが出た場合、adapterはgit-unavailableを返す。cwdありのroot inspectionでcwd stat後にcwdが消えたTOCTOUでも同じspawn ENOENT経路となり、現在はGitExecutableNotFoundErrorとして報告され得る。この経路の実原因は一意に分けられないため、resolverはこれを候補cwd欠落へ変換しない。
- `stat(cwd)`成功後、spawnまでの間にcwdが消えるTOCTOUではspawn error経路となる。これは`GitExecutableNotFoundError`等として元の分類を保持し、missing candidateへ読み替えない。再試行は後続の独立したresolution呼び出しに任せる。
- `src/application/review-context/repository-resolution.ts` はactive document、opened document、known root、workspace folderのsource順に候補を検査し、Gitが返すroot pathで重複排除する。現状は一候補のrejectで残りの走査も中断する。
- 現行resolverの結果は`extension.ts`でrepository一覧/current context候補として消費される。documentのownerを返す独立fieldはないため、列挙候補の`source`をownerの証明として誤用しない。
- 既存確認先: `test/unit/t609-repository-resolution.test.ts`、`test/unit/node-git-command-executor.test.ts`、`test/integration/local-git-adapter.integration.test.ts`、`test/support/temporary-git-repository.ts`、`package.json`の`test:t609`。

## 設計

### 1. document由来のinspection start directory

通常のdocument pathは既存の`NodeLocalGitAdapter.normalizeInspectionStartPath`がstatでdirectory/fileを区別し、fileならdirnameをGit inspectionへ渡す。documentが既に削除されていれば同adapterは元pathを返し、executorのcwd statがENOENTを返す。resolverはdocument候補に限り、ENOENTの`path`が現在試したcwdと一致したとき、その親directoryを次のinspection startとして再試行する。親も存在しなければENOENTで上へ進み、最初にinspectionできた祖先で停止する。filesystem存在確認はapplication層で行わない。

known rootとworkspace folderはpath自体を検査し、ENOENTの候補だけをskipする。親へ遡らない。既存root/path比較にはOS path semanticsとcomponent境界を使う。空文字、NUL、unsafe URIの既存拒否を弱めない。

### 2. 欠落候補の狭い分類と責務

resolverは一候補の`inspectRepository(candidatePath)`で発生した例外を一括して握り潰さない。欠落として継続できるのは、Node filesystem `ErrnoException`がすべて次を満たす場合に限る。

- `code === "ENOENT"`
- `syscall === "stat"`
- `path`がその候補のinspection cwdと同じfilesystem pathである（OSのseparator/case semanticsを用いたpath比較）

message文字列や`code`だけでは判定しない。`GitExecutableNotFoundError`、`GitCommandFailedError`、`git-unavailable`結果、EACCES/EPERM/EIO、AbortError、通常Error、別pathに対するENOENTは候補欠落にしない。検証不能な形のerrorも元のobjectを保ってrejectする。

この根拠を保つため、既存`normalizeInspectionStartPath`は変更しない。stat例外を元pathの返却で握る既存動作の後に、executorが実候補cwdへstatを行う。resolverが回復するのはexecutorが実際の候補cwdに対してstatしENOENTを返した場合である。executorのcwd statが欠落しているときも、エラーを消したり`git-unavailable`へ変換したりせず、errno contractを維持する。

cwd stat成功からspawnまでのTOCTOUで発生したENOENTは回復しない。spawn errorはGit executable error経路に包まれ得るためであり、これをpath不在と推測するのは安全でない。ユーザーが再計算する次回resolutionではcwdの新状態を改めて検査する。

### 3. repository列挙とdocument-owner判定を分離

resolverは既存のsource順に候補を逐次inspectionする。各document candidateの判断時には、そのdocumentを含むknown rootとworkspace folderをfilesystem path semanticsで集め、別候補よりstrict ancestorである境界を外して最も内側の境界Bを求める。境界選択は配列順では変化しない。

document inspectionがrepository root Rを返したときだけ、Bがあり、RがBの厳密な祖先なら、そのdocument由来candidateを抑止する。RがBと同じ、またはBの内側（RがBの子孫）なら維持する。関連boundaryがなければ現行どおり候補にできる。各documentにboundaryを個別に求めるので、nested workspace内documentの判定でouter workspace boundaryを外してしまうことはない。

inventoryはdocument判定と独立してsource順に続ける。有効なknown-root candidateはinspection rootがknown root path自身と一致する場合だけ列挙する。stale known rootがancestor rootを返してもknown-root sourceからは追加しない。明示workspace-folderから見つかったouter repositoryは、document candidateが抑止されてもinventoryに追加する。root重複時は最初の有効sourceを維持する。sourceはinventory evidenceでありdocument ownerの証明ではない。

各documentについてpath包含関係にあるknown rootのうち最も内側のboundary Bを使う。RがBのstrict ancestorならdocument由来のRだけを抑止し、B自身またはB内のroot Rは抑止しない。このためstale ancestorの下に実在する独立nested repositoryは表示される。比較はpath separator境界とOS path semanticsに従い、repo2をrepoの子と誤認しない。

documentはsource順でknown rootより先に処理されるため、boundaryの存在はinspection結果に関係なくinput pathsから先に求める。root candidateの除外後も明示outer候補のinspectionは続き、配列順にかかわらずknown-rootの厳密なroot一致を検証する。出力順とsource表示は残ったevidenceのdeterministic source orderに従う。既存APIにowner fieldは追加せず、誤帰属抑止はdocument由来candidateの除外で表現する。

### 4. 失敗とowner状態の分類

| inspection / evidence | 候補走査 | repository inventory | document owner |
| --- | --- | --- | --- |
| live document候補がrepository root Rを返す | 継続 | stale known-root scope外ならRを追加 | 候補として解決 |
| known rootが自身のroot Rを返す | 継続 | Rを追加 | document実rootが同じ/内側なら帰属を維持 |
| known nested rootがENOENT / not-repository / 別rootを返す | 次候補へ（ENOENTのみreject回復） | stale known-root candidateからは追加しない。明示outer候補は別に追加 | inputの最内boundaryを基準にRがstrict ancestorの場合だけ抑止。同じ/内側の実rootは維持 |
| workspace folderがouter root Rを返す | 継続 | Rを追加 | sibling/descendant documentのowner証明にはしない |
| exact candidate cwd `stat`のENOENT | 当該候補のみskip | 後続の明示候補で発見可能 | known root由来なら当該scopeを評価対象にする |
| spawn/Git executable ENOENT、EACCES、EPERM、EIO、別I/O | 元error/result分類を保持 | 他候補への暗黙迂回なし | unknownとして維持 |

## 回帰テストと実行結果（TDD）

### 先にREDにする実filesystem統合回帰

新しいtest fileやscriptは増やさず、既存fixtureを使う`test/integration/local-git-adapter.integration.test.ts`に回帰を先行追加した。実装前に次のrunnerで5件の失敗を確認した。

`npm run compile:test && node --test test-dist/test/integration/local-git-adapter.integration.test.js`

1. **document file削除、親directory残存**: REDでexecutor cwd stat ENOENT、実装後にactive-document sourceで成功。
2. **nested .git metadata削除、document/outer repo残存**: REDでsourceがactive-documentとなり誤帰属、実装後はdocument候補を抑止し、workspace-folder sourceでouterを一件列挙。
3. **nested repository directory全消失**: REDでENOENTが全走査を中断、実装後nested candidatesをskipしouterと別workspace rootを列挙。
4. **明示outer known root**: stale nested known rootと有効outer known rootの順を入れ替え、どちらもouterを一件だけknown-root sourceで列挙。
5. **stale ancestor配下のlive nested root / multi-root**: stale ancestor `.git`だけを削除し、その下のlive child repositoryはactive-document sourceで維持。ancestor/child known-root配列順双方で実行し、outer workspaceも別に残す。

nested fixtureは`createTemporaryGitRepository`でouter repoを作り、その配下へ`git init`と初回commitでnested repoを作る。`.git`のみの削除とnested directory全体の削除を別ケースにし、実Gitの`rev-parse --show-toplevel`でroot期待値を検証する。権限ACLは変更しない。

### 単体・分類テスト（integration REDの後に追加・実行）

`test/unit/t609-repository-resolution.test.ts`で、候補cwdと完全に対応する`{code: ENOENT, syscall: stat, path: candidatePath}`だけの回復、EACCESと別pathのENOENTの伝播、stale known rootが親rootを返す場合の非採用、複数documentに対する個別の最内boundaryを検証する。executor cwd stat契約とGitExecutableNotFoundError/invalid cwdの既存テストも変更せず通過する。

`test/unit/node-git-command-executor.test.ts`のmissing cwdテストでは`ENOENT`に加えて`syscall === "stat"`および`path === missingDirectory`を確認する。processFactoryがchildのerror eventにspawn ENOENTを出す単体ケースを用意し、executorが`GitExecutableNotFoundError`を返すこと、resolverがこれを候補欠落としてskipしないことを確認する。既存adapter統合のmissing Git executableテストは`git-unavailable`分類を維持する。

T609既存caseのsource順、canonical root dedup、URI境界、not-repository/git-unavailable結果も回帰する。mock単体だけでなく実Git fixtureを通している。

### TDD実行順

1. 5件のintegration回帰を先行追加し、現行実装で5件全てのREDを確認。
2. resolverに候補cwd ENOENT分類、documentの親path retry、document別の最内boundary判定、known-root exact-root validationを実装。executor契約は変更しない。
3. unit分類回帰を追加し、5件の実Git integrationとunitをGREENで確認。
4. 実行済み: `npm run compile:test`、focused T609 + local Git adapter integration/unit tests（17 pass）、`npm run test:git`（40 pass, 3 platform skips）、`npm run test:i116`（22 pass）、`npm run lint`（0）、`npm run validate:architecture`（pass）。
5. 追加最終確認後、通常のcommit/pushとDraft PR #135の更新を行い、同一headのCI全jobを確認する。mergeしない。

## 依存・スコープ

既存のNode `node:test`、TypeScript test compile、Git実行と`temporary-git-repository` fixtureだけを使用する。新規依存は不要。test scriptの追加も不要で、TDD用runnerは既存integration出力へ直接`node --test`を実行する。

`node_modules`がない環境ではTypeScript compile runnerを実行できない可能性があるため、lockfile依存のinstall/restoreはユーザー承認なしに行わない。

private validation repositoryとGitHub connector/APIは使用しない。公開コードと合成temporary Git fixtureだけを使う。mergeは行わない。
