# Document Context Routing

## 1. 目的

本書は、通常エディタで開かれたfilesystem-backed documentについて、レビュー状態を所有するcontextを決定する規則を定義する。

保存レイアウトと永続化境界は`review-state-storage.md`、owner変更時の状態移行は`owner-reconciliation.md`で定義する。

## 2. 適用範囲

対象は、VS Codeの通常エディタで既に開くことができているfilesystem-backed documentとする。

対象外:

- `untitled` document
- diff内部URI
- Git仮想document
- queryまたはfragmentを持つ非標準filesystem document

## 3. Owner解決順

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

## 4. Git inspection

### 4.1 Git管理判定

Git管理判定は`git ls-files`への登録有無ではなく、documentがGit working tree root配下にあるかで行う。untracked fileもworking tree配下であればそのrepositoryに所属する。

### 4.2 Git unavailable

Git executableを利用できない場合は、現在のworkspace membershipに応じて一時的にfallbackする。

- workspace所属: workspace context
- workspace非所属: external-file context

後からGit ownershipを解決できた場合は`owner-reconciliation.md`の規則を適用する。

### 4.3 Git command failure

Git executable不在と`not-repository`以外の実行失敗を非Gitとして扱わない。権限、timeout、破損repositoryなどの失敗は通知し、別ownerへ新規保存しない。

`git rev-parse --verify HEAD^{commit}`はGit processのlocaleをCへ固定し、exit code 128かつ既知のunborn診断`fatal: Needed a single revision`だけをmissing HEADとして扱う。その他のexit code 128は`GitCommandFailedError`として伝播する。

## 5. Git context identity

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

## 6. Non-Git workspace context

Git working treeを検出せず、documentがworkspace folderに所属する場合はworkspace contextをownerとする。

workspace identityはworkspace folder URIとworkspace-relative pathから導出する。Git ownershipが検出された場合、この経路へ入らない。

## 7. External-file context

Git working treeにもworkspace folderにも所属しないfilesystem-backed documentを`external-file` contextとして管理する。

### 7.1 Canonical URI

external fileはcanonical URIを完全なlocatorとして保持する。

```text
C:\Source\Example.cs
→ file:///c:/source/example.cs

\\BuildServer\Share\Source\Example.cs
→ file://buildserver/share/source/example.cs
```

Windows semanticsではscheme、authority、drive、path casing、separatorを正規化する。POSIX semanticsではpathの大文字小文字とbackslash文字を保持する。

### 7.2 UNC

UNC server addressはURI authorityとして保持する。異なるserver上の同じshare/pathは異なるFile IDである。

VS CodeのUNC securityを迂回しない。

- `security.restrictUNCAccess`で拒否されたresourceは新規登録しない
- `security.allowedUNCHosts`またはユーザー確認により開けたresourceは通常どおり保持する
- 一時的に到達不能になっても既存状態を自動削除しない

### 7.3 Identity

```text
External Repository ID = hash(canonical document URI)
External Context ID    = hash(canonical document URI)
External File ID       = hash(canonical document URI)
```

各IDはdomain prefixを分離してSHA-256化する。canonical URI自体もcontext descriptorとfile `currentPath`へ保存し、ハッシュだけにしない。

## 8. Extension接続

通常エディタのコマンドと装飾は同じowner routerを使用する。

```text
DocumentReviewStateSessionProvider.open(document descriptor)
  ├─ LocalGitAdapter.inspectRepository(parent directory)
  ├─ Git owner provider
  ├─ workspace provider
  └─ external-file provider
```

装飾読み込みは未保存resourceを初期化せず、owner判定だけを共有する。

## 9. エラー処理

- filesystem-backedでないURI: 操作対象外として通知する
- canonical URI不正: 保存しない
- Git inspectionの予期しない失敗: ownerを推測せず通知する
- HEAD確認の未知のexit 128: unborn扱いせず`GitCommandFailedError`を通知する
- revision mapping未完了: 旧revisionを現在revisionへ再ラベルしない

## 10. 検証条件

- workspace外Git fileがbranch contextになる
- workspace内Git fileもbranch contextになり、workspace contextより優先される
- untracked fileもworking tree配下ならGit ownerになる
- non-Git workspace fileはworkspace contextになる
- non-Git external fileはexternal-file contextになる
- UNC authorityをcanonical URIとIDへ保持する
- 異なるUNC serverは異なるIDになる
- 既知のunborn HEAD診断だけをmissing HEADとして扱う
- HEAD確認の未知のexit 128を`GitCommandFailedError`として伝播する
- decoration readは未保存resourceを初期化しない
- workspaceなしウィンドウでもownerを解決できる
