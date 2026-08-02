# T503 Review Follow-up R2

## 対象

- Issue: #1
- Task: T503 repository file列挙、gitignore、空行判定
- Pull Request: #34
- Review report: `reports/issue-1-t503-fix-verification-20260802062100.md`
- Reviewed HEAD: `3cd46ebd356f4c3709083915d26747e6b5200883`

## 指摘

### T503-IR-001 high follow-up

除外directoryを`ExcludedRepositoryFile`として返していたため、file結果へdirectory aggregateが混在していた。

### T503-FV-001 high

`ignored/`と`!ignored/keep.ts`が併存する場合、Gitでは除外済みparent directoryを再包含しないが、実装はnegationの存在だけでdirectoryへ再帰し、childをincludedへ戻していた。

## TDD

### Red

Commit: `110421bc49e7cd77902399bddb848561e1134b79`

次を回帰testへ追加した。

- file除外とdirectory除外を別collectionとして返す
- `excluded`にはdirectory pathを混在させない
- `ignored/`配下の`!ignored/keep.ts`をincludedへ戻さない

### Green

Commit: `cb7f184bae315e0c5fae4f010da8a46e526e5fe0`

- `excludedDirectories`を追加し、pruneしたdirectoryのpathと理由を明示的に保持
- `excluded`はfileとsymbolic linkだけを保持
- parent directoryがgitignoreで除外された時点でnegationの有無にかかわらず再帰を停止
- policy除外directoryも同じdirectory結果へ保持

## 検証

Implementation HEAD: `cb7f184bae315e0c5fae4f010da8a46e526e5fe0`
Matching workflow run: `30719214308`

- build: pass
- contract typecheck: pass
- architecture validation: pass
- architecture negative contract: pass
- lint: pass
- unit tests: pass
- T503 focused tests: pass
- temporary Git integration: pass
- mock GitHub integration: pass
- VS Code Extension Host: pass

## 結果

- T503-IR-001: addressed
- T503-FV-001: addressed
- merge: 未実施
