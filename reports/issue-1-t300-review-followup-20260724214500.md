# T300 Review Follow-up レポート

## 対象

- Pull Request: #17
- R2 review: `reports/issue-1-t300-review-r2-20260724212500.md`
- Latest main at restack: `938904da6e63c7111dc8add56cb3a53acd9e9904`

## TDD

### Git path・glob上限 Red

- Test head: `531fc57f339f7d5710767a2f523b50cd558de6c7`
- Run: `30093514144`
- Failure: Unit tests
- Artifact: `ci-failure-diagnostics-30093514144-1`
- Artifact ID: `8596617674`

先に次を追加し、旧実装で失敗を確認した。

- `a\\b.ts`と`a/b.ts`を区別
- `src\\dist\\file.ts`が`**/dist/**`へ一致しない
- user pattern数257件を拒否
- pattern長1025を拒否
- brace展開1024超を拒否

### Runtime設定接続 Red

- Test head: `ddddb83ce5dbca1bada74fe8b604859a4f6d10c1`
- Run: `30093714252`
- Failure: Unit tests
- Artifact: `ci-failure-diagnostics-30093714252-1`
- Artifact ID: `8596697266`

未実装controllerを参照するテストを先に追加した。

- activation相当の初期設定読込
- `reviewRange.exclude`変更だけを処理
- semantic no-opで通知しない
- 無関係設定変更を無視
- invalid設定時にlast valid policyを保持
- deactivation相当のdispose

## 対応内容

### High-1 runtime設定接続

`ReviewFileExclusionConfigurationController`をadapter層へ追加した。

- effectiveな`reviewRange.exclude`をactivation時に読込
- `workspace.onDidChangeConfiguration`を購読
- relevant changeだけserviceへ反映
- application serviceがsemantic no-opを抑止
- invalid設定はerror表示し、last valid policyを維持
- ExtensionContext subscriptionと`deactivate()`の双方から安全にdispose

Extension Host test APIへpolicy revision、normalized user globs、decision評価を公開し、実VS Code workspace setting変更を確認した。

### High-2 Git path semantics

policy candidate pathをGit形式repository-relative pathへ限定した。

- slashだけをseparatorとして扱う
- backslashはファイル名dataとして保持
- redundant slashと先頭`./`だけを正規化
- Windows filesystem pathからGit pathへの変換は呼出adapterの責務

### Medium-1 compile上限

- user glob件数: 最大256
- 1 pattern長: 最大1024 UTF-16 code unit
- user glob全体のbrace展開・RegExp数: 最大1024
- brace nesting: 最大32

上限超過は`RangeError`として設定errorへ伝播する。

### High-3 最新main統合

T104-2統合済みmain `938904da6e63c7111dc8add56cb3a53acd9e9904`からbranchを積み直した。T104-2のrepository修正、reports、tasks、test wiringを維持し、behind 0を確認した。

## CI

コード・unit・Extension Host差分整理後のhead:

- `04c02622e320f57301a84b430e09b6a6d5f71b1b`
- Run: `30094763392`
- Result: success
- 成功工程:
  - install dependencies
  - build
  - lint
  - unit tests
  - temporary Git integration tests
  - mock GitHub integration tests
  - VS Code Extension Host tests

最終reports・progress同期後のheadについてはR3 review reportで別途head SHAに紐づくrunを確認する。

## 追加修正

途中head `2d27e63c657ac48156d11801da62147dc29e82e9`のrun `30094133158`は`package.json`のJSON構文誤りで`npm ci`失敗となった。artifact ID `8596862303`の`npm-ci.log`から余分な閉じ括弧を特定し修正した。製品ロジックの失敗ではないが、診断経路が機能した証跡として保持する。
