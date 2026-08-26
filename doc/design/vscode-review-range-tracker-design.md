# VS Code レビュー範囲トラッカー 設計書 rev7

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
- folder階層・scope単位のGlobal理解率
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

Git diffの代わりに保存済みsnapshotと現在内容の行差分を使用する。snapshotはworkspace/fileごとのauthoritative latest-generation pointerで選択し、過去entryの探索やfallbackを行わない。pointerがmissing、破損、期限切れ、または最新保存に失敗した場合は当該fileを未確認とする。Global確認済みはそのワークスペース内だけで有効とする。

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

仮想文書descriptorはrevision sourceをdiscriminantとするunionで表現する。

```ts
interface ReviewDiffDocumentDescriptorBase {
  contextId: string;
  filePath: string;
  fileSystemPathSemantics: "posix" | "windows";
  side: "original" | "modified";
  revision: string;
}

interface GitCommitReviewDiffDocumentDescriptor
  extends ReviewDiffDocumentDescriptorBase {
  revisionSource: "git-commit";
}

interface EmptyReviewDiffDocumentDescriptor
  extends ReviewDiffDocumentDescriptorBase {
  revisionSource: "empty";
}

type ReviewDiffDocumentDescriptor =
  | GitCommitReviewDiffDocumentDescriptor
  | EmptyReviewDiffDocumentDescriptor;
```

`git-commit`は指定commitとpathに存在するexact blobを表す。`empty`はadded fileのoriginal側またはdeleted fileのmodified側など、比較revisionでfileが存在しないことを表すsynthetic immutable empty documentである。`empty`は論理path、context、side、比較revisionをURI identityとして保持するが、Local Git、GitHub、snapshot等の外部content sourceへ渡さずapplication providerが空文字列を返す。

外部content source portの入力型は`GitCommitReviewDiffDocumentDescriptor`だけとする。adapterは型境界に加えてruntimeでも`empty`を拒否し、同じdescriptorが呼出経路によって別内容を返す状態を禁止する。

同じpathでもcontext、side、revision source、revisionが異なれば別文書とする。別context、別side、別revision source、別revisionの内容を代用しない。

### 8.3 Immutable revision

`revision`は`git-commit`と`empty`の双方でlowercaseのfull SHA-1またはfull SHA-256 commit object IDに限定する。`HEAD`、branch、tag、短縮ID、revision range、Git optionとなる文字列を受理しない。

`git-commit`ではrevisionがexact blob取得元のcommit object IDである。`empty`ではfile本文の取得元ではなく、fileが存在しない側を特定するcomparison revisionとしてURI identityへ使用する。外部sourceへは送らない。

moving refはURI生成前にcommit object IDへ解決する。同じURIが後から別内容を返すことを禁止する。将来別の本文sourceを追加する場合は、新しいrevision sourceとimmutable ID、source dispatch、consumer contractを一体で定義する。

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

`revision-source`は`git-commit`または`empty`だけを許可する。codecはdecode後もdiscriminated unionを維持し、未知source、sourceとdescriptor shapeの不一致、padding、再encode不一致、不正UTF-8、userinfo、password、port、query、fragment、未知version、未知segmentを拒否する。

可変文字列はUTF-8のcanonical base64urlとする。

上限:

- URI全長: 65,536文字
- Context ID: UTF-8で8,192 bytes
- file path: UTF-8で32,768 bytes
- comparison revision: full SHA-1またはfull SHA-256

### 8.5 VS Code境界

- codec生成URIを`vscode.Uri.parse`できる
- `uri.toString(true)`がcanonical URIと一致する
- decode後のdescriptorとrevision source discriminantが完全一致する
- `TextDocumentContentProvider`は同じURIをapplication providerへ渡す
- application providerは`empty`を空文字列へ解決し、`git-commit`だけを外部content sourceへ委譲する

provider登録と`vscode.diff`実行はUI adapterが行う。

## 9. Local Git content取得

### 9.1 Runtime構成

metadata commandとblob commandは同一runtime optionsから構成する。

- `executable`: 全Git subprocessで同じ値
- `timeoutMs`: 全Git subprocessで同じ値
- `maxBufferBytes`: 旧呼出元とのsource compatibilityだけのdeprecated option。runtimeの出力上限には使用しない

metadata command、complete diff、blob commandのstdout/stderrはpipeから逐次消費し、`execFile.maxBuffer`へ全量を預けない。text resultが必要なcommandはprocess close後に取得済みchunkを完全な文字列へ結合し、blobはraw byte sequenceとして扱う。したがって4 MiBを超えるPR差分・revision差分・metadata出力を固定child-process bufferだけを理由に失敗させない。

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

binary判定はdecodeより先に行う。binaryであれば本文をtextへ変換せず`binary`として行単位レビュー対象外にする。

VS Code 1.125以降で開かれたfilesystem-backed `TextDocument`には、そのfileの`encoding`をhintとして保持する。live document本文は同一documentの`getText()`を使用する。Git revisionのcomplete raw byte sequenceは、対応するhintがありVS Codeが受理する場合だけ、同じhintを指定したVS Code `workspace.decode`で1回だけdecodeする。UTF-8 BOMはこのhintを通じてVS Codeのdecode結果に従う。これにより同じrepository内でShift-JIS、UTF-8、UTF-8 BOMが混在してもfileごとに独立してrevision mappingできる。

opened documentのhintがないfileは、従来どおりfatal UTF-8 decoderで1回だけdecodeする。この保守的fallbackはunknown fileを推測して別encodingへdecodeしないための境界であり、Shift-JIS等のhintなしfileをreplacement characterへ変換して対象化してはならない。hintがunsupported、または指定decoderでraw byte列が完全にdecodeできない場合は`unsupported-encoding`または`invalid-encoding`とし、当該fileだけを行単位レビュー対象外またはunresolvedとして隔離する。いずれの場合も他fileのmapping、Review Contexts、PR進捗、Global集計を失敗させない。

hintはrepository identityとstable file identityに結び付ける。一意なrenameまたはmoveでidentityを保持できるときだけ引き継ぎ、copy、new file、分割、統合、複数候補renameには引き継がない。document encodingまたは対応設定が変化した場合は、旧hintのdecoded text、content hash、line mappingを使用せず対象fileを再計算する。restart後はopen documentから再観測するまでhintを使わない。source本文、path、credential、encoding名を含む個別diagnosticをOutput logへ出してはならない。

Git objectから再取得可能な本文には固定の4 MiB上限を設けない。巨大入力の追加制御は性能計測に基づいて定義する。

### 9.5 Process failure contract

metadata commandとblob commandのtimeoutは、いずれもinvocation、streamから取得済みのpartial stdout、stderrを保持する`GitCommandFailedError`として返す。timeout時のsynthetic exit codeは`-1`とし、設定されたtimeout値をdiagnosticへ含める。

全Git subprocessはstdout/stderrをpipeで消費し、processの`close` eventで終了を確定する。timeout時も終了処理中に到着したchunkをdiagnosticへ追加し、固定buffer超過をtimeoutやGit failureへ読み替えない。

blob commandがtimeoutした場合は、まずSIGTERMを送信し、その後もstdoutとstderrの収集を継続する。通常経路ではprocessのclose eventを待ってからfailureを確定し、timeoutまでに得た出力と終了処理中の出力を同じdiagnosticへ含める。

SIGTERM後もtermination grace内にclose eventが発生しない場合はSIGKILLへ段階的に移行する。`child.kill()`が`false`を返した場合は送信失敗をdiagnosticへ記録し、close eventを待ちながら次の段階へ進む。SIGKILL後もgrace内にclose eventがない場合だけ、streamを破棄してchildをunrefし、process lifecycleが完了しなかった事実を含むbounded failureを返す。SIGTERMを無視するprocess、signal送信失敗、実際の終了signalを区別して記録する。

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

#### 10.2.1 Repository rootごとの観測順序

Git revision追従の入力はrepository root、完全なGit snapshot、rootごとの観測generation、および観測元（foreground `open`またはpoll）とする。rootごとに現在の`{ generation, snapshot }`を保持し、`observe()`は同じrootについてgenerationを単調増加させてsnapshotと一体で更新する。

pollは開始時に`{ generation, snapshot }`をcaptureしてinspectionとmappingを行う。callbackを実行する直前と永続化CASを再試行する直前に、captureしたgenerationとsnapshotが現在値に一致すること、さらに現在のGit snapshotがmapping targetと一致することを再確認しなければならない。いずれかが不一致なら、そのpollは`stale`として破棄し、callback、`observe()`、context/Global永続化を行わない。

foreground `open`がpollより新しいsnapshotを観測した場合は、foregroundの`observe()`がrootのgenerationを進める。先行pollの完了はこのgeneration検証で破棄され、foregroundが保存したrevisionを古いpoll targetへ巻き戻してはならない。CAS conflict後のretryも、先に現在のGit snapshotを再inspectionし、targetが変化していれば旧targetのmappingをretryせず最新snapshotから再計画する。

### 10.3 Rename・move・delete

一意なrenameとdirectory moveはfile identityと、そのfileにのみ結び付くopened document encoding hintを追従する。renameと同時に変更された行は未確認にする。encodingが変化したrenameは、変更後hintでrevision本文を再decodeし、確認済み範囲を推測継承しない。

コピー、分割、統合、複数候補は自動追従せず新規未確認とする。deleteは現在表示から除外するが、履歴とoriginal側review targetを保持できる。

#### 10.3.1 File-state snapshotと入力検証

ファイル遷移は、差分に関係しないfileも含む完全なfile-state snapshotを入力とし、完全なpost-transition snapshotを出力する。部分更新や途中状態は返さない。

処理前後のsnapshotではschema、file ID、current path、previous paths、revision、更新日時、content hash、line count、確認済みintervalを検証する。file IDはsnapshot keyと一致し、current pathは空でなくsnapshot内で一意でなければならない。line countとintervalは有効な範囲に収まり、previous pathsは空でなく重複せずcurrent pathを含まない。content hashを持つ場合は空文字列を許可しない。違反があれば遷移全体をrejectする。

Git diffはzero-context sectionとしてcanonicalに解析する。壊れたheader、重複・矛盾するstatus metadata、必須のsourceまたはdestination pathの欠落は、対象sectionだけを推測して継続せず、全遷移をatomicにrejectする。

#### 10.3.2 遷移graphと識別子の保持

rename、move、copy、add、deleteは変更前snapshotだけをsourceとして解決する。rename chain、path swap、sectionの並び順に依存する結果を許可しない。同一sourceに対するdeleteとrenameの併存、duplicate delete、同一destinationへの複数遷移を指定するdiffは矛盾としてatomicにrejectする。

一意に解決できるrenameまたはdirectory moveはstableなfile IDを維持する。旧current pathをprevious pathsへ重複なく記録し、rename先が履歴にあればそこから除去する。このため`A -> B -> A`のように過去のpathへ戻るrenameも、current pathをprevious pathsへ重複させず正当な遷移として扱う。

copy、add、および曖昧なdestinationはsourceの確認済み状態を継承しない新規未確認fileとする。deleteはcurrent snapshotからsourceを除去し、返却snapshotでは`files`と`deletedFileIds`へ同じfile IDを同時に含めない。

#### 10.3.3 Renameと内容変更の証明

renameと同時に内容が変わる場合は変更行を未確認に戻し、未変更部分だけを追従する。空白または改行の変更を無視する設定では、old/newの完全な本文がrevision、path、line count、および各diff hunkの行内容と一致する場合だけ同値性を認める。staleまたは無関係な全文、line countが一致しない全文、hunkを再現しない全文は証拠としてrejectし、確認済み状態を継承しない。

### 10.4 Rebase・force-push

1. 旧Git objectがあれば直接diff
2. なければ保存snapshotとdiff
3. renameと内容対応が一意なら追従
4. 曖昧なら未確認

SHAが変わっただけで全解除しない。

### 10.5 空白・改行

既定ではインデント、空白数、tab/space、CRLF/LF/CR、末尾改行、空fileの終端状態も変更として扱う。行mappingの証拠は各行の本文だけでなく行終端を含み、設定で明示した場合だけ該当差分を無視する。

## 11. PR進捗とGlobal理解率

### 11.1 PR進捗

```text
PR確認進捗 = 確認済み追加・削除行数 / 対象追加・削除行数
```

置換は削除1行と追加1行として数える。未変更周辺行とGlobal確認済みは算入しない。

進捗calculatorは任意の行番号配列やGlobal状態から推測せず、1つの比較を一体化した`PullRequestDiffSnapshot`と、その比較に一致するPR `ReviewContextState`だけを入力にする。

```ts
interface PullRequestDiffSnapshot {
  readonly contextId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly originalDiffId: string; // `${baseSha}..${headSha}`
  readonly files: readonly PullRequestFileChange[];
}

interface PullRequestFileChange {
  readonly fileId: string;
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly status: "added" | "modified" | "deleted" | "renamed" | "copied" | "binary";
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly DiffHunk[];
}

interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffLine[];
}

interface DiffLine {
  readonly kind: "context" | "addition" | "deletion";
  readonly oldLine?: number;
  readonly newLine?: number;
  readonly text: string;
}

interface CalculatePullRequestDiffProgressInput {
  readonly diff: PullRequestDiffSnapshot;
  readonly reviewContext: ReviewContextState;
  readonly exclusionPolicy: ReviewFileExclusionPolicy;
}

interface PullRequestDiffFileProgress {
  readonly fileId: string;
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly status: PullRequestFileChange["status"];
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
  readonly excluded: boolean;
  readonly exclusionReason?: ReviewFileExclusionReason;
}

interface PullRequestDiffProgress {
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
  readonly files: readonly PullRequestDiffFileProgress[];
}
```

`reviewContext.kind`は`"pull-request"`でなければならず、snapshotの`contextId`、`baseSha`、`headSha`はPR contextと一致しなければならない。`originalDiffId`は正確に`${baseSha}..${headSha}`とし、削除行の確認範囲はこのkeyの`originalReviewedByDiff`だけから読む。Global確認済み状態は入力・分子のいずれにも使用しない。

snapshotはcompleteかつvalidatedでなければならない。nonbinary fileは除外判定より先に、unified diff line kindとpositive one-based座標、hunk cursor/header/body/count/終端、zero-count anchor、hunk順序、old/new gap、累積delta、addition/deletion座標重複、統計、status/path/file ID/canonical display pathを検証する。file IDとcanonical pathはsnapshot内で一意とする。nonempty added/deleted fileは先頭から全行を表す単一complete hunkでなければならない。不完全、stale、曖昧な証拠は進捗を推測せずrejectする。

stateが存在するときはmap key、payload `fileId`、`revisionId === headSha`、canonical `currentPath`、`lineCount`、modified reviewed interval、modified-side hunk最大extentを照合する。state boundsまたはcontext/revision/pathが一致しない場合もrejectする。

追加行はmodified側、削除行はoriginal側で集計する。one-based changed coordinate `coordinate`は`coordinate - 1`でzero-based行indexへ変換し、`startLine <= coordinate - 1 < endLineExclusive`となるhalf-open `LineInterval`だけを対応範囲として照合する。

```text
reviewedLineCount =
  count(modifiedReviewed ∩ addition newLine)
  + count(originalReviewedByDiff[originalDiffId] ∩ deletion oldLine)

totalLineCount = additions + deletions
```

### 11.2 ファイル進捗

fileごとに確認済み変更行数、全変更行数、率、追加数、削除数を計算する。

未確認変更が残るfile、完了file、除外file、rename-only、binary/encoding対象外を別グループで表示する。

除外はvalidationを省略する理由にしない。nonbinary fileは構造とstateを検証した後で、除外された場合だけ集計分子・分母を0とする。raw resultは元の`additions`、`deletions`、status、path、exclusion reasonを保持する。file単位・PR全体とも分母が0の進捗率は100%とする。仮想diff文書はidentity-bound snapshotとold/new path・hunkをoriginal/modified表示へ再利用し、PR差分取得はrejectをpatch欠落・不完全時のfallback判断として再利用する。

PR Progress UIはraw calculator resultへline reviewabilityを適用し、binaryまたはencoding対象外fileをeffective分子・分母から除外する。このprojectionはraw `PullRequestDiffProgress`を変更・再利用せず、専用の`PullRequestEffectiveProgress`として公開する。

```ts
interface PullRequestEffectiveFileProgress {
  readonly raw: PullRequestDiffFileProgress;
  readonly reviewability: PullRequestLineReviewability;
  readonly category: PullRequestProgressTreeCategory;
  readonly effectiveReason?: string;
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
}

interface PullRequestEffectiveProgress {
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
  readonly files: readonly PullRequestEffectiveFileProgress[];
}
```

`raw`はauthoritative calculatorの変更統計とidentityを保持し、direct countはUI集計用effective countを表す。`reviewability`と`effectiveReason`により、`excluded = false`かつraw変更統計がnonzeroでもeffective分母が0となる理由をconsumerが復元できなければならない。raw resultとeffective projectionを型上で相互代入可能にしない。

### 11.3 Global理解率

```text
folder理解率 = 現在有効なGlobal確認済み非空行数 / 当該folder scopeで現在完全に把握できる非空行数
```

コメント行も非空なら対象とする。PR進捗とは別表示する。確認操作はGlobalへ自動反映し、解除操作は参照数に関係なくGlobalからも解除する。

Global Understandingはrepository rootを起動時、refresh時、またはfile open時に自動再帰走査しない。通常contextでcontentを読む契機は、開いたfileの所属folder scopeの開始、またはユーザーがfolder rowで明示した開始だけとする。PR contextのimmutable PR snapshotは、PR進捗の既存契約を維持するが、Global Understandingのためだけにrepository全体へ拡張しない。

folder scopeは`Repository ID + canonical repository root URI + canonical repository-relative folder path`で識別する。repository root自身は空pathのroot scopeとし、root直下の`.sln`等のfileはこのscopeにだけ属する。URI scheme、authority、path semantics、canonical pathが異なるmulti-rootは同じremote identityでも別scope identityとし、別checkoutまたはRemote workspaceの停止状態を混在させない。

fileを開いたときは、そのfileを含むfolder scopeを開始し、そのfolder直下のfileだけを読み取る。兄弟folder、その配下file、repository root全体を開始・読込・再帰列挙してはならない。root直下fileを開いたときだけroot scopeの直下fileを開始する。`reviewRange.globalUnderstanding.autoStartDescendants`がtrueの場合だけ、開始したfolderのdescendant scopeも再帰的に開始して読み取る。既定値falseではdirect fileだけで止める。この設定変更は次回以降のfile openにだけ適用し、既存のinactive scopeを開始せず、既にactiveなscopeを停止せず、停止済みscopeを再開しない。

folder rowの`開始`は、選択folderとそのsubtreeを明示的に開始する。開始中に見つかったpersisted stopped descendantは読込も再帰もせず、そのnodeをstoppedとして残す。これにより、共有folderを開始しても無関係な兄弟projectはinactiveまたはstoppedのままであり、兄弟へ走査を拡張しない。

各scopeは次の状態を持つ。`inactive`はこのsessionで未開始、`running`はcurrent generationを読込中、`active`はcurrent revisionで完全な結果を持ち変更に追従する状態、`stopped`は明示停止済み、`failed`はcurrent generationを完全化できなかった状態である。folder rowの同一action位置は、`inactive`または`failed`では`開始`、`running`または`active`では`停止`、`stopped`では`再開`を表示する。停止は対象scope以下のcurrent generationをabortし、結果をcurrentとしてpublishせず、scopeをrepository-local persisted stopped markerへ追加する。再開はそのmarkerを削除し、current revision、path、除外policy、content evidenceを再検証して新generationとして開始する。停止中folderのfile openは自動再開しない。

stopped markerだけを永続化する。restartではmarkerを復元して強調表示する一方、active/running/failed resultは復元も自動再走査もしない。marker不在のscopeはinactiveから始める。markerのkey、schema version、canonical path、repository root identityが不正または照合不能なら、そのmarkerを採用せず当該scopeをinactiveとしてfail closedに扱い、別scopeへ転用しない。

scopeのdirect resultは次の3分類を持つ。

- `included`: 当該scope直下で実際に読み取り、現在revisionでline-reviewableと確定したfile。各fileの非空行数だけを分母へ加算する。
- `excluded`: 実際にfileとして読込または判定した後、binary、hintなしのfatal UTF-8 decodeで`invalid-encoding`となったfile、opened document hintの`unsupported-encoding`・`invalid-encoding`となったfile、共通除外policy、`.gitignore`、symbolic link等で除外したfile。除外file数はこの件数とする。
- `excludedDirectories`: 共通除外policyまたは`.gitignore`により再帰前にpruneしたdirectory。1 directoryにつき1件だけ保持し、配下fileへ展開・推定しない。

`included`、`excluded`、`excludedDirectories`はlocaleに依存しないrepository-relative pathのcode-unit昇順で、各配列内に重複pathを持たない。pruneしたdirectoryと配下fileはGlobal理解率の分子・分母へ寄与しない。directory件数は列挙診断としてfile除外数とは別に扱い、除外file数へ加算しない。

folder nodeのcurrent totalは、currentでcompleteなdirect file totalと、currentでcompleteな直下child folder totalの和とする。child folderは自身の理解率を表示する。直下childがinactive、stopped、running、failed、cancelled、またはcurrent revisionで未completeなら、親nodeは`partial`であり、把握済み部分のcountを表示してもrepositoryまたはfolder全体の分母・百分率であるかのように表示してはならない。parentがactiveでも、child scopeがinactive/stopped/incompleteならcompleteへ遷移しない。全直下childがcurrentかつcompleteである場合だけ親はcomplete totalと理解率を表示する。

active scopeに属するdirect file、directory entry、Git/workspace revision、opened-document encoding、除外設定、またはactive childの結果が変化したときは、当該scopeと必要なancestor aggregateを新generationで再計算する。この通知はinactive/stopped siblingを開始せず、停止markerを越えて再帰しない。各I/O、bounded stage、cache write、tree/status publishの前後でgenerationとAbortSignalを照合し、stop、restart、newer change、dispose、failure、cancel後の古い結果をpublishしない。cancelledまたはfailed scopeとそのancestorはcomplete denominatorを保持せずpartialへ戻す。

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
- hintなしでvalid UTF-8としてdecodeできないtext blob
- opened document hintがunsupportedまたはinvalidとなるtext blob
- `.git`配下
- 本拡張が管理しない仮想document

既定除外:

- `node_modules`
- `bin`、`obj`、`dist`、`build`
- repository列挙時に`.gitignore`へ一致するfile

repository列挙では、除外directoryを再帰前にpruneする。共通除外policyによるpruneは、明示的なrecursive globがdirectoryの全descendantを除外すると証明する場合だけ許可し、file-oriented globの一致やsynthetic child名からsubtree除外を推定しない。pruneしたdirectoryは1件のdirectory診断として保持し、その配下fileを個別の除外fileとして数えない。

root `.gitignore`のtrailing `/` ruleはdirectory entryだけへ適用し、同名regular fileを除外しない。negated ruleも同じentry kindで最後の一致を判定する。

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

UI層はapplication serviceまたはapplication portへ依存し、adapters層を直接importしない。application層はruntime技術を知らず、portとuse caseを定義する。snapshot圧縮、SHA-256、binary buffer、filesystem I/Oはapplication層へ持ち込まずadapterが実装する。adapters層はapplication/core contractを実装する。

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

Composition RootはLocal Git、GitHub、snapshot codec、local extension snapshot storage、state storage等のruntime adapterを生成してapplication portへ注入し、そのapplication serviceをUIへ渡す。UI command、Tree View、TextDocumentContentProviderがLocal GitやGitHub adapterを直接生成・参照することを禁止する。

### 13.3 主要コンポーネント

- UI Adapter: command、dialog、decoration、Tree View、Status Bar、Output Channel、diff表示
- Operation Feedback Service: 非同期operationの開始・成功・失敗、active operation stack、diagnostic eventをruntime-neutralに管理
- Review Context Resolver: repository、branch、PR、fallback context解決
- Review State Service: interval、context/Global transaction、history request
- Range Mapping Engine: edit/Git/snapshot差分追従
- Progress Calculator: PR/file進捗、Global理解率
- Local Git Adapter: repository metadata、diff、object、immutable content
- GitHub Adapter: 認証、PR metadata、file、content
- Snapshot Adapter: Gitなし・object欠落時のsnapshot差分
- State Repository: atomic persistence、migration、routing
- History Store: append-only event

Operation Feedback Serviceはapplication層に置き、VS Code固有のStatus BarとOutput ChannelはUI adapterのhostとして注入する。operation serviceからVS Code APIまたはruntime adapterを直接参照しない。

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

lockは同じ`ReviewStateStorageRoute.rootPath`内の`lock`を`wx`で作成して取得し、opaque owner token、process liveness identity、短いlease expiryを保存する。取得待ちの上限はmonotonic elapsed timeで判定し、協調ownerがliveである限りclock expiryだけでは奪わない。crash、dead owner、partial lockだけをbounded recoveryし、recoveryはsuccessorの`lock`を再公開・削除しない。renew/releaseは取得済みdescriptorでowner tokenを再検証してから更新し、leaseを失ったoperationはContext、Global、manifest、history、cache、snapshot、migration/quarantineを含む各不可逆publication直前にfail closedにする。Node mutationはrootのphysical descendantへ解決し、開始時またはoperation中に検出したsymlink、junction、reparse ancestor・identity changeをrejectしてfail closedにする。stateのload/save/create/commit、history append、startup migration、snapshot/cache cleanupは同じroot lock transaction内で行う。snapshot save transactionはgeneration write、in-flight protection、latest pointer publish、retention/count/byte cleanupを一体化し、current pointerが参照するgenerationを保持する。alternate `AtomicTextFileStore`は同じroot transaction coordinatorを全persistence familyへ渡す。lock timeout、失敗、stale recoveryはoperation種別だけを`Review Range` Output lifecycleへoperationごと一度だけ通知し、起動失敗時にもactivation-safe hostへflush/revealし、repository path、source、owner tokenを出力しない。既存の同一process直列化は維持する。

filesystem脅威モデルは、VS Codeが提供する信頼済みstorage root内で動くRevMemの協調Extension Host/window、crash、partial I/O、およびoperation開始時に存在するlink/reparseを対象とする。同じhost上の攻撃者がrootまたはancestorをsyscall間で意図的に差し替える競合は対象外であり、pure Node実装は`openat`/handle-relative rename等のnative filesystem primitiveを導入しない。この非保証はroot外mutationを許容するものではなく、検出可能なidentity変化でoperationを停止し、既存link/reparse経由ではroot外sentinelに触れないという保証を定義する。

新contextを作成するtransactionは、対象contextが存在しないこととowner-wide Globalの期待snapshotおよびversionを同じCAS条件に含める。入力は対象Context ID、現在Git snapshot、context不存在期待、Globalの存在状態を含む完全snapshot、Global versionである。Globalが異revisionなら、その入力snapshotからmappingしたnext contextとnext Globalを1 transactionで公開する。読込、mapping、保存を分離した非atomicなwindowを設けない。

create/CASがstaleならcontextとGlobalのいずれも公開せず、`stale`を返す。呼び出し側は最新Globalと現在Git snapshotを再読込してmappingを再計画する。既存contextの通常更新と新context初期化はともに、片側だけの保存または古いGlobal snapshotによる置換を許可しない。

### 15.3 Schema migration

全保存modelに`schemaVersion`を持たせる。起動時に段階移行し、移行前backupを作成する。破損dataは隔離し、不確実な範囲を確認済みにしない。

### 15.4 履歴

履歴はJSON Linesのappend-only eventとし、初期版では閲覧UIを提供しない。1 eventは1行のUTF-8 JSON objectとしてcanonicalにserializeし、改行を含む値や整形済みJSONを許容しない。event schemaの初期versionは既存の`schemaVersion`と同じversionであり、readerは未知version、未知field type、欠落required field、file/context discriminatorとの矛盾、非有限number、範囲外または未正規化intervalを推測・補完せずrejectする。

event共通のrequired fieldは`schemaVersion`、`eventId`、`occurredAt`、`sessionId`、`repositoryId`、`contextId`、`revisionId`、`type`、`reason`である。`eventId`はsession内だけでなく履歴処理全体で一意なopaque ID、`occurredAt`はUTC ISO 8601 timestamp、`reason`は機械可読な遷移原因とする。`type`がfile eventの場合だけ`filePath`、`diffSide`、`previousRanges`、`nextRanges`をrequiredとし、context eventではこれらをnullableにせずfield自体をomitする。file eventの`previousRanges`と`nextRanges`は常にContext側の0始まり半開区間をcanonical orderで保存する。

ContextとGlobalを同時に更新する新規file eventは、既存range fieldを変更せず、`rangeRepresentation: "context-and-global"`、`globalPreviousRanges`、`globalNextRanges`を追加する。これによりContext/Globalのbefore/afterをlosslessに監査できる。追加fieldのない既存JSONLはContext-onlyのlegacy eventとしてそのままreaderが受理し、schemaVersion、既存fieldの意味、canonical serializationを変更しない。`rangeRepresentation`があるeventは3つの追加fieldをすべて持ち、Global rangeも同じ正規化規則に従わなければならない。

file event typeはユーザー操作の`marked-reviewed`、`unmarked-reviewed`、`marked-file-reviewed`、`unmarked-file-reviewed`、編集結果の`invalidated-by-edit`、Git diff再計算結果の`remapped-by-diff`、renameの`file-renamed`、deleteの`file-deleted`、一意に対応付けられない場合の`mapping-unresolved`である。context event typeは`context-created`と`context-revision-changed`である。各成功したstate transactionまたはcontext初期化・revision mapping結果は、affected fileごとに1 eventをappendする。失敗、cancel、no-op、またはstate commit前の計画はeventをappendしない。state commit後のhistory append失敗はstate rollbackを要求せず、呼び出し側へobservable partial successとしてrejectする。

保存先はstateと同じ`ReviewStateStorageRoute`で解決する。Git/PR/external fileは`globalStorageUri/repositories/<repository-id-hash>/history/events-YYYY-MM.jsonl`（external fileは`external-files` subtree）、Gitなしworkspaceはcanonical ownerごとの`storageUri/workspaces/<workspace-id-hash>/history/events-YYYY-MM.jsonl`であり、異なるworkspace ownerはhistoryを共有しない。月はeventの`occurredAt`をUTCで評価する。appendは同一storage ownerごとに直列化し、同じroot lock内で既存完全行を保持した末尾へcanonical eventと1つのLFを加える。read/validationで既存JSONLの破損行を検出した場合、active file全体をquarantineへ保持してactive pathから除去する。次のvalid eventだけが新しいactive monthly fileの1行目となり、旧fileのvalid recordはsalvage・replay・mergeしない。未知future schemaはquarantine/resetせず互換性errorとしてrejectする。appendは一時fileへの全内容書込み、flush、replaceを用いるため、成功時にだけeventを可視化し、失敗時は直前のhistory fileを保持する。

現在状態は履歴から毎回再構築せず、state repositoryが管理するcontext/Global snapshotを唯一の現在状態とする。履歴はaudit evidenceであり、起動時のstate load、decoration、command、mappingの入力にreplayしない。履歴は原則無期限保持し、`historyRetentionDays=0`は無期限を意味する。cacheとsnapshotのimmutable generationは、active pointerが参照するgenerationを保護した上でbounded cleanupの対象にできる。cleanupはroot内だけを対象にし、symbolic link、junction、reparse pointを経由して書込みまたは削除しない。閲覧UI・exportは将来の履歴管理機能の責務とする。

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

Extension activationおよびactive editor変更に伴うCurrent Context更新は非対話で実行する。保存済みCurrent Contextまたは一意な候補を復元できる場合だけ表示を更新し、候補0件または複数候補ではQuick Pickを開かず、既存のCurrent Contextと依存viewを維持する。ユーザーが現在状態の再計算またはCurrent Context選択commandを実行した場合だけ、複数候補のQuick Pickを表示する。取消または選択後の再検証でstaleとなった場合も、受理済みの表示・選択・依存viewを変更しない。

PRが解決されていない場合はbranchまたはworkspace contextを表示し、GitHub障害中でもローカル確認操作を停止しない。

PR再検出でGitHub障害、候補0件、または候補選択取消となった場合は、repositoryとimmutable HEADごとに明示したbranch/no-PR選択を表示設定として保存する。この選択は同じHEADの保存済みopen PRが1件だけ存在しても自動推測を抑止し、通常editorの確認操作と装飾はbranch contextへ戻す。成功したPR選択は同じrepository/HEADのbranch/no-PR選択を置換する。表示設定はReview State、review history、PR metadata、Global stateを変更しない。

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

行単位レビュー可能なfileを選択すると、そのcontextのidentity-bound diff editorを開く。「次の未確認行」へは自動移動しない。

binary、不正encoding、未対応encoding等の「行単位レビュー対象外」fileを選択した場合も、PR snapshotのpresent sideを開く。deleted fileはoriginal/BASE side、added・modified・renamed fileはmodified/HEAD sideを選び、存在しないsideをworking treeまたは反対sideへ読み替えない。open targetはsnapshot ID、context ID、BASE/HEAD revision、original diff ID、filesystem path semantics、および選んだpresent sideのpath/revisionを保持する。VS Code hostはこのimmutable targetを検証し、exact revisionを指定したfile-open URIで開く。working treeのHEAD checkout状態、dirty content、rename後のpath、またはworkspace folderの選択をopen identityの代用にしてはならない。current snapshotに属さないnodeまたはtargetはstaleとして拒否する。

line-review-unsupportedのselection resultは`opened-file`であり、対象外理由はnode表示に残す。text diff hostは呼ばない。公開`PullRequestProgressTreeHost`は`openDiff`に加えて`openFile`を必須で実装し、公開selection unionをexhaustiveに扱うconsumerは`opened-file`を処理する。VS Code Tree View adapterはopen failureをPR Progress専用error boundaryへ渡す。Unit testはpresent sideの選択、deleted/rename/stale target、host呼出しとtext diff非呼出しを固定し、Extension Host testはHEAD未checkoutまたはworking tree相違でもexact revisionのURIとpresent-side contentを確認する。

既定sort:

1. 未確認行数の降順
2. ファイルパス昇順

sort切替候補:

- PR上の順序
- パス順
- 未確認行数順
- 進捗率順

rename-onlyは「行以外の変更」、binaryおよびencoding対象外は「行単位レビュー対象外」へ表示する。

#### 16.3.1 PR Progress更新ライフサイクル

Current ContextがPRを選択した場合、PR Progress計算はReview ContextsのPR差分取得・runtime登録が完了した後に開始する。未登録runtimeを「変更なし」や`0/0`として扱ってPR Progressをclearしてはならない。Review Contextsが対象`PullRequestDiffSnapshot`を登録できなかった場合は、そのfailureをoperation boundaryへ返し、存在しないsnapshotから進捗を推測しない。

同一immutable snapshotは`contextId + baseSha + headSha + originalDiffId`で識別する。同じsnapshotに対する重複refreshは同一の進捗計算を共有または直列化し、互いをsupersedeしてcancelしてはならない。直前に同じsnapshotのcomplete Treeを受理済みなら、再計算中はそのTreeを保持し、新しいcomplete resultをatomicにswapする。別snapshotへidentityが変化した場合だけ旧計算をsupersedeでき、旧snapshotのcompletionを新しいTreeへpublishしない。

初回計算では受理済みTreeが存在しないため、未完了状態を`0/0 = 100%`等の確定進捗へ読み替えない。PR Progressの結果が確定するまでは16.7のactivity progressで処理中であることを表示し、完了後にだけfile Treeをcomplete snapshotとしてpublishする。失敗時は17章のfail-closed契約に従い、Outputへ原因を残す。

Current Context更新、Review Contexts更新、PR Progress再計算という上位operationには、処理全体のwall-clock経過時間だけを理由にするtimeoutを設けない。長時間処理はcount-only progressを継続して可視化する。Local Git subprocess、storage lock、GitHub request等の個別I/O境界が既存のbounded timeout・retry・failure contractを持つ場合はその契約を維持するが、上位operationの総経過時間を別のtimeoutとして重ねない。

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

Review ContextsのVS Code Tree row identityは表示labelではなく`contextId`へ束縛する。同じPR番号・同じ表示labelを持つPRが別repositoryに存在しても異なるTreeItem identityとし、refresh前後で同じcontextは同じidentityを維持する。repository名やpathを表示identityのためにOutputへ露出させない。

### 16.5 Global Understanding View

表示項目:

- repository rootとfolderの階層tree
- complete scopeの理解率、確認済み非空行数、対象非空行数
- direct fileとchild folderごとの理解率
- `inactive`、`running`、`active`、`stopped`、`failed`、`partial`のscope状態
- folder rowの同一位置に置く`開始`、`停止`、`再開`action
- 除外file数
- pruneした除外directory数（診断情報）

初期treeはrepository全体をcompleteとして表示しない。file openで発見したfolderへのancestor chain、明示開始したfolder、開始scopeのdirect child folderだけを表示し、未開始nodeを`inactive`として表示できる。inactive sibling folderを表示するためのdirectory entry取得は許可するが、そのdescendant file本文を読まない。root scopeはroot直下fileを開くかroot rowで明示開始した場合だけ内容を計算する。

`running`はspinner、`stopped`は視認性を高めたlabelと`再開`action、`failed`はgenericな失敗表示と`開始`actionを持つ。停止済みまたはinherited停止により未計算のchildを含むparentは`partial`を明示し、complete ratioを表示しない。partial nodeのcountは「現在把握済み」としてlabel付けし、未知のinactive/stopped/incomplete childを分母ゼロまたは既知分母だけへ読み替えない。selection、file open、action targetはrepository root identity、canonical scope path、current generationへ束縛し、stale nodeまたは別multi-root nodeのactionを拒否する。

除外file数は開始済みscopeの列挙結果の`excluded.length`だけを表示し、`excludedDirectories.length`を加算しない。pruneした除外directory数は別の診断項目として表示する。PR Progressとは別sectionで表示する。

### 16.6 Editor decoration

確認済み行はtheme対応の半透明グレー背景と任意のgutter iconで表示する。Overview Rulerは既定無効。hoverへcontext、確認日時、Global状態を表示する。

visible editorだけを装飾対象とし、現在PRの未確認変更行はGlobalだけでグレーにしない。

### 16.7 Status Bar

通常状態ではcontextと理解率を表示する。

```text
PR #123: 67% | Global: 42%
```

PRがない場合はbranchまたはworkspace contextを表示する。

Git、GitHub、永続化、revision mapping、PR Progress、Global再計算、Review Contexts更新など、ユーザー操作またはbackground refreshから開始した非同期処理が継続している間は、通常のcontext表示とは別の一時activity itemを表示する。

```text
$(sync~spin) Review Range: PR進捗を計算
$(sync~spin) Review Range: PR進捗を計算 · pull-request-files 24/87
```

operation labelはpath、repository名、PR title等を含まないgenericな文言とする。複数処理が重なった場合は最後に開始したactive operationを表示し、tooltipへactive件数を示す。内側の処理終了後は直前のactive operation表示へ戻し、active処理が0件になった時だけactivity itemを隠す。開始・進捗・成功・失敗の各遷移はOutput logと同じoperation lifecycleで管理する。

長時間operationのcount-only progressはallowlistされた固定stageだけを用いる。初期stageは少なくとも`repositories`、`pull-request-contexts`、`pull-request-files`を持つ。総数が確定している場合は`completed/total`、まだ確定していない場合は`completed`だけを表示できる。`completed = 0`も有効な進捗であり、未開始や非表示と混同しない。値は非負safe integerとし、totalがある場合は`completed <= total`を満たす。

progressはrepository名、repository path、file path、file名、PR番号、PR title、source本文、credential、tokenを含めない。個別対象名を進捗表示へ追加する代わりに、匿名件数とgeneric operation labelだけで処理段階を識別する。同じstage/countの重複eventは抑止できるが、実際にcountが進んだ場合はactivity itemを更新する。

短時間で同期完了するpure calculationだけを独立したactivityとして表示する必要はないが、その計算がI/Oを伴う上位operationの一部である場合は上位operationのstatusを維持する。

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
- Global Understanding folderを開始する
- Global Understanding folderを停止する
- Global Understanding folderを再開する

folder actionはTree rowの同一action位置をprimary UIとし、Command Paletteでは選択中のcurrent-generation folder nodeだけを受け付ける。commandはCommand Paletteと適切なeditor context menuへ登録する。

### 16.9 主な設定

```json
{
  "reviewRange.showGlobalReviewed": true,
  "reviewRange.ignoreWhitespaceChanges": false,
  "reviewRange.ignoreEolChanges": false,
  "reviewRange.showGutterIcon": true,
  "reviewRange.showOverviewRuler": false,
  "reviewRange.globalUnderstanding.autoStartDescendants": false,
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

`reviewRange.globalUnderstanding.autoStartDescendants`はbooleanであり、file openが開始する所属folder scopeのdeeper descendantを自動開始・読込するかを制御する。既定値falseは、開いたfileの所属folder直下fileだけを対象にして、privacyとExtension Host負荷を優先する。trueでも停止済みdescendantは開始しない。これはGlobal layer表示設定とは独立であり、layerを非表示にしてもscope開始・停止の永続状態を変更しない。

### 16.10 Output log

`Output > Review Range`へ、observableな非同期operationのlifecycleを1行ずつ記録する。各entryはUTC timestamp、genericなoperation label、`START` / `PROGRESS` / `OK` / `ERROR`、完了時のduration、失敗時のerror name/messageを持つ。

`PROGRESS` entryは16.7と同じallowlist済みstageと匿名件数だけを持つ。例:

```text
[2026-08-24T03:00:00.000Z] PROGRESS Review Contextsを更新 stage=repositories progress=2/3
[2026-08-24T03:00:01.000Z] PROGRESS Review Contextsを更新 stage=pull-request-contexts progress=5/8
[2026-08-24T03:00:02.000Z] PROGRESS PR進捗を計算 stage=pull-request-files progress=24/87
```

stack trace、source本文、GitHub token、credential、repository path、repository名、file path、file名、PR番号、PR titleはOutputへ追加しない。error message内の改行は1行へ正規化する。同一のError objectがoperation wrapperとUI error boundaryの双方へ到達した場合は、同じfailureを重複記録しない。

失敗したoperationはOutput channelを表示して診断可能にするが、editor focusを奪わない。PR ProgressやGlobal再計算などがfail-closedで空表示・未確認表示へ戻る場合も、取得attemptまたは処理段階と原因をOutputへ残し、無言で`undefined`へ変換しない。長時間operationはwall-clock timeoutを追加する代わりに、処理段階が変化した時または匿名件数が進んだ時に`PROGRESS`を記録する。

## 17. エラー処理

### 17.1 基本方針

障害によって誤った確認済み表示を行わない。直前の確実な状態を古い状態として維持するか、不確実な範囲を未確認へ戻す。

### 17.2 Revision contentのstable code

| code | 条件 |
|---|---|
| `missing-context` | contextからrepository rootを解決できない |
| `missing-revision` | immutable commitがない、またはcommitでない |
| `missing-file` | commitはあるがexact pathのblobがない |
| `invalid-encoding` | hintなしのblobがvalid UTF-8でない、またはopened document hintで完全にdecodeできない |
| `unsupported-encoding` | opened documentのencoding hintをVS Code decodeへ安全に渡せない |

権限、repository破損、safe.directory、timeout、I/O、実行file欠落はstable codeへ畳み込まない。invocation、exit code、stdout、stderrまたはprocess errorを保持する。

### 17.3 その他

- Git未導入: snapshot方式またはGit機能利用不能を明示
- diff parse失敗: 対象fileを未確認
- rename曖昧: 旧履歴を保持し新fileは未確認
- GitHub認証失敗: branch contextへfallback
- rate limit: cache利用
- 保存失敗: 成功表示せず再試行
- PR進捗取得失敗: 進捗を表示せず、local Git・GitHub・cache等の取得attemptと最終原因をOutputへ記録
- Global/Review Contexts等のfail-closed処理: UI上は不確実な結果を採用せず、failureをOutputへ記録してactivity statusを終了する
- folder scope開始・再開失敗: 当該scopeとancestor aggregateを`failed`または`partial`へ戻し、未complete totalをcompleteとして表示しない。停止・cancel・stale generationはERRORとして扱わず、古い結果をpublishしない
- Current Context、Review Contexts、PR Progressの上位operationは総経過時間だけではtimeoutさせない。個別I/Oの既存timeout・retry failureだけをfailureとして扱う

## 18. セキュリティとプライバシー

- GitHub tokenをfileへ保存しない
- ソース本文とsnapshotを外部serviceへ送信しない
- snapshotはlocal extension storageへ保存する
- shell command文字列を構築しない
- logへtoken、credential、source本文、stack traceを出さない
- operation labelはrepository path、repository名、PR titleを含まないgenericな文言にする
- private repositoryのpathやPR titleを診断logへ出さない
- operation progressはallowlist済みstageと匿名件数だけを出力し、repository名、file名、PR番号、PR titleを出さない
- folder scopeの開始は、file open時の所属folder直下file、またはユーザーが明示開始したfolder subtreeだけにcontent readを限定する。設定既定値とrestartはrepository全体の自動読込を発生させない
- persisted stopped markerはrepository root identityとcanonical relative folder pathだけを保持し、source本文、file一覧、credential、未開始folderのcontent classificationを永続化しない

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
- Git subprocessのstdout/stderr逐次消費による固定child-process buffer上限の排除
- open file優先処理

### 19.1 大規模UI公開と測定契約

PR Progress と Global Understanding の Tree projection は、完全な入力 snapshot を先に検証し、generation ごとに bounded stageで処理する。stage は決定的な item budget で区切り、各境界でschedulerへ制御を戻す。新しいgeneration、cancel、dispose、または失敗が発生した場合、古いstageは以後publishせず、現在のselection/open targetも古いnodeを受理しない。Global Treeの部分stageは同じgenerationの確定済みprefixだけを表示し、PR Progressは全validation/projection後の一回のcurrent-generation swapまで前のcomplete Treeを保持する。

PR Progressのsupersession単位はimmutable snapshot identityとする。同一`contextId + baseSha + headSha + originalDiffId`の重複refreshは別generationとして互いをabortさせず、同じ計算の完了を共有または順次再計算する。snapshot identityが変わった場合、explicit clear、disposeの場合だけ旧progress ownerを失効できる。Current Context依存refreshではReview Contextsによるdiff runtime登録をPR Progress計算より先に完了させる。

各 stage は raw progress、effective denominator、file identity、line-reviewability の整合を維持する。stale、cancel、failure は未確認または空表示へ fail-closed し、source本文、repository path、credential、PR title を診断へ追加しない。Tree の段階公開は入力処理を待機させず、既存のPR progress、Global aggregation、cancellation/error boundary の contract を変更しない。上位operationのwall-clock timeoutを性能対策として導入せず、bounded work schedulingと匿名count progressで応答性・可観測性を確保する。

folder scopeの開始・再開・変更追従も同じbounded stageを使用する。file openのimplicit startは所属folderのdirect fileだけをwork itemにし、設定で許可したdescendantまたはexplicit subtree startだけがchild folderをenqueueできる。stopped descendantとinactive siblingはwork queueへ追加しない。scopeごとのgeneration、AbortSignal、direct result、child aggregateを分離し、child completionでparentを再集計するときも本文再読込ではなくcurrent child resultを使用する。stop、cancel、newer change、disposeで失効したstageはcache、tree、status、parent totalのいずれにもpublishしない。

通常 editor の selection-to-decoration は visible editor のみを対象とし、同一 editor の最新generationだけを適用する。descriptor/hash、interval validation・normalization、merge-sort、intersection/subtraction、decoration append、host option/apply のすべてを同じgeneration-aware item budgetで協調実行し、各checkpointでsupersessionを拒否する。100ms は wall-clock-only の自動gateにせず、装飾作成・適用までの最大同期 work と visible-editor 数を決定的な budget として検証する。実測は advisory evidence とし、環境、workload、回数、before/after 値を implementation report へ記録する。

性能回帰 harness は少なくとも 10,000 changed-line PR、large repository aggregation、多数の reviewed interval、visible-editor decoration を同じ fixture generation と work/count budget で再現する。benchmark は時間だけで成否を決めず、stage 数、stage 当たりの最大 item 数、yield 回数、stale-generation の非公開、memory を不必要に二重保持しないことを検証する。validation、sorting、projection、status summary、decoration descriptor/hash、interval model、host apply を含む各同期段階は同じ明示budgetに収める。

性能回帰 harness と大規模workloadはdeveloper-localの手動検証専用とし、共有CIの合否判定では実行しない。`test:t607`はローカル入口として維持するが、通常unit suiteとCI workflowから除外する。CIはこの分離契約を軽量な静的検査で確認し、PC、runner負荷、仮想化方式によって変わる経過時間・memory・throughputをmerge gateにしない。

production scheduler はmicrotaskだけで済ませず、Extension Hostがtimer、I/O、document change、disposeを処理できるevent-loop boundaryを使う。PR diff のfile/hunk/line validation、reviewed interval normalization、Global candidate/evidence/aggregate、Review Contextsの保存済みcontext/progress準備、document line fragment hash、decoration option/bookkeeping/applyは、最新generationとAbortSignalを各stage後に確認する。通常editor descriptorはtext、lineCount、document versionを同じsnapshotとして束縛し、同じ行数のtext editもrequestを無効化する。

Git command結果を最終的に完全なstringとして必要とする既存application contractは維持するため、streamingはchild-process pipeの消費方式を指し、巨大diffを無制限に保持してよいという意味ではない。追加のmemory上限またはincremental parserが必要になった場合は、実測に基づいて別途contractを定義する。

## 20. テスト方針

### 20.1 Unit

- interval追加、結合、解除、境界
- edit/Git diff mapping、複数hunk、CRLF/LF、空白設定
- rename、copy、分割、曖昧候補
- PR/file進捗、Global混入防止、除外
- raw PR進捗とline-reviewability適用後のeffective進捗の型・意味分離
- binary、不正encoding、未対応encoding nodeのselection resultとtext diff host非呼出し
- active editorなし・非Git editorでのrepository候補解決、単一root・multi-rootの決定順、Quick Pick取消、stale root、path変換不能なremote/virtual URIのfail-closed
- opened Shift-JIS、UTF-8、UTF-8 BOM documentと同一hintでdecodeしたGit revision blobのmapping、同一repository内のmixed encoding、new fileとhintなしfallback
- encoding変更時のfile単位再計算、一意rename時だけのhint継承、copy・曖昧renameでのhint非継承、whitespace/EOL mappingとの組合せ
- Global列挙結果のfile/directory分離、除外数単位、安定sort、重複path禁止
- file openが所属folderのdirect fileだけを開始し、root fileだけがroot scopeを開始すること。default設定でroot-wide scan、兄弟folder、未開始descendantのcontent readが起きないこと
- `autoStartDescendants`のtrue/false、設定変更が既存scopeを開始・停止・再開しないこと、explicit folder startが停止済みdescendantをskipすること
- folder scope identityのcanonical path、repository root URI、path semantics、multi-root別離、restart後のstopped marker復元とactive scope非復元
- `inactive`/`running`/`active`/`stopped`/`failed`遷移、同一row actionの開始・停止・再開、再開時のrevision・除外policy再検証、停止時のstale publication拒否
- parent totalがdirect fileとcomplete child totalの和であること、inactive/stopped/running/failed childを持つparentがpartialとなりcomplete denominator・百分率を表示しないこと
- direct file、active child、Git/workspace revision、encoding hint、除外設定の変更時にactive scopeとancestorだけを再計算し、inactive/stopped siblingを開始しないこと
- 仮想URI round-trip、collision、canonical性、上限、不正UTF-8
- `git-commit` / `empty` descriptor union、source dispatch、empty documentの外部port非委譲
- POSIX特殊path、Windows禁止path・予約デバイス名
- missingとfatal failureの分離
- metadata/blob timeout error contract
- 4 MiBを超えるmetadata/complete diff stdoutのstream取得
- operation statusの開始・入れ子復元・終了とOutput logの成功・失敗・重複抑止
- operation progressのallowlist stage、0を含む匿名count、Status Bar反映、`PROGRESS` Output、同一count重複抑止、privacy-safe validation
- Review ContextsがPR runtimeを登録してからPR Progressを計算する依存順序
- 同一immutable PR snapshotの重複refreshが互いをcancelせず、受理済みTreeを再計算中に保持すること
- 同一PR番号・表示labelを持つ別repositoryのReview Contexts rowが`contextId` identityで衝突しないこと
- fail-closedで握りつぶされる処理もOutputへfailureを残すこと
- public barrel consumer contract
- architecture validatorと設計依存行列の一致
- Current Context、PR Progress、Review Contextsの既決UI要件
- Architecture positive/negative gateをCIで実行し、設計contract testを通常unitとfocused suiteの両方で実行すること
- 設計仕様が単一の機能別文書に統合され、task identifierを含まないこと
- 新contextのmapping中に別contextがGlobalを更新した場合、create/CASが`stale`となり、最新Globalから再計画して確認済み範囲を失わないこと
- pollがGit snapshotをmapping中にforeground `open`がより新しいsnapshotを観測した場合、古いpoll completionを破棄し、保存済みrevisionを巻き戻さないこと

### 20.2 Integration

- temporary Git repositoryでbase/head、commit、rename、rebase、branch切替
- immutable revisionのoriginal/modified content
- added/deletedのsynthetic empty sideとpresent sideの組合せ
- PATHに存在しないportable Git絶対pathをmetadata・blob双方で利用
- POSIX特殊filename
- 4 MiB直下・直上blob
- 4 MiBを超えるrepository/PR complete diff
- invalid UTF-8 blob、binary判定がdecodeより先行すること、hintなしfallback、unsupported encoding
- Shift-JIS、UTF-8、UTF-8 BOM混在repositoryで各fileを独立に取得・mappingし、1 fileのencoding失敗が他fileの結果を停止しないこと
- Gitなしfolderと複数repository
- nested folder、root file、shared folder、停止済みdescendantを含むtemporary repositoryで、explicit subtree startのscope境界、停止・再開、cancel後stale resultの非公開、multi-root restartを確認すること

### 20.3 VS Code Extension Host

- 通常editor decorationとcommands
- diff editor両side
- dialog、Tree View、Status Bar
- 非同期operation中のactivity statusと完了時の解除
- count-only operation progressがStatus Barへ反映され、`Review Range` Output Channelへ`PROGRESS`として記録されること
- `Review Range` Output Channelへの開始・成功・失敗log
- 行単位レビュー対象外nodeの理由表示とtext diff非実行
- restart後の復元
- actual `vscode.Uri`のparse・serialize・decode
- `TextDocumentContentProvider`のdelegation
- active editorなし・非Git editorでもopened Git workspaceを解決してCurrent ContextとReview Contextsを更新できること
- single/multi-root、Quick Pick取消、stale root、remote/virtual URIのfail-closed、Shift-JIS opened file、mixed encoding、rename、新規file、whitespace/EOL、encoding変更、restartをExtension Hostで確認すること
- Global Understanding folder rowの開始・停止・再開、file openによるdirect scope開始、default privacy境界、partial parent表示、running中stop、restart後のstopped強調とfile open非再開を確認すること

### 20.4 Failure

- Git command/process failure
- GitHub 401/403/404/429、network断、patch欠落
- storage容量不足、JSON/snapshot破損、途中終了
- stale lock、複数window競合
- storage root identity変化または既存symlink/junction/reparseの検出時はfail closedし、current stateを推測・公開しない
- PR Progress取得失敗が無言で非表示にならずOutputへ診断されること
- Current Context/Review Contexts/PR Progressが長時間継続しても上位operation総時間だけではtimeoutせず、count progressを維持すること
- folder scopeのread/enumeration、persisted markerのdecode、child aggregate、configuration refresh、cancelが失敗または競合しても、別scopeへの状態漏出、root-wide fallback scan、stale completionの公開を行わないこと

CI失敗時はtest log、生成物、source、test、設定、環境情報をartifactへ保存する。必須の`pull_request` CIが全gateに成功した場合だけ、同じSHAを名前に含むVSIXと`git archive HEAD`で作成したtracked source ZIPをuser validation artifactとしてuploadする。push runでは重複artifactを作成せず、source ZIPへuntracked file、`node_modules`、credentialを含めない。

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
16. 仮想URIからcontext、file、filesystem semantics、side、revision source、immutable revisionを復元できる
17. Local Git metadataとblobが同じruntime executable・timeoutを使用する
18. 大容量blobや不正encodingを誤表示しない
19. エラー時に不確実な範囲を確認済み表示しない
20. 恒久設計が本ファイル1つに機能別で整理されている
21. 4 MiBを超えるPR・revision差分をchild-process buffer超過なしで取得できる
22. 非同期処理中にactivity statusを表示し、開始・進捗・成功・失敗をOutputへ記録できる
23. fail-closedで結果を非表示・未確認化する場合も原因をOutputから追跡できる
24. Current ContextでPRを選択した場合、Review Contextsのdiff runtime登録後にPR Progressを計算し、初回からcomplete PR Progressを表示できる
25. 同一immutable PR snapshotの重複refreshが互いをcancelせず、再計算中は直前のcomplete Treeを保持できる
26. 長時間のCurrent Context、Review Contexts、PR Progress処理を総経過時間だけでtimeoutせず、repository・PR context・PR fileの匿名件数で進捗を確認できる
27. 同じPR番号・表示labelを持つ別repositoryのReview Contexts行を独立identityとして表示できる

## 22. 将来検討

- 確認範囲へのメモと確認理由
- チーム共有と確認者情報
- 履歴閲覧UI
- GitHub Checks、GitHub App、外部同期
- 関数・クラス単位操作を生成する言語解析補助層
- UTF-16、Shift-JIS等の追加encoding policy
- cloud経由のGlobal状態同期

コアの行単位モデルと確実性優先の原則は維持する。
