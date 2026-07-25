# VS Code レビュー範囲トラッカー 設計書 rev3

- 文書種別: 基本設計・機能設計
- 対象: Visual Studio Code Workspace Extension
- 仮称: Review Range Tracker
- 状態: 機能別統合版

## 1. 概要

本拡張は、コードレビュー中に確認したソースコードの範囲を行単位で記録し、現在も確認済みと確実に判断できる範囲をエディタ上でグレー表示する。

提供する主要機能は次のとおり。

- PR、ブランチ、Gitなしワークスペースごとの確認済み範囲管理
- 編集、commit、rename等による変更箇所だけの未確認化
- 過去の確認をリポジトリ単位で保持するGlobal確認済み状態
- PRの追加・削除行を基準にした確認進捗
- リポジトリ全体のGlobal理解率
- GitHub障害、オフライン、Git未導入、非Git環境でのフォールバック
- original側とmodified側を扱うVS Code diff editor

初期版では、レビューコメント、Approve、複数レビュワー共有、関数・クラス単位解析、メモ、自動完了判定、未確認箇所への自動ジャンプを扱わない。

## 2. 設計原則

### 2.1 確実性優先

確認済み表示は、確認時点から内容が変わっていないと確実に判断できる場合だけ適用する。判断が曖昧、追跡不能、取得失敗の場合は未確認とする。

### 2.2 デフォルト表示は二値

| 内部状態 | デフォルト表示 |
|---|---|
| 確認済みであることが確実 | グレー背景 |
| 未確認、変更済み、追跡不能、曖昧 | 通常背景 |

内部状態は詳細に保持するが、既定では色を増やさない。変更済みや追跡不能への追加色は任意設定とする。

### 2.3 言語非依存

確認操作は行範囲またはファイル全体を対象とし、AST、Language Server、関数、クラスには依存しない。

### 2.4 PR進捗とGlobal理解率を分離

PR進捗は対象PRの変更行だけを数える。Global理解率は現在のリポジトリに存在する対象非空行を数える。Global確認済みだけで現在PRの変更行を確認済みにはしない。

## 3. 対象環境

必須対象:

- VS Code Desktop
- ローカルワークスペース
- Gitリポジトリ
- GitHub PR
- VS Code diff editor

対応対象:

- Remote SSH
- Dev Containers
- GitHub Codespaces
- GitHub未接続のGitリポジトリ
- Git管理されていないワークスペース
- マルチルートワークスペース

拡張はWorkspace Extensionとして動作し、Gitコマンドとファイル操作は対象ワークスペース側のExtension Hostで実行する。

## 4. 共通データモデル

### 4.1 行範囲

内部表現は0始まり半開区間とする。

```ts
interface LineInterval {
  startLine: number;
  endLineExclusive: number;
}
```

範囲は常に正規化し、空範囲を保持せず、重複・隣接区間を結合する。

### 4.2 レビューコンテキスト

確認状態を分離する単位は次のいずれかとする。

- GitHub PRコンテキスト
- Gitブランチコンテキスト
- detached commitコンテキスト
- Gitなしワークスペースコンテキスト

### 4.3 original側 / modified側

- original側: 変更前。削除行を含む
- modified側: 変更後。追加行と現在内容を含む

### 4.4 Global確認済み

特定コンテキストに閉じず、リポジトリ全体で現在も有効と判断できる確認済み状態。内容変更時は変更部分だけ無効化する。

## 5. 確認操作

### 5.1 選択範囲を確認済みにする

選択開始・終了が行途中でも含まれる行全体を対象にする。空選択はカーソル行1行を対象にする。複数選択は行範囲へ変換後、重複・隣接を結合する。

### 5.2 選択範囲を解除する

現在コンテキストとGlobal確認済みの両方から解除する。部分解除で区間が分断される場合は残存区間を分割する。通常の範囲操作では確認ダイアログを表示しない。

### 5.3 ファイル全体を確認済みにする

実行前に確認ダイアログを表示する。

通常エディタでは現在ファイルの全行を対象にする。diff editorではmodified側の全行とoriginal側だけに存在する削除行を同時に対象にする。

### 5.4 ファイル全体を解除する

実行前に確認ダイアログを表示する。現在コンテキスト、Global、original側の削除行に対する確認状態をすべて解除する。履歴は削除せず解除イベントを追加する。

### 5.5 永続化との整合

確認操作は永続化成功後だけ成功表示する。contextとGlobalは1つのatomic transactionとして更新し、片側だけ成功した状態を許容しない。staleなexpected snapshotは拒否する。

## 6. コンテキストと識別子

### 6.1 GitHub PRコンテキスト

識別子は次を基礎とする。

```text
GitHub host + owner + repository + PR number
```

base SHAとhead SHAはコンテキスト識別子ではなく現在revisionとして保持する。PRへcommitが追加されても同じコンテキストを継続する。

### 6.2 ブランチコンテキスト

```text
Repository ID + full branch ref
```

branch名は完全な`refs/heads/...`を使用する。detached HEADはcommit object IDを使う一時コンテキストとして扱う。

### 6.3 Gitなしワークスペースコンテキスト

```text
Workspace URI hash + workspace-folder-relative path
```

Git diffの代わりに保存済みsnapshotと現在内容の行差分を使用する。Global確認済みはそのワークスペース内だけで有効とする。

### 6.4 Repository ID

remoteが存在する場合はcredentialを除去したcanonical remote identityを使う。remoteがない場合はcanonical repository root URIをSHA-256でhashする。forkはupstreamと別IDにする。

## 7. Filesystem path

### 7.1 Workspace filesystem semantics

path semanticsは拡張プロセスのOSではなく、対象workspace filesystemを表す値として明示する。

```ts
type FileSystemPathSemantics = "posix" | "windows";
```

Remote Windows workspaceではローカルOSに関係なく`windows`を指定する。

### 7.2 Canonical repository-relative path

Git、GitHub、snapshot、仮想diff文書が共有するfile pathはrepository rootからのcanonical相対pathとする。

全filesystemで拒否するもの:

- 空文字列
- NUL
- `/`で始まる絶対path
- 空segment
- `.`および`..` segment
- root外へ抜けるpath
- 不正なUTF-16 surrogate

入力を暗黙に正規化して別ファイルへ読み替えず、canonicalでない入力は境界で拒否する。

### 7.3 POSIX semantics

`/`とNUL以外をファイル名文字として保持する。backslash、tab、newline、その他のcontrol characterをseparatorへ変換しない。

### 7.4 Windows semantics

URI内部のseparatorは`/`とする。次を拒否する。

- backslash
- drive付きpath
- control character
- `< > : " | ? *`
- trailing dotまたはspaceを持つsegment
- `CON`、`PRN`、`AUX`、`NUL`
- `COM1`〜`COM9`、`LPT1`〜`LPT9`
- 上記予約デバイス名に拡張子を付けたsegment

予約デバイス名は各segmentのbasenameをcase-insensitiveで判定する。`con.txt`、`src/COM1.log`も拒否する。POSIXでは同じ文字列を通常のファイル名として許可する。

## 8. Diff editorと仮想文書

### 8.1 Diff review target

```ts
interface DiffReviewTarget {
  contextId: string;
  fileId: string;
  side: "original" | "modified";
  startLine: number;
  endLine: number;
}
```

original側の削除行も確認・解除・進捗計算の対象にできる。

### 8.2 仮想文書descriptor

```ts
interface ReviewDiffDocumentDescriptor {
  contextId: string;
  filePath: string;
  fileSystemPathSemantics: "posix" | "windows";
  side: "original" | "modified";
  revisionSource: "git-commit";
  revision: string;
}
```

同じpathでもcontext、side、revision source、revisionが異なれば別文書とする。別contextや別revisionの内容を代用しない。

### 8.3 Immutable revision

Git revisionはlowercaseのfull SHA-1またはfull SHA-256 commit object IDに限定する。`HEAD`、branch、tag、短縮ID、revision range、Git optionとなる文字列を受理しない。

moving refはURI生成前にcommit object IDへ解決する。同じURIが後から別内容を返すことを禁止する。snapshot等を追加する場合は別のrevision sourceとimmutable IDを定義する。

### 8.4 Canonical URI

```text
review-range-diff://document/v1/
  <context-base64url>/
  <path-semantics>/
  <side>/
  <revision-source>/
  <revision-base64url>/
  <file-path-base64url>
```

可変文字列はUTF-8のcanonical base64urlとする。padding、再encode不一致、不正UTF-8、userinfo、password、port、query、fragment、未知version、未知segmentを拒否する。

上限:

- URI全長: 65,536文字
- Context ID: UTF-8で8,192 bytes
- file path: UTF-8で32,768 bytes
- Git revision: full SHA-1またはfull SHA-256

### 8.5 VS Code境界

- codec生成URIを`vscode.Uri.parse`できる
- `uri.toString(true)`がcanonical URIと一致する
- decode後のdescriptorが完全一致する
- `TextDocumentContentProvider`は同じURIをapplication providerへ渡す

provider登録と`vscode.diff`実行はUI adapterが行う。

## 9. Local Git content取得

### 9.1 Runtime構成

metadata commandとblob commandは同一runtime optionsから構成する。

- `executable`: 全Git subprocessで同じ値
- `timeoutMs`: 全Git subprocessで同じ値
- `maxBufferBytes`: boundedなmetadata出力だけへ適用

Node Extension Hostでは共通factoryからmetadata executorとblob readerを生成する。portable Git、絶対path指定、Remote、Container環境で、metadataだけ設定済みGitを使いblobだけPATH上の別Gitを使う状態を禁止する。

`LocalGitAdapter`を直接構築する場合は、`GitCommandExecutor`と`GitBlobReader`の両方を明示注入する。blob readerの暗黙既定値を持たせない。Node runtimeのproduction wiringは共通factoryだけを使用し、低水準classの直接構築はtestまたは代替runtime adapterに限定する。

### 9.2 Commit確認

```bash
git rev-parse --verify --quiet <full-object-id>^{commit}
```

- exit 0かつ出力IDが入力と一致: 利用可能
- exit 1: `missing-revision`
- その他: 診断情報を保持したGit failure

exit 128を一律missingへ変換しない。

### 9.3 Exact path確認

```bash
git ls-tree --full-tree -z <commit-id> -- :(literal)<repository-path>
```

- exit 0、出力なし: `missing-file`
- exit 0、exact pathのblob 1件: blob object IDを使用
- treeまたはsubmodule: `missing-file`
- 複数件、path不一致、壊れた出力: adapter failure
- 非0 exit: Git failure

NUL終端で解析し、newlineを含むPOSIX pathを行分割しない。pathspecはliteral指定とする。

### 9.4 Blob本文とencoding

```bash
git cat-file blob <blob-id>
```

stdoutをraw byte streamとして取得し、blob本文へ`execFile.maxBuffer`を適用しない。4 MiBを超える通常textも取得可能とする。

complete byte sequenceを取得後、fatal UTF-8 decoderで1回だけdecodeする。不正UTF-8をreplacement characterへ変換せず`invalid-encoding`とし、行単位レビュー対象外にする。

Git objectから再取得可能な本文には固定の4 MiB上限を設けない。巨大入力の追加制御は性能計測に基づいて定義する。

### 9.5 Process failure contract

metadata commandとblob commandのtimeoutは、いずれもinvocation、partial stdout、stderrを保持する`GitCommandFailedError`として返す。timeout時のsynthetic exit codeは`-1`とし、設定されたtimeout値をdiagnosticへ含める。

Git executableが起動できない場合だけ`GitExecutableNotFoundError`として区別する。通常の非0 exitはmetadata commandではresultとしてadapterへ返し、adapterがmissingとfatalを分類する。blob commandの非0 exitは直接`GitCommandFailedError`とする。

## 10. 変更追従

### 10.1 編集イベント

複数変更は変更前座標を基準に後方から適用する。

- 変更より前: 維持
- 変更より後: 行数差だけshift
- 変更と重なる範囲: 重なった部分を未確認化
- 追加行: 未確認

### 10.2 Git revision間

```bash
git diff --unified=0 --find-renames R_old R_new -- <path>
```

branch比較ではmerge-baseを使用する。hunk前後の未変更部分を維持し、変更部分だけ未確認へ戻す。

### 10.3 Rename・move・delete

一意なrenameとdirectory moveはfile identityを追従する。renameと同時に変更された行は未確認にする。

コピー、分割、統合、複数候補は自動追従せず新規未確認とする。deleteは現在表示から除外するが、履歴とoriginal側review targetを保持できる。

### 10.4 Rebase・force-push

1. 旧Git objectがあれば直接diff
2. なければ保存snapshotとdiff
3. renameと内容対応が一意なら追従
4. 曖昧なら未確認

SHAが変わっただけで全解除しない。

### 10.5 空白・改行

既定ではインデント、空白数、tab/space、CRLF/LF、末尾改行も変更として扱う。設定で明示した場合だけ該当差分を無視する。

## 11. PR進捗とGlobal理解率

### 11.1 PR進捗

```text
PR確認進捗 = 確認済み追加・削除行数 / 対象追加・削除行数
```

置換は削除1行と追加1行として数える。未変更周辺行とGlobal確認済みは算入しない。

### 11.2 ファイル進捗

fileごとに確認済み変更行数、全変更行数、率、追加数、削除数を計算する。

未確認変更が残るfile、完了file、除外file、rename-only、binary/encoding対象外を別グループで表示する。

### 11.3 Global理解率

```text
Global理解率 = 現在有効なGlobal確認済み非空行数 / 対象全非空行数
```

コメント行も非空なら対象とする。PR進捗とは別表示する。確認操作はGlobalへ自動反映し、解除操作は参照数に関係なくGlobalからも解除する。

### 11.4 表示優先順位

1. 現在PRの未確認変更
2. 追跡不能または変更済み
3. 現在コンテキストで確認済み
4. 有効な別コンテキストで確認済み
5. Global確認済み
6. 未確認

現在PRの変更行は、そのPRコンテキストで確認済みになった場合だけグレーにする。

## 12. 集計対象外と設定glob

常に対象外:

- binary
- valid UTF-8としてdecodeできないtext blob
- `.git`配下
- 本拡張が管理しない仮想document

既定除外:

- `node_modules`
- `bin`、`obj`、`dist`、`build`
- repository列挙時に`.gitignore`へ一致するfile

`reviewRange.exclude`は有効配列全体を上書きする。空配列ではbinaryと`.git`以外を再包含できる。単一backslashはseparator、二重backslashはliteral backslashとし、canonical snapshotを再投入してもdecisionとreasonが変わらないようにする。

設定変更後はPR進捗とGlobal理解率で同じ除外policyを再利用する。

## 13. アーキテクチャ

### 13.1 Layer dependency contract

次の表はarchitecture validatorと同一の依存行列であり、source codeと設計の双方で維持する。

<!-- architecture-layer-contract:start -->
| `source layer` | allowed dependencies |
|---|---|
| `core` | `core` |
| `application` | `core`, `application` |
| `adapters` | `core`, `application`, `adapters` |
| `ui` | `core`, `application`, `ui` |
<!-- architecture-layer-contract:end -->

UI層はapplication serviceまたはapplication portへ依存し、adapters層を直接importしない。application層はruntime技術を知らず、portとuse caseを定義する。adapters層はapplication/core contractを実装する。

### 13.2 Composition Root

Composition Rootはlayer directoryの外側に置き、runtime object graphを構築する唯一の場所とする。

```text
Composition Root
  -> Runtime Adapters
  -> Application Services
  -> UI Adapter

UI Adapter
  -> Application Services
      -> Core domain

Runtime Adapters
  -> Application/Core contracts
```

Composition RootはLocal Git、GitHub、snapshot、storage等のruntime adapterを生成してapplication portへ注入し、そのapplication serviceをUIへ渡す。UI command、Tree View、TextDocumentContentProviderがLocal GitやGitHub adapterを直接生成・参照することを禁止する。

### 13.3 主要コンポーネント

- UI Adapter: command、dialog、decoration、Tree View、Status Bar、diff表示
- Review Context Resolver: repository、branch、PR、fallback context解決
- Review State Service: interval、context/Global transaction、history request
- Range Mapping Engine: edit/Git/snapshot差分追従
- Progress Calculator: PR/file進捗、Global理解率
- Local Git Adapter: repository metadata、diff、object、immutable content
- GitHub Adapter: 認証、PR metadata、file、content
- Snapshot Adapter: Gitなし・object欠落時のsnapshot差分
- State Repository: atomic persistence、migration、routing
- History Store: append-only event

公開barrelはconsumer type fixtureで固定し、内部compileだけで公開contractを検証済みとしない。

## 14. GitHub連携とオフライン

PR差分取得の優先順:

1. local base/head objectによるGit diff
2. GitHub PR files APIのpatch
3. base/head file内容取得後のローカル差分

認証tokenは永続化しない。未認証でもpublic repository APIを試す。rate limit、network、API障害時はlocal Gitまたはcacheへfallbackし、最後に成功した更新日時を表示する。

closed PRもcontextとして保存できるが、既定ではeditor layerを無効とする。ユーザーが明示的に有効化した場合だけ表示する。

## 15. 永続化と履歴

### 15.1 保存先

Git/PR状態は`globalStorageUri`、Gitなしworkspace状態は`storageUri`へ保存する。

```text
globalStorageUri/
  repositories/<repository-id-hash>/
    manifest.json
    global-state.json
    contexts/<context-id>.json
    history/events-YYYY-MM.jsonl
    snapshots/<content-hash>.json.gz
    cache/github/
    cache/diffs/
    lock
```

### 15.2 Atomic write

1. 一時fileへ書く
2. flushする
3. 既存fileと置換する

複数window競合には排他的file lockと期限切れ判定を使う。contextとGlobalの更新は完全snapshot CASとして1 transactionで置換する。

### 15.3 Schema migration

全保存modelに`schemaVersion`を持たせる。起動時に段階移行し、移行前backupを作成する。破損dataは隔離し、不確実な範囲を確認済みにしない。

### 15.4 履歴

履歴はJSON Linesのappend-only eventとし、初期版では閲覧UIを提供しない。

最低限保存する情報:

- event ID、日時、session ID
- repository/context/revision
- file path、diff side
- 変更前後のinterval
- event typeとreason

現在状態は履歴から毎回再構築せず、別途snapshotとして保存する。履歴は原則無期限保持する。

## 16. UIと設定

### 16.1 Activity Bar

Activity Barへ「Review Range」containerを追加し、次のviewを表示する。

1. Current Context
2. PR Progress
3. Global Understanding
4. Review Contexts

### 16.2 Current Context View

表示項目:

- 現在のコンテキスト種別
- PR番号、タイトル、状態
- ブランチ名
- base/head revision
- GitHub接続状態
- Global表示の有効・無効

操作:

- 現在コンテキストの切り替え
- PR再検出
- GitHub再接続
- 現在状態の再計算

PRが解決されていない場合はbranchまたはworkspace contextを表示し、GitHub障害中でもローカル確認操作を停止しない。

### 16.3 PR Progress View

分類:

- 未確認変更が残るファイル
- 確認完了したファイル
- 除外されたファイル
- 行以外の変更
- 行単位レビュー対象外

各fileへ次を表示する。

- ファイルパス
- 確認済み変更行数
- 全変更行数
- 進捗率
- 追加行数
- 削除行数
- 除外・対象外の場合は理由

ファイルを選択すると、そのcontextのdiff editorを開く。「次の未確認行」へは自動移動しない。

既定sort:

1. 未確認行数の降順
2. ファイルパス昇順

sort切替候補:

- PR上の順序
- パス順
- 未確認行数順
- 進捗率順

rename-onlyは「行以外の変更」、binaryおよびencoding対象外は「行単位レビュー対象外」へ表示する。

### 16.4 Review Contexts View

表示対象:

- 現在のPR
- 現在のブランチ
- 保存済みのオープンPR
- 保存済みのクローズ済みPR
- ワークスペースコンテキスト

各contextの操作:

- 進捗表示
- diffを開く
- エディタ表示layerの有効・無効切り替え
- ローカルキャッシュ更新
- コンテキスト表示から削除

コンテキスト表示から削除しても履歴を消さない。履歴削除は別操作とし、明示的な確認なしに実行しない。closed PRは既定でlayer無効とする。

### 16.5 Global Understanding View

表示項目:

- リポジトリ全体の理解率
- 確認済み非空行数
- 対象非空行数
- fileごとの理解率
- 除外file数

PR Progressとは別sectionで表示する。

### 16.6 Editor decoration

確認済み行はtheme対応の半透明グレー背景と任意のgutter iconで表示する。Overview Rulerは既定無効。hoverへcontext、確認日時、Global状態を表示する。

visible editorだけを装飾対象とし、現在PRの未確認変更行はGlobalだけでグレーにしない。

### 16.7 Status Bar

```text
PR #123: 67% | Global: 42%
```

PRがない場合はbranchまたはworkspace contextを表示する。

### 16.8 Commands

- 選択範囲を確認済みにする
- 選択範囲を解除する
- ファイル全体を確認済みにする
- ファイル全体を解除する
- PR/fileのdiffを開く
- contextをrefreshする
- contextを選択する
- Global layerを切り替える
- 表示context layerを管理する

commandはCommand Paletteと適切なeditor context menuへ登録する。

### 16.9 主な設定

```json
{
  "reviewRange.showGlobalReviewed": true,
  "reviewRange.ignoreWhitespaceChanges": false,
  "reviewRange.ignoreEolChanges": false,
  "reviewRange.showGutterIcon": true,
  "reviewRange.showOverviewRuler": false,
  "reviewRange.exclude": [
    "**/.git/**",
    "**/node_modules/**",
    "**/bin/**",
    "**/obj/**",
    "**/dist/**",
    "**/build/**"
  ],
  "reviewRange.maxSnapshotFileSizeBytes": 5242880,
  "reviewRange.historyRetentionDays": 0,
  "reviewRange.closedPullRequestLayerDefault": false
}
```

`historyRetentionDays = 0`は無期限保持を表す。

## 17. エラー処理

### 17.1 基本方針

障害によって誤った確認済み表示を行わない。直前の確実な状態を古い状態として維持するか、不確実な範囲を未確認へ戻す。

### 17.2 Revision contentのstable code

| code | 条件 |
|---|---|
| `missing-context` | contextからrepository rootを解決できない |
| `missing-revision` | immutable commitがない、またはcommitでない |
| `missing-file` | commitはあるがexact pathのblobがない |
| `invalid-encoding` | blobがvalid UTF-8でない |

権限、repository破損、safe.directory、timeout、I/O、実行file欠落はstable codeへ畳み込まない。invocation、exit code、stdout、stderrまたはprocess errorを保持する。

### 17.3 その他

- Git未導入: snapshot方式またはGit機能利用不能を明示
- diff parse失敗: 対象fileを未確認
- rename曖昧: 旧履歴を保持し新fileは未確認
- GitHub認証失敗: branch contextへfallback
- rate limit: cache利用
- 保存失敗: 成功表示せず再試行

## 18. セキュリティとプライバシー

- GitHub tokenをfileへ保存しない
- ソース本文とsnapshotを外部serviceへ送信しない
- snapshotはlocal extension storageへ保存する
- shell command文字列を構築しない
- logへtokenとsource本文を出さない
- private repositoryのpathやPR titleを診断logで抑止可能にする

## 19. パフォーマンス

目標:

- 確認操作後のdecoration反映: 100ms以内を目標
- 通常fileの編集追従で入力を阻害しない
- visible editorだけを装飾計算
- 1万変更行規模でもTree Viewを段階表示
- repository集計でExtension Hostを長時間占有しない

対策:

- normalized interval配列と二分探索
- file単位差分適用
- 進捗cache
- 大規模処理のchunk分割
- GitHub metadata・diff cache
- open file優先処理

## 20. テスト方針

### 20.1 Unit

- interval追加、結合、解除、境界
- edit/Git diff mapping、複数hunk、CRLF/LF、空白設定
- rename、copy、分割、曖昧候補
- PR/file進捗、Global混入防止、除外
- 仮想URI round-trip、collision、canonical性、上限、不正UTF-8
- POSIX特殊path、Windows禁止path・予約デバイス名
- missingとfatal failureの分離
- metadata/blob timeout error contract
- public barrel consumer contract
- architecture validatorと設計依存行列の一致
- Current Context、PR Progress、Review Contextsの既決UI要件
- 設計仕様が単一の機能別文書に統合され、task identifierを含まないこと

### 20.2 Integration

- temporary Git repositoryでbase/head、commit、rename、rebase、branch切替
- immutable revisionのoriginal/modified content
- PATHに存在しないportable Git絶対pathをmetadata・blob双方で利用
- POSIX特殊filename
- 4 MiB直下・直上blob
- invalid UTF-8 blob
- Gitなしfolderと複数repository

### 20.3 VS Code Extension Host

- 通常editor decorationとcommands
- diff editor両side
- dialog、Tree View、Status Bar
- restart後の復元
- actual `vscode.Uri`のparse・serialize・decode
- `TextDocumentContentProvider`のdelegation

### 20.4 Failure

- Git command/process failure
- GitHub 401/403/404/429、network断、patch欠落
- storage容量不足、JSON/snapshot破損、途中終了
- stale lock、複数window競合

CI失敗時はtest log、生成物、source、test、設定、環境情報をartifactへ保存する。

## 21. 受け入れ条件

1. 選択行とファイル全体を確認・解除できる
2. 確認済み行をグレー表示できる
3. 重複・隣接結合と部分解除分割が正しい
4. 編集・commit後に変更部分だけ未確認へ戻る
5. 一意なrenameを追従し、曖昧なcopy・移動を継承しない
6. PR、branch、workspaceで状態を分離できる
7. original側とmodified側で確認操作できる
8. 削除行をPR進捗へ含められる
9. PR進捗が対象追加・削除行だけを数える
10. 未確認file一覧と完了・除外・対象外分類を表示できる
11. Global理解率をPR進捗と別表示できる
12. 確認・解除がGlobalへ一貫して反映される
13. closed PRを並列管理できる
14. restart後に状態を復元できる
15. GitHub障害・Gitなし環境でも確実性を損なわず動作できる
16. 仮想URIからcontext、file、filesystem semantics、side、immutable revisionを復元できる
17. Local Git metadataとblobが同じruntime executable・timeoutを使用する
18. 大容量blobや不正encodingを誤表示しない
19. エラー時に不確実な範囲を確認済み表示しない
20. 恒久設計が本ファイル1つに機能別で整理されている

## 22. 将来検討

- 確認範囲へのメモと確認理由
- チーム共有と確認者情報
- 履歴閲覧UI
- GitHub Checks、GitHub App、外部同期
- 関数・クラス単位操作を生成する言語解析補助層
- UTF-16、Shift-JIS等の追加encoding policy
- cloud経由のGlobal状態同期

コアの行単位モデルと確実性優先の原則は維持する。
