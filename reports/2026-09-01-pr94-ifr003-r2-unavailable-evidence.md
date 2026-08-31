# Sub-agent実行レポート

## タスク

PR94-IFR-003 R2 present snapshot evidence取得不能のfail-closed修正。

## sub-agentを使う理由

Terra/high implementation workerによる0.5h限定TDD修正。

## 対象範囲

snapshot missとpresent-but-unreadableの識別、local Git transition reject、no publish。

## 対象外

IFR-001/002/004、Issue #106、workflow/performance、merge。

## 実行コマンド

TDD sourceは親指示のtest-firstである。

- `npm run compile:test && node --test test-dist/test/unit/document-git-context-lifecycle.test.js`: Red。compile pass、18件中17 pass / 1 fail。present target snapshotに対する`invalid-encoding` evidence readが通常mappingへfallbackし、期待したrejectが発生しなかった。
- `npm run compile:test && node --test test-dist/test/unit/document-git-context-lifecycle.test.js test-dist/test/unit/immutable-revision-review-snapshot.test.js test-dist/test/unit/git-context-revision-mapper-binary.test.js`: Green。compile pass、33/33 pass。
- `npm run build`: pass。
- `npm run lint`: pass。
- `git diff --check`: pass（一回）。

## 対象ファイル

変更: `src/application/review-context/git-context-revision-mapper.ts`、`test/unit/document-git-context-lifecycle.test.ts`、このreport。

IFR-001/002/004、design/tracking/workflow/performance、commit/push/CI/review/mergeは未変更。

## 指摘事項

統合design `doc/design/vscode-review-range-tracker-design.md:1169`はtarget snapshotが存在しない場合だけdiff mappingを許し、`:1171`はsnapshot evidence不一致をrejectすると定めている。unreadable present snapshotはこのfail-closed契約に含まれるため、design wordingの更新は不要である。

現行mapperの`targetSnapshotEvidence`は、snapshotが存在する場合でもtarget content readが`found`以外なら`undefined`を返していた。この`undefined`はsnapshot absentと同じ扱いになり、normal mappingへsilent fallbackした。

private discriminated `TargetSnapshotEvidenceResult`を追加し、`absent`、`available`、`unavailable`を区別した。present snapshotでnon-`found` readになればgenericな`Immutable target snapshot evidence is unavailable.`をthrowし、`mapContextFiles`/`mapGlobalFiles`、CAS、historyへ到達しない。Git sourceのthrowはcatchしないため従来どおりfatalである。content、path、tokenはerrorやlogへ追加しない。

## 結果

Green。actual local Git provider fixtureはtarget snapshot keyを保存し、authoritative target readを`invalid-encoding`でunavailable化してtransition reject、repository state/historyを不変、commit countを不変と確認する。snapshot absentを通常mappingする既存immutable snapshot miss regression、binary/missing-object境界もGreenのまま残る。

production APIはprivate helper resultのみで、公開contract変更はない。

## リスク

source portが将来新しいnon-`found` result variantを追加した場合も、present snapshotでは同じunavailable/fail-closed分岐になる。full/default suite、CI、performanceは未実行。
