# T202 実装レポート

## タスク

- 対象: T202 Local Git Adapter
- 関連設計: `doc/design/vscode-review-range-tracker-design.md` 5.2、7.1.2、7.1.3、7.2、9.3、9.5
- Pull Request: #8
- ブランチ: `task/t202-local-git-adapter`
- base: T103 merge後の`main`へT202差分を再適用済み

## 実装方針

T202はGitHub API、GitHub認証、ネットワーク接続へ依存させず、ワークスペース側Extension Hostに存在するローカルGit CLIだけを対象とした。

クラウド作業環境ではローカル利用者のGit環境を直接利用できないため、次の構成で検証した。

1. `GitCommandExecutor`を実行境界として分離する
2. fake executorでコマンド、引数、cwd、exit codeを単体テストする
3. GitHub Actions上でtemporary Git repositoryを作成し、実Gitで統合テストする
4. Git未導入は存在しない実行ファイルを指定して検証する
5. GitHub接続可否はT202の結果へ影響させない

Node.js公式の`child_process.execFile`はshellを既定で起動せず、実行ファイルと引数配列を別々に受け取る。実装は`execFile`へ`shell: false`を明示し、shell command文字列を生成しない。

## Test-Driven Development

### 初回Red

- `test/unit/local-git-adapter.test.ts`と`test/integration/local-git-adapter.integration.test.ts`を実装より先に追加した
- `package.json`へT202専用の`npm run test:t202`を追加した
- Actions run `29981544211`の`Unit tests`が未実装moduleにより失敗した
- 診断artifact `ci-failure-diagnostics-29981544211-1`、artifact ID `8553361177`が生成された
- artifactにはtest log、環境情報、生成物一覧、`src`、`test`、設定ファイルが含まれた

### Green移行中のbuild修正

- Local Git Adapter実装後のActions run `29981732303`は`Build`で失敗した
- 原因は本体用`tsconfig.json`にNode型が登録されておらず、`node:child_process`、`node:crypto`、`node:path`、`node:url`を解決できないことだった
- 診断artifact `ci-failure-diagnostics-29981732303-1`、artifact ID `8553429757`の`build.log`で確認した
- `tsconfig.json`へ`types: ["node"]`を追加した
- Actions run `29981822356`で全工程成功を確認した
- T103が同じNode型設定をmainへ導入したため、最新mainへの再適用後はT202固有差分から`tsconfig.json`変更が消えた

### レビューfollow-up 1: 既定port

- `ssh://...:22`とscp形式が同じGitHub repositoryを表すにもかかわらず、別Repository IDになる問題を検出した
- `test/unit/git-remote-normalization.test.ts`を先に追加した
- Actions run `29982020729`で43 unit tests中1件が失敗した
- actualは`github.com:22/Owner/Repository`、expectedは`github.com/owner/repository`だった
- 診断artifact `ci-failure-diagnostics-29982020729-1`、artifact ID `8553541805`が生成された
- `ssh:22`、`git:9418`、`http:80`、`https:443`を省略し、Actions run `29982061714`で全工程成功を確認した

### レビューfollow-up 2: UNC authority

- `file://BuildServer/Share/Repository.git`からserver authorityが消え、異なるUNC repositoryが衝突し得る問題を検出した
- 回帰テストを先に追加し、Actions run `29982197919`で失敗を確認した
- actualは`file:///Share/Repository`、expectedは`file://buildserver/Share/Repository`だった
- 診断artifact `ci-failure-diagnostics-29982197919-1`、artifact ID `8553608833`が生成された
- file URLのauthorityを小文字化して保持し、Actions run `29982237007`で全工程成功を確認した

## 実装内容

### Git process境界

- `GitCommandInvocation`は`argumentsList`と`cwd`を別々に保持する
- `NodeGitCommandExecutor`は`execFile`を使用し、`shell: false`で実行する
- stdout、stderr、exit codeを保持する
- Git実行ファイルの`ENOENT`を`GitExecutableNotFoundError`へ分類する
- timeoutは30秒、stdout/stderr上限は4 MiBを既定とする
- 実行ファイル、timeout、buffer上限をconstructorから差し替え可能にする

### Repository inspection

- `git --version`でGit可否とversionを取得する
- `git rev-parse --show-toplevel`でrepository rootを取得する
- 非Git folderは`not-repository`として返す
- `origin`を優先し、存在しない場合はremote名の昇順先頭を使用する
- `git remote get-url`でidentity remoteを取得する
- `git symbolic-ref --quiet HEAD`で完全branch refを取得する
- symbolic ref exit 1をdetached HEADとして扱う
- `git rev-parse --verify HEAD^{commit}`でHEAD objectを取得する
- unborn branchではHEADを省略可能にする

### Remote正規化とRepository ID

- SCP形式、SSH URL、HTTP(S)、Git protocolを`host/path`へ正規化する
- user/password、query、fragment、末尾`.git`、余分なslashを除去する
- hostを小文字化する
- GitHubのowner/repository pathを小文字化する
- protocol既定portを省略する
- relative local remoteをrepository rootから絶対file URLへ解決する
- UNC file URLのserver authorityを保持する
- remoteがある場合は正規化remoteをRepository IDとする
- remoteがない場合はcanonical root file URIをdomain-separated SHA-256化し、`git-root:<digest>`とする
- forkは`origin` remoteが異なるため別Repository IDになる

### Revision query

- `git merge-base <left> <right>`でmerge-baseを取得する
- merge-baseなしのexit 1は`undefined`とする
- `git cat-file -e <object>^{object}`でobject有無を取得する
- revisionが`-`で始まる場合、改行またはNULを含む場合はGit実行前に拒否する

## テスト

### 単体テスト

- 全Git invocationの引数配列、cwd、順序
- Git version、root、origin remote、完全branch ref、HEAD
- SCP、SSH、HTTPS、credential付きURLの正規化
- GitHub既定portの同一視
- relative local remoteとfile URL
- UNC authority保持
- remoteなしroot hash IDの再起動安定性と別root分離
- fork remoteのRepository ID分離
- detached HEAD
- Git未導入と非Git folderの区別
- merge-baseとobject有無
- optionとして解釈され得るrevisionの拒否

### 実Git統合テスト

- nested pathからtop-level rootを取得する
- remoteなしrepository
- originとupstreamがある場合のorigin優先
- originをfork URLへ変更した場合のRepository ID分離
- detached checkout
- merge-base
- object存在・不存在
- 存在しないGit executable

## CI接続

T103が`test:unit`を同じ行で拡張したため、最新mainへの再適用時にT202のunit/integration testはT103が変更していない`test:git`へ接続した。merge後は次の両方が実行される。

- `test:unit`: T103までのcore・workspace identityテスト
- `test:git`: temporary Git fixtureとT202のunit・integrationテスト

T202だけは`npm run test:t202`でも独立実行できる。

## 最終検証

Actions run `29982435495`で次が成功した。

- install dependencies
- build
- lint
- unit tests
- temporary Git integration tests
- mock GitHub integration tests
- VS Code Extension Host tests

最新mainへの再適用後も同じCI一式を再実行する。

失敗時診断workflowは既存実装で要件を満たしていたため、T202ではworkflowを変更していない。

## 変更ファイル

- `package.json`
- `src/adapters/local-git/contracts.ts`
- `src/adapters/local-git/git-remote-normalization.ts`
- `src/adapters/local-git/node-git-command-executor.ts`
- `src/adapters/local-git/local-git-adapter.ts`
- `src/adapters/local-git/index.ts`
- `test/unit/local-git-adapter.test.ts`
- `test/unit/git-remote-normalization.test.ts`
- `test/integration/local-git-adapter.integration.test.ts`

## 並行開発との分離

- T202はT003だけに依存する
- T103 merge後のmainへT202差分だけを再適用した
- T104、T201のsourceへ依存しない
- `src/adapters/index.ts`を変更せず、並行中のT104との不要な競合を避けた
- T202固有テストは`npm run test:t202`で独立実行できる
- T203はT201とT202の両方が完了した後に接続できる
