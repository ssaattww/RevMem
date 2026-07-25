# Review Range Tracker Issue #13 設計修正

## 1. 文書情報

- 対象Issue: #13 ワークスペース外のファイル対応
- 対象基準設計: `doc/design/vscode-review-range-tracker-design.md` rev1
- 修正種別: 規範的追補
- 修正対象節: 6.9、7.1、7.2、8.4、14.1、14.2
- 実装前提: T202 Local Git Adapterが`main`へ統合済み

本書と基準設計が競合する場合、Issue #13に関するファイル所有権、識別子、保存先、移行の規則は本書を優先する。

## 2. 修正理由

基準設計とT105時点の実装は、通常エディタのファイルを最初にVS Code workspace folderへ関連付けている。この判定では次を扱えない。

- workspace folder外だがGit working tree内にあるファイル
- workspaceを開いていないウィンドウで開いたGit管理ファイル
- Git管理されていない単独ファイル
- UNC共有上の単独ファイルまたはGit working tree

レビュー状態の所有者はVS Code workspaceではなく、最初にGit working treeの所属で決定する必要がある。workspace membershipはGit非管理時の保存範囲を決める二次情報とする。

## 3. 所有権解決順

対象は、通常エディタで既に開くことができているfilesystem-backed documentとする。

```text
対象document
  ↓
documentの親directoryからLocal Git inspection
  ↓
Git working treeを検出
  ├─ GitHub PRを一意に解決できる → pull-request context
  ├─ attached branch              → branch context
  └─ detached HEAD                → detached commit相当のbranch context

Git working treeを検出しない
  ├─ workspace folderに所属       → non-Git workspace context
  └─ workspace folderに非所属     → external-file context
```

現段階ではGitHub PR resolverが未接続のため、Issue #13の実装はGit管理下をbranchまたはdetached contextへ解決する。将来PR resolverを接続しても、Git ownershipを先に決定する規則は変更しない。

### 3.1 Git unavailable

Git executableを利用できない場合は、基準設計7.1.3に従いsnapshot方式へフォールバックする。

- workspace所属: workspace context
- workspace非所属: external-file context

後からGit ownershipを解決できた場合は、7章の移行規則を適用する。

### 3.2 Git command failure

Git executable不在と`not-repository`以外の実行失敗は、非Gitと誤認しない。権限、timeout、破損repositoryなどの失敗はユーザーへ通知し、別ownerへ新規保存しない。

`git rev-parse --verify HEAD^{commit}`については、workspace-side Extension HostがGit processのlocaleをCへ固定した上で、exit code 128かつ既知のunborn診断`fatal: Needed a single revision`だけをmissing HEADとして受理する。破損HEAD、object database異常、権限エラーなど、同じexit code 128でも別診断の場合は`GitCommandFailedError`として伝播する。

## 4. Git管理ファイル

Git管理判定は`git ls-files`への登録有無ではなく、documentがGit working tree root配下にあるかで行う。したがってuntracked fileもそのrepositoryに所属する。

### 4.1 識別子

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

絶対パスはGit file IDへ含めない。同一repositoryを別の場所へcloneした場合でも、remoteとrepository-relative pathが一致すれば同じ論理ファイルとして扱えるためである。

### 4.2 保存先

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

workspace内外で保存先を変えない。

### 4.3 現在revision

attached branchはHEAD commitを`headRevision`とする。unborn branchはbranch refから安定した一時revisionを生成する。detached HEADはHEAD commitをrevisionとし、context IDにも含める。

HEAD変更時の範囲mappingはT203以降のrevision mapping責務である。mapping未完了の旧状態を新HEADへ無条件に再ラベルしない。

## 5. 非Git workspaceファイル

既存のworkspace contextと`ExtensionContext.storageUri`を維持する。

```text
storageUri/
  workspace-state.json
  history/
  snapshots/
  lock
```

Git ownershipが検出された場合はworkspaceよりGitを優先するため、この経路へ入らない。

## 6. external-file context

Git working treeにもworkspace folderにも所属しないfilesystem-backed documentを`external-file` contextとして管理する。

### 6.1 対象

- `file` URI
- workspace-side Extension Hostから扱える`vscode-remote` URI
- queryとfragmentを持たない通常filesystem document
- 通常エディタで既に開くことができているdocument

`untitled`、diff内部URI、Git仮想documentなどは対象外とする。

### 6.2 canonical URI

external fileはcanonical URIを完全なlocatorとして保持する。

```text
C:\Source\Example.cs
→ file:///c:/source/example.cs

\\BuildServer\Share\Source\Example.cs
→ file://buildserver/share/source/example.cs
```

Windows semanticsではscheme、authority、drive、path casing、separatorを正規化する。POSIX semanticsではpathの大文字小文字とbackslash文字を保持する。

### 6.3 UNC

UNC server addressはURI authorityとして保持する。異なるserver上の同じshare/pathは異なるfile IDである。

VS CodeのUNC securityを迂回しない。

- `security.restrictUNCAccess`で拒否されたresourceは新規登録しない
- `security.allowedUNCHosts`またはユーザー確認により開けたresourceは通常どおり保持する
- 一時的に到達不能になっても既存状態を自動削除しない

### 6.4 識別子

```text
External Repository ID = hash(canonical document URI)
External Context ID    = hash(canonical document URI)
External File ID       = hash(canonical document URI)
```

各IDはdomain prefixを分離してSHA-256化する。canonical URI自体もcontext descriptorとfile `currentPath`へ保存し、ハッシュだけにしない。

### 6.5 保存先

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

VS Codeの`globalStorageUri`とRevMemのGlobal確認済みlayerは別概念である。external-file contextとGlobal layerの両方を上記rootへ保存する。

## 7. owner変更時の移行

所有権解決結果が変化した場合、確認済み範囲を新ownerへ移行できる。

### 7.1 優先順位

```text
pull-request > Git branch/detached > non-Git workspace > external-file
```

高いownerが利用可能になった時点で、以後のactive writeは高いownerだけへ行う。旧ownerへの恒久的な二重書き込みは行わない。

### 7.2 移行元候補

Git ownerへ移行するとき:

1. 同じdocumentのworkspace state
2. 同じcanonical URIのexternal-file state

workspace ownerへ移行するとき:

1. 同じcanonical URIのexternal-file state

移行元候補はすべて読み込んでから新ownerのnext snapshotを計算する。候補ごとに永続化commitを分けてはならない。

### 7.3 確実性条件

次をすべて満たす場合だけ範囲をコピーまたは再調整する。

- 現在のcontent hashが一致
- 現在のline countが一致
- 移行元の該当file stateが移行元revisionに対して確実
- 移行先の該当file stateが現在の移行先revisionに対して確実

不一致または曖昧な場合は範囲を変更しない。snapshot diff mappingが実装された後は、確実にmappingできた範囲だけを移行できる。

### 7.4 復旧時reconciliation

Git unavailableなどで一時的に下位ownerへfallbackした後、上位ownerが復旧した場合は、移行先に既存file stateがあっても下位ownerを確認する。

上位contextは下位ownerごとに、最後に確実に確認したsource snapshotを`ownerReconciliation` metadataとして保持する。snapshotはsource owner、repository/context/file ID、content hash、line count、確認済みinterval、source作成・更新日時を含む。

lower ownerのcontextが存在し、現在のcontent hashとline countで対象file stateが存在しない場合、確認済み集合は確実な空集合である。この場合も空のsource snapshotをbaselineとして記録する。lower ownerのcontext自体が存在しない場合はbaselineを作成しない。

空baselineを先に記録することで、その後fallback中に対象file stateを新規作成した場合も、追加範囲を`現在source - empty`として確実に上位ownerへ反映できる。空baseline確立後の解除・再追加も通常の差分計算に従う。

共通baselineがある場合:

```text
追加差分 = 現在source - 前回source snapshot
解除差分 = 前回source snapshot - 現在source
移行先next = (現在移行先 - 解除差分) + 追加差分
```

追加差分と解除差分は、contextとGlobalの完全snapshotを置換する1回のatomic transactionへまとめる。これによりfallback側の追加を失わず、fallback側で解除した範囲も反映し、移行先で既に解除した範囲を古いsource snapshotの単純unionで復活させない。

baselineがない初回reconciliationでは次の保守規則を使う。

- 移行先に対象file stateがない: 現在sourceを初期移行し、baselineを同じnext snapshotへ記録する
- sourceと移行先のintervalが一致: intervalを変えずbaselineだけを記録する
- source contextが移行先fileの最終更新後に新規作成された: sourceの追加分だけを移行し、baselineを記録する
- 上記以外のlegacy・曖昧状態: intervalを変更せず現在sourceをbaselineとして記録し、次回以降の確実な差分だけを扱う

共通baselineがない状態でfallback側に行われた解除は、安全に由来を判定できないため上位ownerへ推測反映しない。baseline確立後の解除だけを差分として反映する。

複数のlower ownerが存在する場合は、全候補の確実なdeltaと次baselineをメモリ上の同じnext context/Global snapshotへ順次適用し、最後に1回だけcommitする。途中の候補までを永続化した部分成功状態を作らない。

### 7.5 書き込み順とatomicity

1. 新owner stateを初期化または読み込み、必要ならstale file stateを先に無効化する
2. base owner resolverが初回昇格transactionを生成しても、直ちに永続化せずメモリ上へ捕捉する
3. 存在する全lower owner contextを読み込み、対象file state不在を含むsource snapshotを確定する
4. 初回昇格範囲、全source delta、全次baselineを1つの完全なnext context/Global snapshotへ集約する
5. 新ownerのreconciliation前snapshotを`expected`として、完全snapshot transactionを1回だけCAS commitする
6. commit成功後だけ、reconciliation済み新ownerをactive ownerとして返す

初回昇格の範囲とbaselineを別commitにしてはならない。複数sourceのdeltaとbaselineもsource単位でcommitしてはならない。

CAS commitが失敗した場合、新ownerには昇格範囲だけ、baselineだけ、または一部sourceだけを残してはならない。新ownerはreconciliation前の完全snapshotを維持し、旧owner stateもそのまま保持する。

旧owner stateは履歴・復旧のため残してよいが、ルーターは高いownerが利用可能な間は参照表示と書き込みに使用しない。

## 8. Extension接続

従来の処理:

```text
getWorkspaceFolder(document.uri)
  ├─ undefined → reject
  └─ workspace provider
```

修正後:

```text
DocumentReviewStateSessionProvider.open(document descriptor)
  ├─ LocalGitAdapter.inspectRepository(parent directory)
  ├─ Git owner provider
  ├─ workspace provider
  └─ external-file provider
```

コマンドと通常エディタ装飾は同じルーターを使用し、異なるowner判定を実装しない。

## 9. エラー処理

- filesystem-backedでないURI: 操作対象外として通知
- canonical URI不正: 保存しない
- Git inspectionの予期しない失敗: 保存ownerを推測せず通知
- HEAD確認の未知のexit 128: unborn扱いせず`GitCommandFailedError`を通知
- persistence失敗: 成功表示しない
- migration/reconciliation commit失敗: reconciliation前の新owner snapshotを維持し、範囲・baseline・一部sourceだけの部分保存を行わない
- revision mapping未完了: 旧revisionを現在revisionへ再ラベルせず拒否

## 10. テスト条件

- workspace外Git fileがbranch contextになる
- workspace内Git fileもbranch contextになり、workspace contextより優先される
- untracked fileもworking tree配下ならGit ownerになる
- non-Git workspace fileは従来のworkspace保存を維持する
- non-Git external fileは`globalStorageUri/external-files`へ保存する
- UNC authorityをcanonical URIとIDへ保持する
- 異なるUNC serverは異なるIDになる
- external-file状態をworkspaceへ移行できる
- workspace/external状態をGit ownerへ移行できる
- 既存Git stateがある復旧時もfallback側の追加範囲を取り込める
- lower owner contextは存在するが対象file stateがない場合、空baselineを記録する
- 空baseline確立後にfallbackで対象file stateを新規作成すると、その追加を復旧時に反映する
- 空baseline確立後の解除・再追加が安定して差分計算される
- baseline確立後のfallback解除を反映し、移行先で解除済みの範囲を復活させない
- baseline不在の曖昧な解除を推測反映しない
- content hashまたはline count不一致では移行しない
- 初回昇格の範囲とbaselineを1回のCAS commitで保存する
- 初回昇格commit失敗時に範囲だけを残さない
- workspaceとexternal-fileの両sourceを1回のCAS commitへ集約する
- 複数source処理の途中失敗で一部sourceだけを保存しない
- 既知のunborn HEAD診断だけをmissing HEADとして扱う
- HEAD確認の未知のexit 128を`GitCommandFailedError`として伝播する
- decoration readは未保存resourceを初期化しない
- workspaceなしウィンドウで再起動復元できる
- 既存workspace、Git、PR保存routeを壊さない
