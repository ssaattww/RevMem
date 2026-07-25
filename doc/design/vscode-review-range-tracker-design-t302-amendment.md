# VS Code レビュー範囲トラッカー T302設計補遺 rev1

- 文書種別: 基本設計・機能設計補遺
- 対象: `doc/design/vscode-review-range-tracker-design.md` rev1
- 適用範囲: T302 仮想diff URIとrevision content provider
- 作成日: 2026-07-25
- 状態: 再レビュー指摘反映版

## 1. 優先関係

本補遺は、基本設計rev1の次の記述についてT302実装境界を具体化し、矛盾する場合は本補遺を優先する。

- 6.12 diff editor対応の仮想ドキュメントURI
- 12.7 Local Git Adapterの指定revision内容取得
- 16.1 行単位レビュー対象外の判定

T303以降のdiff editor操作、T402以降のGitHub取得fallback、T601以降のsnapshot取得方式は変更しない。

## 2. 仮想ドキュメントidentity

仮想ドキュメントは、次のdescriptorを完全に復元できなければならない。

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

### 2.1 immutable revision

`revisionSource = "git-commit"`の場合、`revision`はlowercaseのfull SHA-1またはfull SHA-256 commit object IDに限定する。

次は受理しない。

- `HEAD`
- branch名
- tag名
- abbreviated object ID
- revision range
- Git optionとして解釈可能な文字列

同じURIが後から別内容を返すことを禁止する。moving refをURIへ保存せず、URI生成前にcommit object IDへ解決する。

T601でsnapshot sourceを追加する場合は、`revisionSource`へ別の明示値を追加し、source固有のimmutable IDを使用する。Git refとsnapshot IDを同じ無種別文字列として扱わない。

## 3. canonical URI

URI形式は次とする。

```text
review-range-diff://document/v1/
  <context-base64url>/
  <path-semantics>/
  <side>/
  <revision-source>/
  <revision-base64url>/
  <file-path-base64url>
```

可変文字列はUTF-8をcanonical base64urlへ変換する。padding、再encode結果が一致しないtoken、不正UTF-8、userinfo、password、port、query、fragment、未知version、未知segmentを拒否する。

上限は次とする。

- URI全長: 65,536文字
- Context ID: UTF-8で8,192 bytes
- file path: UTF-8で32,768 bytes
- Git commit ID: full SHA-1またはfull SHA-256

## 4. repository path contract

`filePath`はrepository rootからのcanonical相対pathとする。

共通で次を拒否する。

- 空文字列
- NUL
- `/`で始まる絶対path
- 空segment
- `.` segment
- `..` segment
- root外へ抜けるpath
- 不正なUTF-16 surrogate

### 4.1 POSIX semantics

`posix`では`/`とNUL以外をファイル名文字として扱う。

したがって、次をURIとGit object lookupで保持する。

- backslash
- tab
- newline
- その他のcontrol character

shell文字列を構築せず、Gitへargument arrayとして渡す。Git pathspecはliteral指定を使用する。

### 4.2 Windows semantics

`windows`ではURI内部のcanonical separatorを`/`とする。次を拒否する。

- backslash
- drive付きpath
- Windows control character
- `< > : " | ? *`
- trailing dotまたはspaceを持つsegment

workspace filesystem semanticsはExtension HostのローカルOSから推測せず、対象workspace側のfilesystemを表す値を渡す。

## 5. Local Git content取得

Local Git取得はmetadataとblob本文を分離する。

### 5.1 commit確認

```bash
git rev-parse --verify --quiet <full-object-id>^{commit}
```

分類:

- exit 0かつ出力object IDが入力と一致: commit利用可能
- exit 1: `missing-revision`
- その他のexitまたはprocess failure: 診断情報を保持したGit failure

exit 128を一律missing扱いにしない。repository破損、権限、dubious ownership、I/O failureを欠落表示へ変換しない。

### 5.2 path確認

```bash
git ls-tree --full-tree -z <commit-id> -- :(literal)<repository-path>
```

分類:

- exit 0かつ出力なし: `missing-file`
- exit 0かつexact pathのblob 1件: blob object IDを使用
- treeまたはsubmodule: `missing-file`
- 複数件、path不一致、壊れた出力: adapter failure
- 非0 exit: 診断情報を保持したGit failure

NUL終端出力を使用し、newline等を含むPOSIX pathを行分割で解析しない。

### 5.3 blob本文

blob本文は`git cat-file blob <blob-id>`をstreamとして読み取る。

- `execFile.maxBuffer`をblob本文へ適用しない
- 4 MiBを超える通常UTF-8 textも取得可能とする
- stdoutをtext encoding付きprocess APIで先にdecodeしない
- complete byte sequenceを取得後、fatal UTF-8 decoderで1回だけdecodeする

Git objectから再取得可能な本文にはT302固有の4 MiB上限を設けない。性能・巨大入力の追加制御はT607で計測根拠とともに定義する。

## 6. text encoding

初期版のline review対象はvalid UTF-8 textに限定する。

invalid UTF-8をreplacement characterへ変換して表示しない。fatal decodeに失敗した場合は`invalid-encoding`として決定的に返し、行単位レビュー対象外として扱う。

`invalid-encoding`は次と区別する。

- contextがない
- commit objectがない
- fileがない
- Git command自体が失敗した

UTF-16、Shift-JIS等の追加encoding対応は別タスクで明示的なdecode policyを設計する。

## 7. VS Code境界

T302のUI adapterは、実際の`vscode.Uri`について次を満たす。

1. codecが生成したURIを`vscode.Uri.parse`できる
2. `uri.toString(true)`がcanonical URIと一致する
3. その文字列をdecodeするとdescriptorが完全一致する
4. `TextDocumentContentProvider` adapterが同じURIをapplication providerへ渡す

provider登録と`vscode.diff`実行はT303の責務とする。

## 8. error policy

既知の復元不能状態だけをstable codeへ変換する。

| code | 条件 |
| --- | --- |
| `missing-context` | contextからrepository rootを解決できない |
| `missing-revision` | full commit IDが存在しない、またはcommit objectでない |
| `missing-file` | commitは存在するがexact pathのblobがない |
| `invalid-encoding` | blob bytesがvalid UTF-8でない |

Git processの権限、repository破損、safe.directory、timeout、I/O等は上記codeへ畳み込まず、invocation、exit code、stdout、stderrを保持するfailureとして伝播する。

## 9. 検証

T302終了条件へ次を追加する。

- fatal exit 128をmissingへ誤分類しない
- moving refをencode・content lookup双方で拒否する
- POSIXのbackslash、tab、newline入りtracked fileをURIから取得できる
- Windowsでinvalidなpathを拒否する
- 4 MiB直下・直上のUTF-8 blobを取得できる
- invalid UTF-8 blobを`invalid-encoding`へ分類する
- actual `vscode.Uri`でround-tripする
- base64url canonical性、不正UTF-8、userinfo、port、field上限、URI上限を試験する
- application、adapter、UIの公開barrelをconsumer type fixtureでcompileする
- CIで`typecheck:contracts`を実行する
