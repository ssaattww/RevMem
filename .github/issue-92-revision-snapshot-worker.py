from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "doc/design/vscode-review-range-tracker-design.md"
PROJECTION = ROOT / "doc/design/diff-editor-selection-projection.md"
BREAKING = ROOT / "Design/BreakingChanges.md"
MARKER = "<!-- issue-92-immutable-revision-snapshots -->"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one occurrence, found {count}")
    return text.replace(old, new, 1)


def update_main_design() -> None:
    text = MAIN.read_text(encoding="utf-8")
    if MARKER in text:
        return

    text = replace_once(
        text,
        "# VS Code レビュー範囲トラッカー 設計書 rev8",
        "# VS Code レビュー範囲トラッカー 設計書 rev9",
        "design revision",
    )

    global_anchor = """### 4.4 Global確認済み

特定コンテキストに閉じず、リポジトリ全体で現在も有効と判断できる確認済み状態。内容変更時は変更部分だけ無効化する。
"""
    global_replacement = global_anchor + """
### 4.5 Immutable revision snapshot

""" + MARKER + """

確認済み状態は現在revisionだけでなく、過去に確定したimmutable Git revisionごとのsnapshotとして保持する。snapshot keyはlowercase full SHA-1またはfull SHA-256 commit object IDとし、branch、tag、`HEAD`、短縮SHA、revision rangeを使用しない。

Context snapshotはそのrevisionのfile identity、path、line count、content hash、`modifiedReviewed`および既知の`originalReviewedByDiff`を保持する。Global snapshotは同じrevisionのowner-wide `reviewed`を保持する。snapshot自身へsnapshot mapを再帰的に格納しない。

現在revisionで確認または解除が成功した場合、現在のContext/Global stateと対応するrevision snapshotを同じatomic transactionで更新する。失敗、cancel、no-op、stale operationではsnapshotを変更しない。
"""
    text = replace_once(text, global_anchor, global_replacement, "global snapshot section")

    revision_anchor = """### 10.2 Git revision間

```bash
git diff --unified=0 --find-renames R_old R_new -- <path>
```

branch比較ではmerge-baseを使用する。hunk前後の未変更部分を維持し、変更部分だけ未確認へ戻す。
"""
    revision_replacement = """### 10.2 Git revision間

```bash
git diff --unified=0 --find-renames R_old R_new -- <path>
```

branch比較ではmerge-baseを使用する。

遷移先について検証済みのexact revision snapshotが存在する場合は、そのsnapshotを復元し、現在revisionから遷移先への逆向きdiff mappingを行わない。snapshotが存在しない場合だけ、現在の確定状態をsourceとしてhunk前後の未変更部分を維持し、変更部分と追加部分を未確認へ戻す。mapping後の状態は遷移先revision snapshotとして保存する。

Context snapshotとGlobal snapshotはlayerごとにhit/missを判定できる。片方だけsnapshotが存在する場合、存在するlayerはexact snapshotを復元し、存在しないlayerだけをmappingする。両layerの最終結果は同じContext/Global CAS transactionで公開し、片側だけ先に保存しない。

### 10.2.1 Exact revision復元

revision遷移前に、現在stateをsource revision snapshotへ同期する。遷移先snapshotのmap key、payload revision、file identity、canonical path、line count、content hashおよびinterval boundsをtarget immutable content evidenceと照合する。検証できないsnapshotを部分的に採用しない。

例えばAを全行確認済みにした後、AからB、BからCへ進み、Cも全行確認済みにした状態でexact Aへ戻る場合、保存済みA snapshotが有効ならAを全行確認済みとして復元する。CからAへのdiffを新規変更として扱ってAとCの相違行を未確認へ戻してはならない。

```text
A: 全行確認済み
A -> B: Bで変化した行だけ未確認
B: 全行確認済みに更新
B -> C: Cで変化した行だけ未確認
C: 全行確認済みに更新
C -> A: exact A snapshotを復元し、Aは全行確認済み
```

復元後にAで確認または解除を行った場合はA snapshotだけを更新し、B/C snapshotを変更しない。その後exact Cへ戻る場合はCで最後に確定したsnapshotを復元する。

### 10.2.2 PRのHEADと比較pair

GitHub PR contextはrepositoryとPR番号で継続する。modified/current側のsnapshotはHEAD SHAで識別し、original側だけに存在する削除行または置換前行は`${baseSha}..${headSha}`で識別する。

同じHEADでBASEだけが変わった場合、modified側snapshotは共有し、`A..C`と`B..C`のoriginal側範囲は別entryとして保持する。過去pair entryを消去せず、現在PR進捗とdecorationは現在のexact pairだけを参照する。Snapshot保持は古いdiff tabからの操作権限を与えず、current context、file、BASE、HEAD、side revisionおよびoriginal diff IDが一致しない操作を拒否する。
"""
    text = replace_once(text, revision_anchor, revision_replacement, "revision mapping section")

    migration_anchor = """### 15.3 Schema migration

全保存modelに`schemaVersion`を持たせる。起動時に段階移行し、移行前backupを作成する。破損dataは隔離し、不確実な範囲を確認済みにしない。
"""
    migration_replacement = """### 15.3 Schema migration

全保存modelに`schemaVersion`を持たせる。起動時に段階移行し、移行前backupを作成する。破損dataは隔離し、不確実な範囲を確認済みにしない。

`revisionSnapshots`を持たない既存stateは、現在descriptorのrevisionについてだけ現在の`files`からsnapshotを作成する。upgrade前に訪れた過去revisionの確認状態をhistoryから推測復元しない。過去revisionへ初めて戻る場合はsnapshot missとして通常mappingし、その結果を新しいsnapshotとして保存する。

既存readerがoptional fieldを受理できない場合はschema versionを進め、現在revision snapshotを作る明示migrationを追加する。未知future schemaは従来どおり拒否する。

Revision snapshotは初期実装では自動削除しない。将来bounded retentionを導入してsnapshotが欠落した場合はsnapshot missとして通常mappingへfallbackし、別revisionのsnapshotを代用しない。
"""
    text = replace_once(text, migration_anchor, migration_replacement, "schema migration section")

    test_anchor = """- pollがGit snapshotをmapping中にforeground `open`がより新しいsnapshotを観測した場合、古いpoll completionを破棄し、保存済みrevisionを巻き戻さないこと
"""
    test_replacement = test_anchor + """- Aを全確認後にAからB、BからCへ初回遷移すると各targetの変更行だけ未確認になり、Cを全確認後にexact Aへ戻るとreverse mappingせずA snapshotを復元すること
- Context/Global snapshotの片側hit・片側missを同じatomic transactionで処理し、別revision snapshotを変更しないこと
- 同一HEAD・異なるBASEでmodified snapshotを共有し、original側rangeをpairごとに分離して現在pairだけをPR進捗へ使用すること
- legacy stateは現在revision snapshotだけを作り、過去revisionをhistoryから推測しないこと
"""
    text = replace_once(text, test_anchor, test_replacement, "unit test contract")

    acceptance_anchor = """27. 同じPR番号・表示labelを持つ別repositoryのReview Contexts行を独立identityとして表示できる
"""
    acceptance_replacement = acceptance_anchor + """28. 過去に確定したexact immutable revisionへ戻った場合、そのrevision snapshotを復元し、現在revisionとの差分を新規未確認として誤表示しない
29. Snapshotがないrevisionへの初回遷移では、既知revisionから変更部分だけを未確認化して新snapshotを作成できる
"""
    text = replace_once(text, acceptance_anchor, acceptance_replacement, "acceptance criteria")

    MAIN.write_text(text, encoding="utf-8")


def update_projection_design() -> None:
    text = PROJECTION.read_text(encoding="utf-8")
    old = """PR context自体はrepositoryとPR番号で継続する。modified側の確認範囲は現在のHEAD revisionに属し、original側固有範囲はBASE/HEAD pairに属する。各commitへ独立した完全snapshotを保存しない。
"""
    new = """PR context自体はrepositoryとPR番号で継続する。modified側の確認範囲はHEAD SHAごとのrevision snapshotに属し、original側固有範囲はBASE/HEAD pairに属する。同じHEADへ戻った場合は検証済みexact snapshotを復元し、別HEADから逆向きmappingして既知の確認状態を失わない。詳細は`immutable-revision-review-snapshots.md`に従う。
"""
    if old in text:
        text = text.replace(old, new, 1)
    elif new not in text:
        raise RuntimeError("projection revision ownership paragraph was not found")
    PROJECTION.write_text(text, encoding="utf-8")


def update_breaking_changes() -> None:
    text = BREAKING.read_text(encoding="utf-8")
    heading = "## 2026-08-31: Immutable revision review snapshots"
    if heading in text:
        return
    entry = f"""

{heading}

- 対象: 内部永続化state schema
- 変更: ContextおよびGlobal stateへimmutable revisionごとの確認状態snapshotを追加する。
- 互換性: 既存stateは現在revisionのsnapshotだけをlazy migrationし、過去revisionの状態をhistoryから推測しない。
- 影響: exact revisionへ戻った場合は現在revisionからのreverse mappingではなく、検証済みsnapshotを復元する。
- Failure policy: snapshot不整合はfail closedとし、別revision snapshotを代用しない。
"""
    BREAKING.write_text(text.rstrip() + entry + "\n", encoding="utf-8")


def main() -> None:
    update_main_design()
    update_projection_design()
    update_breaking_changes()


if __name__ == "__main__":
    main()
