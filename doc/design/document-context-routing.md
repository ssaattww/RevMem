# Document Context Routing and Review State Ownership

## 1. 目的

本書は、VS Codeの通常エディタで開かれたfilesystem-backed documentについて、次の機能契約を一体として定義する。

- レビュー状態を所有するcontextの解決
- Repository、Context、Fileのidentity
- ownerごとの保存先と永続化境界
- context変更時のRepository Global継承
- owner変更時の確認済み範囲のreconciliation
- VS Code Extensionとの接続

本書は変更要求や実装タスクの記録ではなく、document review state ownership機能の継続的な設計を扱う。

## 2. 適用範囲

対象は、VS Codeの通常エディタで既に開くことができているfilesystem-backed documentとする。

対象外:

- `untitled` document
- diff内部URI
- Git仮想document
- queryまたはfragmentを持つ非標準filesystem document

## 3. Ownerモデル

### 3.1 優先順位

```text
pull-request > Git branch/detached > non-Git workspace > external-file
```

高いownerが利用可能になった時点で、以後のactive writeは高いownerだけへ行う。旧ownerへの恒久的な二重書き込みは行わない。

### 3.2 Owner解決順

レビュー状態のownerはworkspace membershipより先にGit working treeへの所属で決定する。

```text
対象document
  ↓
documentの親directoryからLocal Git inspection
  ↓
Git working treeを検出
  ├─ pull requestを一意に解決できる → pull-request context
  ├─ attached branch                 → branch context
  └─ detached HEAD                   → detached commit context

Git working treeを検出しない
  ├─ workspace folderに所属          → non-Git workspace context
  └─ workspace folderに非所属        → external-file context
```

Pull Request context resolverが未接続の環境では、Git管理下のdocumentをbranchまたはdetached HEAD contextへ解決する。resolver接続後もGit ownershipを先に決定する規則は変更しない。

### 3.3 Current ContextとRepository解決

Current Context、Review Contexts、PR取得、Git revision mappingは、active editorの存在またはそのdocumentがGit管理下であることをrepository解決の前提にしない。解決要求ごとに次の順序で候補を収集し、同一のcanonical repository rootへ正規化して重複を除く。

1. active editorがfilesystem-backedかつGit working tree配下なら、そのrepository
2. active editorでなくても開かれているGit documentのrepository
3. 明示選択済みのCurrent Contextまたは、同一Extension Host内で検証済みかつ現在も有効な既知root
4. 開かれているworkspace folder自体、またはその配下から検出したGit repository
5. 残った複数候補に対するQuick Pickの明示選択

1から4で候補が一意ならそのrepositoryを使う。候補が0件なら操作はrepository未解決として停止し、候補が複数なら自動的な先頭選択、folder名比較、以前の表示順による推測をしない。Quick Pickの取消、選択結果と再検証後のrootの不一致、削除済みまたは到達不能になった既知root、URI境界を越えるroot、workspace-side Extension Hostでfilesystem pathへ安全に変換できないremoteまたはvirtual URIは、いずれもfail-closedである。このときReview Contexts全体の既存表示・保存済み状態を別repositoryへ流用せず、選択操作だけを中止する。

Remote SSH、Dev Containers、Codespacesのように、workspace-side Extension Hostが開いたworkspace folder URIから同じauthorityのfilesystem pathを得られる場合は5.5節のremote workspace規則に従って候補化できる。UI側だけで観測したremote URI、Git仮想document、queryまたはfragment付きURIをroot候補へ降格または昇格させてはならない。したがってactive editorがない場合、またはactive editorが非Git documentの場合も、Git管理workspaceが開かれていればrepository操作を継続できる。

## 4. Git inspection

### 4.1 Git管理判定

Git管理判定は`git ls-files`への登録有無ではなく、documentがGit working tree root配下にあるかで行う。untracked fileもworking tree配下であればそのrepositoryに所属する。

### 4.2 Git unavailable

Git executableを利用できない場合は、現在のworkspace membershipに応じて一時的にfallbackする。

- workspace所属: workspace context
- workspace非所属: external-file context

後からGit ownershipを解決できた場合は本書7章のreconciliationを適用する。

### 4.3 Git command failure

Git executable不在と`not-repository`以外の実行失敗を非Gitとして扱わない。権限、timeout、破損repositoryなどの失敗は通知し、別ownerへ新規保存しない。

`git rev-parse --verify HEAD^{commit}`はGit processのlocaleをCへ固定し、exit code 128かつ既知のunborn診断`fatal: Needed a single revision`だけをmissing HEADとして扱う。その他のexit code 128は`GitCommandFailedError`として伝播する。

### 4.4 Inspection境界

1回のwritable `open`では、active ownerを決定するLocal Git inspectionを1回だけ行う。

reconciliation済みsessionを返した後に、同じdescriptorをread-only decoration経路へ再投入してownerを再解決してはならない。read-only decorationは別操作としてownerを解決してよいが、状態の初期化や永続化を行わない。

## 5. Identity

### 5.1 Git context

```text
Repository ID
  = normalized identity remote
  または hash(canonical repository root URI)

Context ID
  = hash(Repository ID + full branch ref)
  または hash(Repository ID + detached HEAD)

File ID
  = hash(Repository ID + repository-relative path)
```

絶対パスはGit File IDへ含めない。同一repositoryを別の場所へcloneした場合でも、remoteとrepository-relative pathが一致すれば同じ論理ファイルとして扱う。

attached branchはHEAD commitを`headRevision`とする。unborn branchはbranch refから安定した一時revisionを生成する。detached HEADはHEAD commitをrevisionとし、Context IDにも含める。

HEAD変更時はrevision mapping機能が確実に対応付けた範囲だけを移行する。mappingされていない旧状態を新HEADへ無条件に再ラベルしない。

### 5.2 Non-Git workspace context

Git working treeを検出せず、documentがworkspace folderに所属する場合はworkspace contextをownerとする。

workspace identityはworkspace folder URIとworkspace-relative pathから導出する。Git ownershipが検出された場合、この経路へ入らない。

### 5.3 External-file context

Git working treeにもworkspace folderにも所属しないfilesystem-backed documentを`external-file` contextとして管理する。

external fileはcanonical URIを完全なlocatorとして保持する。

```text
C:\Source\Example.cs
→ file:///c:/source/example.cs

\\BuildServer\Share\Source\Example.cs
→ file://buildserver/share/source/example.cs
```

Windows semanticsではscheme、authority、drive、path casing、separatorを正規化する。POSIX semanticsではpathの大文字小文字とbackslash文字を保持する。

```text
External Repository ID = hash(canonical document URI)
External Context ID    = hash(canonical document URI)
External File ID       = hash(canonical document URI)
```

各IDはdomain prefixを分離してSHA-256化する。canonical URI自体もcontext descriptorとfile `currentPath`へ保存し、ハッシュだけにしない。

### 5.4 UNC

UNC server addressはURI authorityとして保持する。異なるserver上の同じshare/pathは異なるFile IDである。

VS CodeのUNC securityを迂回しない。

- `security.restrictUNCAccess`で拒否されたresourceは新規登録しない
- `security.allowedUNCHosts`またはユーザー確認により開けたresourceは通常どおり保持する
- 一時的に到達不能になっても既存状態を自動削除しない

### 5.5 Multi-root と remote workspace URI

workspace membershipはUI側のlocal pathやfolder名ではなく、workspace-side Extension Hostが観測したURIの`scheme`、`authority`、正規化pathで決定する。候補rootのうち、document URIとscheme・authorityが一致し、そのpathがdocument pathの厳密な親であるものだけを候補にする。候補が複数ある場合は最長pathのrootを選ぶ。同じ最長canonical URIが複数存在して一意に選べない場合はfail-closedでworkspace ownerを選ばない。

この規則により、入れ子root、同一名root、同じpathだが異なるremote authorityを区別する。`untitled`、virtual URI、queryまたはfragmentを持つURI、workspace外URIはworkspace ownershipへ降格させず、通常editorの操作対象外またはexternal-file ownerの既存規則で扱う。Remote SSH、Dev Containers、Codespaces相当の`vscode-remote` URIはauthorityをidentityへ含め、Extension Hostが稼働する側のfilesystem semanticsとGit adapterだけを使用する。

### 5.6 Document encoding hint

VS Code 1.125以降で開かれた`TextDocument.encoding`は、filesystem-backed documentのfile単位encoding hintとする。live documentの本文は常に同じdocumentの`getText()`を使用し、Git revisionのraw byte blobは対応するhintを指定してVS Code `workspace.decode`でdecodeする。hintはrepository identityとstable file identityに結び付け、同一repository内のShift-JIS、UTF-8、UTF-8 BOMを混在させても他fileのowner、context、mapping、Global stateを変更しない。

hintは開かれたdocumentの観測値であり、repository全体への既定encoding、保存形式の推測、未open fileへの継承には使用しない。一意なrenameまたはmoveでfile identityが維持されるときだけhintを引き継ぐ。copy、add、分割、統合、曖昧なrenameはhintを継承しない。`onDidChangeTextDocument`またはencoding設定変更により同一documentのencodingが変わった場合、旧hintで得たrevision本文・content hash・line mappingを再利用せず、新hintでdecodeして対象fileだけを再計算する。restart後は開いているdocumentから再観測するまで、保存済みhintを根拠に未open fileをdecodeしない。

hintがない、VS Codeが受理しない、またはraw byte列を完全にdecodeできない場合は、当該fileをline-review対象外またはunresolvedとして隔離する。replacement characterによる救済、encoding自動判定、別file hintの流用は行わない。binary判定はdecodeに先行し、binary・unsupported encoding・invalid encodingの各理由をfile単位で保持する。

## 6. Review State Storage

### 6.1 共通原則

- context stateとRepository Global stateは同じowner identityに属する
- context stateはcontextごとに独立する
- Repository Global stateはownerごとに1つだけ存在し、context間で共有する
- 更新はcontextとGlobalの完全snapshotを一体として扱う
- atomic committerは`expected`と現在snapshotを比較し、両stateを同時に置換する
- contextだけ、Globalだけを更新する公開transaction APIを設けない
- stale expectationは拒否し、部分保存しない
- content hash、revision、line count、current pathが現在documentと一致しないfile stateは利用前に無効化する

owner reconciliation metadataは、公開された`ReconciledReviewContextState`と`OwnerReconciliationSourceSnapshot`を正式な永続化contractとする。基本`ReviewContextState`は全context共通fieldを表し、reconciliation metadataを保持するcontextだけが専用subtypeを使用する。

`ownerReconciliation`はschema version 1のoptional additive sectionである。metadataを持たない既存stateは有効であり、保持する場合は全keyとsnapshot fieldを検証する。

### 6.2 Git repository storage

Git ownerの状態はVS Codeの`globalStorageUri`配下へrepository単位で保存する。

```text
globalStorageUri/
  repositories/
    <repository-id-hash>/
      manifest.json
      contexts/
      global-state/
      history/
      snapshots/
      cache/
      lock
```

repository manifestは複数のcontext参照と、1つのowner-wide Global参照を持つ。workspace内外で保存先を変えない。同じRepository IDを持つcloneは同じ論理repositoryとして扱う。

### 6.3 Non-Git workspace storage

Git working treeに所属しないworkspace documentは、workspaceの`ExtensionContext.storageUri`配下でworkspace identityごとに分離したrootを使用する。root IDはcanonical workspace URIから導出し、folder名やUI側local pathを含めない。

```text
storageUri/
  workspaces/
    <workspace-id-hash>/
      workspace-state.json
      history/
      snapshots/
      lock
```

workspace contextは同一root内の複数fileで共有する。対象file stateが存在しないことと、workspace context自体が存在しないことを区別する。各rootはstate、history、snapshot、lock、cleanupの独立したT604 storage-root契約を持ち、root Aの操作がroot Bのpointer、履歴、snapshot、leaseへ到達してはならない。

Git history-rewrite recovery用snapshotはworkspace provider wrapperの有無に依存しない安定したproduction capabilityとして構成する。workspace commandのcommitは選択rootのsnapshot-aware committerを通過し、reconciliation wrapperもそのcapabilityを透過する。startup migrationは`workspaces/`配下のhash rootを列挙し、root nameとstate owner identityを照合した後、各rootのstate、全history月、snapshot metadataを同じroot lock下でeagerに処理する。

### 6.4 External-file storage

Git working treeにもworkspaceにも所属しないdocumentは、canonical document URIから導出したowner identityごとに保存する。

```text
globalStorageUri/
  external-files/
    <external-repository-id-hash>/
      manifest.json
      contexts/
      global-state/
      history/
      snapshots/
      cache/
      lock
```

VS Codeの`globalStorageUri`とRevMemのGlobal確認済みlayerは別概念である。canonical URIはハッシュだけでなく、context descriptorとfile `currentPath`にも保存する。

### 6.5 Ownerとcontextの存在状態

永続化層は次を区別する。

```text
owner未作成
  manifestまたはworkspace stateが存在しない

owner作成済み・対象context未作成
  owner-wide Globalは存在するが、対象Context IDのstateは存在しない

対象context作成済み
  context stateとowner-wide Globalの両方が存在する
```

対象contextの`load`が`undefined`でも、owner-wide Globalが存在する可能性がある。新context初期化では、contextの有無とは独立して最新Globalを読み出す。

### 6.6 新context初期化

新contextを空のcontext stateとして作成する場合、Globalを空で初期化して既存Globalを上書きしてはならない。

新context初期化の入力は、対象Context ID、現在のGit snapshot、対象contextの不存在期待、およびowner-wide Globalの存在状態を含む完全snapshotとversionの期待値とする。contextの不存在確認、Globalの期待値検証、next contextとnext Globalの公開は、同じatomic create/CASで行う。

1. 同一storage rootのwrite queueを取得し、対象contextとowner-wide Globalを同じplanning開始snapshotとして読む
2. 対象contextがすでに存在する場合は新規作成を行わず、通常の読み込み規則へ戻す
3. owner-wide Globalが現在contextと同じrevisionなら、そのGlobalを新contextの初期snapshotへ継承する
4. owner-wide Globalが異なるrevisionなら、planning開始snapshotだけを入力にGit diff mappingを計画する。mapping結果は新contextとGlobalの完全なnext snapshotへ反映し、mapping中に保存しない
5. 対象contextがなお存在しないこと、およびowner-wide Globalが期待した存在状態、完全snapshot、versionと一致することを確認する1回のatomic create/CASで、context stateと確定したGlobalを同じmanifest-last writeで公開する
6. create/CASがstaleなら、contextまたはGlobalのどちらも公開せず`stale`を返す。呼び出し側は最新owner-wide Globalを再読込し、そのsnapshotからmappingを再計画する

新context作成と同時に呼び出し側が非空Globalを明示的に提示する保存処理は、空初期化とは区別する。明示的Global更新は既存の保存契約に従う。

新context初期化、通常save、CAS commitは同一storage rootの同じ直列化境界を通過する。直列化だけを根拠に、読込、mapping、保存を別operationとして成功扱いしてはならない。別instanceまたは別contextの更新を検出できる上記CASを必須とする。

### 6.7 読み込みとvalidation

writable sessionを開くとき:

1. ownerとrepository targetを解決する
2. context stateとowner-wide Globalを読み込む
3. contextが未作成なら6.6の規則で初期化する
4. repository、context、schema、revision identityを検証する
5. `ownerReconciliation`が存在する場合はsource identity、line count、interval、timestampを検証する
6. 現在documentに対してstaleなfile stateだけを除去する
7. detached cloneをsessionへ返す

read-only decorationでは未保存snapshotを作成しない。stale file stateは返却するcloneから除外してよいが、読み込みだけでdiskを変更しない。

malformedなreconciliation metadataは無視、削除、または空baselineへ変換せず、persistence errorとして拒否する。

各`OwnerReconciliationSourceSnapshot`について次を強制する。

- `lineCount`は非負のsafe integer
- interval境界は非負のsafe integer
- `startLine < endLineExclusive`
- `endLineExclusive <= lineCount`
- source identityは空文字ではない
- timestampsは有効なISO 8601

このvalidationはsave、load、transactionの`expected`と`next`のすべてで実行する。

### 6.8 Atomic transaction

review operationとowner reconciliationは次のtransaction contractを使用する。

```text
expected:
  context state: absent | complete context state
  owner-wide Global state: absent | complete owner-wide Global state
  owner-wide Global version: absent | expected version

next:
  complete context state
  complete owner-wide Global state
```

committerは次を保証する。

- `expected`が現在値と一致する場合だけ置換する
- 新context作成ではcontextの不存在とGlobalの存在状態、完全snapshot、versionを同時に検証する
- contextとGlobalを両方置換するか、どちらも置換しない
- stale writeを成功扱いしない
- staleな新context初期化は`stale`として返し、最新Globalから再計画するまで同じmapping結果を再使用しない
- failure後に部分的なnext stateを公開しない
- `expected`と`next`のreconciliation metadataを保存前に検証する

## 7. Owner Reconciliation

### 7.1 移行元候補と観測

Git ownerへ移行するとき:

1. 同じdocumentのworkspace state
2. 同じcanonical URIのexternal-file state

workspace ownerへ移行するとき:

1. 同じcanonical URIのexternal-file state

移行元候補はすべてread-onlyで読み込んでから、新ownerのnext snapshotを計算する。候補ごとに永続化commitを分けてはならない。

同じwritable `open`中、各lower ownerは1回だけ観測する。初回昇格範囲、delta、baseline metadataはすべて、その1回のimmutable source snapshotから計算する。

### 7.2 確実性条件

次をすべて満たすsourceだけを移行または再調整の対象とする。

- 現在のcontent hashが一致する
- 現在のline countが一致する
- sourceのfile stateがsource revisionに対して確実である
- targetのfile stateがtarget revisionに対して確実である

不一致または曖昧な場合は範囲を変更しない。revision mappingまたはsnapshot diff mappingが確実に対応付けた範囲だけを移行できる。

### 7.3 Source baselineとincarnation

上位contextはlower ownerごとに、最後に確実に確認したsource snapshotを`ownerReconciliation` metadataとして保持する。

baselineは次を含む。

- source owner
- source Repository ID
- source Context ID
- source File ID
- content hash
- line count
- reviewed intervals
- source context `createdAt`
- source更新日時

共通baselineとして扱うには、owner、各ID、content hash、line countに加えて、source context `createdAt`が現在sourceと一致しなければならない。

同じ決定的IDを持つcontextでも、削除後に再作成されて`createdAt`が変化した場合は別incarnationである。旧baselineとの差分を計算せず、baselineなしの保守規則を適用する。これにより、再作成された空contextを旧contextでの明示的解除とはみなさない。

baseline省略は、snapshotの全fieldとintervalが現在sourceと一致する場合だけ許可する。intervalが同じでもmetadataが変化した場合はbaselineを更新する。

### 7.4 空baseline

lower owner contextが存在し、現在documentに対応するfile stateがcontext・Globalの両方に存在しない場合、現在の確認済み集合は確実な空集合である。

この場合も`reviewed = []`、現在content hash、line count、source identity、timestampsを持つsnapshotをbaselineとして記録する。

lower owner context自体が存在しない場合はbaselineを作成しない。存在しないownerを空集合として推測しない。

### 7.5 Baseline差分

共通baselineがある場合:

```text
追加差分 = 現在source - 前回source snapshot
解除差分 = 前回source snapshot - 現在source
移行先next = (現在移行先 - 解除差分) + 追加差分
```

source incarnationが変化した場合、この式を適用しない。

### 7.6 初回またはincarnation変更時のreconciliation

共通baselineがない場合は次の保守規則を使用する。

- targetに対象file stateがない: 現在sourceを初期移行し、baselineを同じnext snapshotへ記録する
- sourceとtargetのintervalが一致する: intervalを変えずbaselineだけを記録する
- source contextがtarget fileの最終更新後に新規作成された: sourceの追加分だけを移行し、baselineを記録する
- その他のlegacy、再作成、曖昧状態: intervalを変更せず現在sourceをbaselineとして記録する

共通baselineがない状態でsource側に行われた解除は、由来を安全に判定できないためtargetへ推測反映しない。

### 7.7 複数sourceの集約と競合

複数のlower ownerが存在する場合は、全sourceのdeltaと次baselineをメモリ上の同じplanned context・Global snapshotへ順次適用する。

source評価順はworkspace、external-fileの順とする。ただし順番だけに依存せず、より高いownerの明示的な判断を保護する。

- workspaceでreviewedと判断されたrangeを、external-fileのremovalで解除しない
- workspaceで明示的に解除されたrangeを、external-fileのadditionで再追加しない
- lower-priority sourceはhigher-priority sourceが今回の計画で確定したrangeを反転できない
- baselineは各sourceについて現在観測したsnapshotへ更新する

競合しないrangeについては、各sourceのdeltaを通常どおり同じplanned snapshotへ適用する。

### 7.8 初回昇格とatomicity

処理順:

1. 新owner stateを初期化または読み込み、必要ならstale file stateを先に無効化する
2. 初期化後に実際に永続化されたcontextとowner-wide Globalをplanning開始snapshotとして使用する
3. 存在する全lower owner contextを、各ownerにつき1回だけread-onlyで観測する
4. 初回昇格範囲、全source delta、全次baselineを1つの完全なnext context・Global snapshotへ集約する
5. planning開始snapshotを`expected`として、完全snapshot transactionを1回だけCAS commitする
6. commit成功後だけ、reconciliation済み新ownerをactive ownerとして返す

初回昇格範囲とbaselineを別commitにしてはならない。複数sourceのdeltaとbaselineもsource単位でcommitしてはならない。

### 7.9 Failure contract

最終CAS commitが失敗した場合:

- targetへ昇格範囲だけを残さない
- baselineだけを残さない
- 複数sourceの一部だけを反映しない
- 成功したsessionを返さない
- lower owner stateを変更しない
- owner-wide Globalを空またはstale snapshotへ置換しない

## 8. Extension接続

通常エディタのコマンドと装飾は同じowner routerを使用する。activation compositionはworkspace folderごとにnon-Git provider、snapshot tracker、root-local storage routeを作成し、URI membership routerを経由してdocumentを1つのproviderへだけ渡す。workspace folderの追加・削除・変更ではprovider registryを更新し、削除されたrootのruntimeをdisposeする。Git、PR、file content、GitHub acquisitionは、選択されたdocument URIまたは3.3節で一意に解決したrepository rootから得たworkspace-side filesystem pathだけで実行し、UI側local pathを仮定しない。

```text
DocumentReviewStateSessionProvider.open(document descriptor)
  ├─ LocalGitAdapter.inspectRepository(parent directory)
  ├─ Git owner provider
  ├─ workspace provider
  └─ external-file provider
```

writable `open`はreconciliation済みsessionをそのまま返す。永続化確認を目的とした2回目の`loadForDecoration`やowner再解決は行わない。

workspace providerをroot registryでwrapする場合、registryはtyped snapshot-aware commit capabilityを公開し、reconciliation済みsessionはそのreceiverを保持したままcommitする。したがって確認・解除のstate commitはroot-local latest snapshotの無効化、state publication、replacement snapshot publicationを同じworkspace rootで順に行う。registryはstable Git history-rewrite trackerも保持し、root add/remove/disposeとstartup migration/restart後にもT601/T602のsnapshot・history recoveryを失わない。

装飾読み込みは未保存resourceを初期化せず、owner判定規則だけを共有する。

## 9. エラー処理

- filesystem-backedでないURI: 操作対象外として通知する
- canonical URI不正: 保存しない
- Git inspectionの予期しない失敗: ownerを推測せず通知する
- HEAD確認の未知のexit 128: unborn扱いせず`GitCommandFailedError`を通知する
- load failure: sessionを返さない
- schema、identity、またはreconciliation metadata不一致: 保存済みstateを別ownerへ流用しない
- 新contextとowner-wide Globalのrevision不一致: mapping前に保存せず拒否する
- initial save failure: sessionを返さない
- CAS conflict: 再読込または操作再試行を要求する
- persistence failure: 成功表示しない
- reconciliation failure: reconciliation前snapshotを維持する
- revision mapping未完了: 旧revisionを現在revisionへ再ラベルしない
- workspace root membershipが曖昧またはURI境界を越える: workspace state、history、snapshot、Git/PR acquisitionを開始しない
- workspace folder削除後の旧provider: disposeし、削除rootのstateを別rootへ再利用しない
- repository候補のQuick Pick取消、stale root、または安全にfilesystem pathへ変換できないremote/virtual URI: repository操作を中止し、別候補を推測選択しない
- encoding hintなし、unsupported encoding、invalid encoding、binary: 当該fileを対象外またはunresolvedとして隔離し、他file、context、Global stateを失敗させない

## 10. 検証条件

### 10.1 Routingとidentity

- workspace外Git fileがbranch contextになる
- workspace内Git fileもbranch contextになり、workspace contextより優先される
- untracked fileもworking tree配下ならGit ownerになる
- non-Git workspace fileはworkspace contextになる
- non-Git external fileはexternal-file contextになる
- UNC authorityをcanonical URIとIDへ保持する
- 異なるUNC serverは異なるIDになる
- 既知のunborn HEAD診断だけをmissing HEADとして扱う
- HEAD確認の未知のexit 128を`GitCommandFailedError`として伝播する
- workspaceなしウィンドウでもownerを解決できる
- 1回のwritable openでactive-owner Git inspectionを1回だけ行う
- multi-rootでは最長一致URI pathのrootだけを選び、入れ子root・同一名root・異なるauthorityを混同しない
- untitled、virtual、workspace外、query/fragment URIはworkspace membershipをfail-closedに扱う
- Remote SSH、Dev Containers、Codespaces相当authorityをworkspace identityとfile identityへ保持する
- active editorなし、またはactive editorが非Git documentでも、開かれたGit workspace folderからrepositoryを一意に解決できる
- active Git document、開かれたGit document、明示選択済みCurrent Context、既知root、workspace folderの順序で候補を決定し、複数候補だけをQuick Pickへ出す
- Quick Pick取消、stale root、remote/virtual URIのpath変換不能、root境界不一致ではrepositoryを推測選択しない
- 単一rootとmulti-rootで同じrepositoryが候補になり、同一identityでもrootが曖昧なら操作をfail-closedにする
- opened Shift-JIS、UTF-8、UTF-8 BOM documentの`getText()`と対応Git blobを同じhintで一致させ、同一repository内の混在を許容する
- encoding変更、rename、new file、hintなし、unsupported encoding、invalid encoding、binaryでfile単位の再計算または隔離を確認する

### 10.2 Storage

- Git ownerが`globalStorageUri/repositories`へ保存される
- workspace内外のGit fileが同じrepository storage routeを使用する
- non-Git workspace stateが`storageUri/workspaces/<workspace-id-hash>`へ保存される
- rootごとのworkspace state、history、snapshot、lock、cleanupが相互に独立する
- external-file stateが`globalStorageUri/external-files`へ保存される
- canonical URIがexternal stateから復元できる
- contextとGlobalが1回のatomic commitで更新される
- stale expectationで両stateとも更新されない
- decoration readが未保存resourceを初期化しない
- 同一revisionの新contextが既存owner-wide Globalを継承する
- 異なるrevisionの新context初期化を拒否し、既存Globalを変更しない
- 明示的な非空Globalを伴う新context saveは空初期化と区別される
- reconciliation metadataをfilesystem persistenceでround-tripできる
- intervalがsource `lineCount`を超えるmetadataをsave、load、commitで拒否する
- metadataを持たない既存schema version 1 stateを読み込める

### 10.3 Reconciliation

- external-file状態をworkspaceへ移行できる
- workspaceとexternal-file状態をGit ownerへ移行できる
- 既存Git stateがある復旧時もfallback側の追加を取り込める
- lower owner contextは存在するがfile stateがない場合、空baselineを記録する
- 空baseline後の追加、解除、再追加を反映できる
- context再作成後は旧baseline removalを適用しない
- baseline不在の曖昧な解除を推測反映しない
- content hashまたはline count不一致では移行しない
- metadata-onlyのbaseline更新を保存する
- 初回昇格範囲とbaselineが同じlower-owner observationを使用する
- 初回昇格範囲とbaselineを1回のCAS commitで保存する
- commit失敗時に範囲またはbaselineだけを残さない
- workspaceとexternal-fileの両sourceを1回のCAS commitへ集約する
- workspaceのreviewed判断をexternal-fileのremovalが反転しない
- workspaceのremovalをexternal-fileのadditionが反転しない
- 複数source処理の途中失敗で一部sourceだけを保存しない

### 10.4 Workspace-side composition

- activationがworkspace folderごとのprovider registryを構成し、同じrootへだけdocument stateをrouteする
- rootの追加、削除、変更でregistryを更新し、削除rootのruntimeをdisposeする
- reconciliation経由のworkspace mark/unmarkがtyped snapshot-aware capabilityを通り、latest snapshot、永続state、reopen decorationを同じrootで更新する
- startup migration/restart、snapshot/history recovery、root-scoped lock/cleanupを含むconcrete composition regressionがworkspace root境界を確認する
- Git、対象file read、PR acquisitionがworkspace-side Extension HostのURIとfilesystem adapterを使用する
- non-file remote authorityを含むroot Aとroot BでCurrent Context、review state、history、snapshot、Git/PR acquisitionが混線しない
- 同一repository identityが複数rootに存在する場合もrepository rootをCurrent Context candidate、PR acquisition、diff readerのsource identityとして保持し、rootを一意に決められない操作はactive document rootへfail-closedに束縛する
- restart後はopened documentのencoding hintを再観測し、未再観測fileへ以前のhintを適用しない
