# T103 実装レポート

## タスク

- 対象: T103 workspace context・file ID・非Git repository ID
- 関連設計: `doc/design/vscode-review-range-tracker-design.md` 6.9、7.2、8.4
- Pull Request: #5
- ブランチ: `task/t103-workspace-identity`
- base: T102 merge後の`main`へT103固有コミットだけをrebase済み

## 事前確認

- `.github/workflows/ci.yml`は失敗時に`test-output`、`dist`、`test-dist`、`src`、`test`、設定ファイルを診断artifactへ収集する
- T103着手時点で追加のworkflow変更は不要と判断した

## Test-Driven Development

### 初回Red

- `test/unit/workspace-identity.test.ts`を実装より先に追加した
- `package.json`の`test:unit`へT103テストを接続した
- GitHub Actions run `29979840566`で`Unit tests`が失敗することを確認した
- 失敗理由は未実装の`application/workspace-identity`と`adapters/crypto`を解決できない`TS2307`だった
- 失敗時診断artifact `ci-failure-diagnostics-29979840566-1`が生成された
- artifact IDは`8552775713`で、unit log、環境情報、生成物一覧、ソース、テスト、設定ファイルを含む

### Green移行中の修正

- 初回実装後のActions run `29979992332`は`Build`で失敗した
- 原因は本体用`tsconfig.json`にNode型がなく、`node:crypto`へ`TS2591`が発生したことだった
- 診断artifact `ci-failure-diagnostics-29979992332-1`、artifact ID `8552827963`で`build.log`を確認した
- `tsconfig.json`へ`types: ["node"]`を追加し、Actions run `29980049390`で全工程成功を確認した

### 専用レビュー後のRed/Green

#### URI構成要素の境界衝突

- path内の`?`とquery区切りをそのまま連結すると、異なるURI構成が同じcanonical文字列になり得ることをレビューで検出した
- 再現テストを先に追加し、Actions run `29980208887`で`Unit tests`が失敗することを確認した
- 失敗時診断artifact `ci-failure-diagnostics-29980208887-1`、artifact ID `8552903274`が生成された
- path segment、query、fragmentを個別にpercent-encodeし、Windows drive segmentのcolonだけを保持した
- Actions run `29980296718`で全工程成功を確認した

#### POSIXのコロン付きファイル名

- URIらしい文字列を一律拒否する判定が、POSIXで有効なルート直下の`schema:v1.json`を拒否することをレビューで検出した
- 再現テストを先に追加し、Actions run `29980420185`で`Unit tests`が失敗することを確認した
- Windows drive形式と絶対pathだけを拒否し、通常のPOSIX相対path内のcolonを許可した
- 最終Actions run `29980479705`で全工程成功を確認した

## 実装内容

### Workspace Identity Service

- VS Code APIへ直接依存しない`ResourceUri` contractをapplication層へ定義した
- workspace folder URI、document URI、workspace-folder-relative pathを正規化して相互整合性を検証する
- documentがworkspace folder外、schemeまたはauthority不一致、relative path不一致の場合はIDを生成しない
- 入力objectを変更せず、新しいidentity objectを返す

### URI・path正規化

- schemeとauthorityを小文字化する
- slashを`/`へ統一し、`.`と`..`を解決する
- Windows file URIはdrive、path、relative pathを小文字化してcase variationを同一視する
- POSIX pathは大文字小文字を保持する
- remote URIはscheme、authority、絶対pathをidentityへ含める
- path segment、query、fragmentを別々に符号化し、区切り文字によるcanonical URI衝突を防ぐ
- Windows drive segmentのcolonはcanonical URIで保持する

### Stable ID

- Node adapterのSHA-256を`StableHash` contract越しに利用する
- ID生成時はNUL区切りとdomain prefixで用途を分離する
- 非Git repository ID: `non-git-repository:<sha256>`
- workspace ID: `workspace:<sha256>`
- workspace context ID: `workspace-context:<sha256>`
- file ID: `workspace-file:<sha256>`
- hash adapterが小文字64桁のSHA-256 hexadecimalを返さない場合は失敗させる

### Layer境界

- URI・path正規化とID組み立てはapplication層に配置した
- `node:crypto`への依存はadapters層だけに配置した
- core層へVS Code、GitHub、Node filesystemまたはNode crypto依存を追加していない

## 単体テスト

- 同一POSIX workspace/fileを別service instanceで解決した場合のID安定性
- Windows drive、path casing、slash variationの同一視
- POSIX pathのcase sensitivity
- remote scheme・authorityの正規化と別remoteの分離
- 同一relative pathでもworkspace rootが異なる場合の全ID分離
- documentのworkspace外、relative path不一致、scheme・authority不一致の拒否
- absolute path、root escape、空pathの拒否
- URI path/query delimiterのidentity衝突防止
- POSIXのコロン付きファイル名
- frozen URI inputの非破壊性

## 対象ファイル

- `package.json`
- `tsconfig.json`
- `src/application/workspace-identity/index.ts`
- `src/application/workspace-identity/workspace-identity-service.ts`
- `src/adapters/crypto/index.ts`
- `src/adapters/crypto/node-sha256-stable-hash.ts`
- `test/unit/workspace-identity.test.ts`

## 終了条件との対応

- 同じworkspace/fileは再起動後も同じID: stateless serviceと固定SHA-256入力を別instance fixtureで確認
- 別rootは別ID: repository、workspace、context、fileの各ID差異を確認
- Windows fixture: drive、case、separator variationを確認
- POSIX fixture: case sensitivity、colonを含む有効pathを確認
- remote URI fixture: scheme・authority正規化と別remote分離を確認

## 後続タスク

- T104でGit・PR用`globalStorageUri`とGitなし用`storageUri`を選択する共通状態repositoryへidentityを接続する
- T105でVS Code workspace folderとdocument URIから本serviceへの入力を生成する
- T601以降でGitなしスナップショット追従とRemote SSH、Dev Containers、Codespaces相当の統合試験を拡充する
