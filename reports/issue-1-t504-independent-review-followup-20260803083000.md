# T504 Independent Review Follow-up Report

## 1. メタデータ

- Repository: `ssaattww/RevMem`
- Issue: `#1`
- Task: `T504`
- Pull Request: `#39`
- Work mode: independent review follow-up implementation
- Source review: `reports/issue-1-t504-independent-final-review-20260803062200.md`
- Failed reviewed implementation HEAD: `3de50b0f768da1d24fb2e87d07e58420482967e0`
- Current branch: `task/t504-global-understanding-progress`
- Current HEAD before uncommitted follow-up: `3de50b0f768da1d24fb2e87d07e58420482967e0`
- Base: `origin/main` `76b49e99453ebcf7ebecb2c141ed24d750736abc`
- Commit, push, PR mutation, and merge: 未実施

本レポートは`T504-IFR-001`、`T504-IFR-002`、`T504-IFR-003`だけの実装・検証証跡である。findingのclosureまたはreview verdictは記録しない。

## 2. 作業コンテキスト

- 開発方針: `tasks/phases-status.md`のtest-first規則によりTDDを適用した。
- 設計判断: malformed UTF-8は既存設計11.3、12節で既にGlobal集計対象外である。列挙resultの`invalid-encoding`理由を追加して実装と設計を同期した。既存の対象外契約を実装する追加であり、破壊的変更ではないため`Design/BreakingChanges.md`は変更していない。
- 追跡判断: T504は修正・検証後もnormal review、commit、exact-head CI、独立reviewの再実施前であるため、完了に更新していない。
- 対象外: T505/T506 UI・activation、T607のwhole-buffer memoryと定量scale、Issue #28とIssue #36のheld項目。

## 3. TDD Red

`npm run compile:test`後、次のfocused commandを実行した。

```powershell
node --test test-dist/test/unit/repository-file-enumerator.test.js test-dist/test/unit/t504-review-followup.test.js test-dist/test/unit/t504-review-followup-r2.test.js
```

実装前の結果は17件中13成功、4失敗だった。

- `T504-IFR-001` interval mutation: cache evidenceが旧interval、progressが新intervalとなり、2行を返した。
- `T504-IFR-001` revision/included mutation: source yield後にmutable inputを再読込してrevision mismatchでrejectした。
- `T504-IFR-002` T503 boundary: malformed non-NUL UTF-8が`included`へ入った。
- `T504-IFR-002` T504 boundary: replacement decodeのためsourceがrejectしなかった。

## 4. 実装

### T504-IFR-001 — high

- `GlobalUnderstandingBackgroundRecalculator`は、最初のawait前にrepository ID、revision、Global file identity/hash/interval、included path/count、open-file priorityを検証済みのfrozen snapshotへコピーする。
- source load、evidence key、cache get/set、progress calculationは同じsnapshotだけを使用する。
- interval mutationのcache miss/hit回帰と、revision/included-count mutation sibling回帰を追加した。

### T504-IFR-002 — medium

- T503 enumerationはnon-NUL contentをfatal UTF-8 decodeし、失敗を`{ kind: "invalid-encoding", encoding: "utf-8" }`として`excluded`へ安定分類する。
- T504 Node sourceもfatal UTF-8 decoderを使用し、invalid contentを`Included repository file content is not valid UTF-8.`でrejectする。したがってrecalculationはsnapshotやcacheを公開しない。
- T503 included boundaryとT504 source/recalculation boundaryにmalformed non-NUL UTF-8 fixtureを追加した。

### T504-IFR-003 — medium

- `tasks/tasks-status.md`をPR #39/T504 independent review follow-upへ同期し、T504を未完了の進行中として記録した。
- `tasks/phases-status.md`のP5状態とGlobal checkpointを同期した。
- T504 implementation、normal review、R2 evidence、independent final review、本follow-up reportの参照をtasks trackingへ追加した。

## 5. Green 検証

| Command | Result |
| --- | --- |
| `npm run compile` | success |
| `npm run lint` | success |
| `npm run typecheck:contracts` | success |
| `npm run validate:architecture` | success |
| `npm run validate:architecture:negative` | expected 11 findings matched |
| T503 focused suite | 8 passed / 0 failed |
| T504 focused suite with cache regressions | 15 passed / 0 failed |
| `npm run test:git` | 33 passed / 0 failed / 3 platform skips |
| `npm run test:github` | 13 passed / 0 failed |
| `npm run test:vscode` | exit code 0 |
| `git diff --check` | success |

`npm test`はunit段階で19失敗となり、後続のGit/GitHub/VS Code suiteはそのcommand内では未実行だった。失敗はいずれもWindows上のGit owner fixtureが`document path is outside the resolved Git working tree`となる既存のIssue #28 held領域であり、T504 focused、Git、GitHub、Extension Hostの個別実行は上記のとおり成功した。

current HEADは未コミットのため、follow-up後のexact-head CIは存在しない。既存の`3de50b0f768da1d24fb2e87d07e58420482967e0`に対するCIを新しい作業treeの証跡として再利用していない。

## 6. Markdown確認

変更Markdownは設計書、task tracking、phase tracking、本レポートである。repositoryに`tools/lint/`、`lint:md`、Markdown target、whitelist、`prh`のwiringがないため、focused/full Markdown wording lintは`unsupported`である。バッククォートは識別子、path、command、field valueだけに使用した。

## 7. 残存事項

- `T504-IFR-001`〜`003`のclosure判断はnormal reviewerのfix verificationに委ねる。
- normal review前にこの非final change setをcommitし、push後の新しいHEAD一致CIを取得する必要がある。
- fresh independent final reviewは、tracking、report、validationを含む新しいfrozen implementation HEADだけを対象にする。
- Issue #28、Issue #36、T607 heldは本follow-upの対象外として維持する。

## 8. main integration evidence

- `origin/main` `0fdf87784355dce94fd4f1515a9e62d5257ecb75`（T304 PR #38）をPR #39 branchへmergeした。
- `tasks/phases-status.md`のconflictは、T304/P3のcurrent main統合済み実績と、T502のnormal fix verification待ち、T504の修正・検証済みかつclosure待ちを同時に保持して解消した。
- auto-merged `tasks/tasks-status.md`を確認し、T502、T304、T504の行とcurrent positionがいずれも残っていることを確認した。T304はcurrent main統合済み、T502はnormal fix verification待ち、T504はnormal fix verification待ちとして実態へ同期した。
- merge index上の検証は`npm run compile`、`npm run lint`、T503 focused 8 / 8、T504 focused 15 / 15、working treeとstaged indexの`git diff --check`がすべて成功した。
- merge commit、push、PR mutation、mergeはこの作業では実施していない。
