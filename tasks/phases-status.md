# Review Range Tracker フェーズ計画

> 更新ルール: このファイルは `task-breakdown-planner`、`task-consistency-manager`、または `progress-sync-manager` を通して更新する。

## 計画の前提

- 設計根拠: `doc/design/vscode-review-range-tracker-design.md` rev4
- 対象成果物: TypeScriptで実装するVS Code Desktop向けWorkspace Extension
- 開発単位: 原則として1タスクを1コミット・1PRで完了できる大きさにする
- 実装方法: 挙動実装では失敗するテストを先に追加し、実装後に単体、統合、またはExtension Hostテストで終了条件を証明する
- 文書同期だけの変更ではRed/Greenを作らず、既存の文書契約と標準CIで検証する
- 確実性原則: 対応関係を一意に証明できない範囲は確認済みにしない
- 恒久設計: task名やPR経緯を設計本文へ入れず、単一の設計書へ機能別に統合する

## 規模の目安

| 規模 | 目安 | 意味 |
| --- | --- | --- |
| S | 0.5〜1日 | 単一コンポーネント内で完結する変更 |
| M | 2〜3日 | 複数モジュールまたは1種類の統合試験を含む変更 |
| L | 4〜5日 | 外部API、Extension Host、永続化などの境界をまたぐ変更 |

Lを超える見込みになった場合は再分解する。

## フェーズ一覧

| Phase | 状態 | マイルストーン | タスク | 依存Phase | 現在の終了状況 |
| --- | --- | --- | --- | --- | --- |
| P0 | 完了 | 開発基盤 | T001〜T003 | なし | build、unit、Git fixture、mock GitHub、Extension Host、architecture gate、失敗診断artifactがCIで動作する |
| P1 | 完了 | ローカル行範囲管理 | T101〜T109、T104-2 | P0 | 通常editorの確認・解除・装飾・永続化・restart復元・VSIX配布が動作する |
| P2 | 完了 | 編集・Git差分追従 | T201〜T207 | P1 | edit/Git差分mapping、branch・detached context、rename・move・delete、JSONL履歴、temporary Git統合試験を実装しmainへ統合済み |
| P3 | 進行中 | diff editorとPR進捗 | T300〜T306 | P2 | T300〜T304はmainへ統合済み。T305のActivity Bar・Current Context・Status Barと、T306のExtension Host統合試験が未着手 |
| P4 | 進行中 | GitHub PR連携 | T401〜T406 | P3 | T401のPR resolverとT402の3段差分取得fallbackはmainへ統合済み。cache、永続PR layer、UI、障害統合試験が未着手 |
| P5 | 進行中 | Global確認済みと理解率 | T501〜T506 | P2、P4 | T501〜T504はmainへ統合済み。Global Understanding UIと複数context統合試験が未着手 |
| P6 | 進行中 | Gitなし対応と堅牢化 | T601〜T608 | P1〜P5 | T601の非Git snapshot追従はmainへ統合済み。rebase回復、migration、排他、multi-root/Remote、障害、性能、最終受入suiteが未着手 |

## 現在位置

- current main: `cb75305898627b3e69d248b931afba4a85fd8ef8`
- 直近統合: T402 PR差分取得の3段フォールバック（PR #40）
- 実装中タスク: なし
- 依存解消済みの着手候補: T305、T403
- T505はT305完了後、T602はT403完了後に着手可能

## P0 開発基盤

### 目的

後続機能が同じbuild、test、module boundary、fixtureを再利用できる状態を作る。

### 終了チェックポイント

- reproducibleな依存管理がある
- VS Code拡張を起動できるmanifestとentry pointがある
- core層がVS Code、GitHub、filesystemへ直接依存しない
- unit、Git integration、mock GitHub、Extension HostをCIで実行できる
- architecture positive/negative gateを独立CI stepとして実行できる
- CI失敗時に原因調査用artifactを保存できる

## P1 ローカル行範囲管理

### 目的

外部Git・GitHub連携なしで、現在fileに対する確認操作、装飾、永続化を成立させる。

### 終了チェックポイント

- 複数選択を半開区間へ正規化し、重複・隣接を結合できる
- 部分解除とfile全体操作が正しい
- 確認済み行をtheme対応で表示できる
- Git/PR状態とGitなし状態を適切なstorageへ保存する
- restart後に確実な状態だけを復元する
- main更新ごとのVSIX prereleaseを配布できる

## P2 編集・Git差分追従

### 目的

編集とGit revision変更に対して、未変更部分を維持しつつ変更部分だけを無効化する。

### 完了内容

- Range Mapping Engine
- Local Git Adapter
- zero-context diff parserとrevision間interval mapping
- rename、directory move、copy/add/deleteの保守的file-state transition
- branch・detached context resolverとGit状態監視
- append-only JSON Lines履歴
- edit、commit、branch切替、rename、delete、restartのtemporary Git統合試験

### 終了チェックポイント

- editの複数変更を正しく移動・分割できる
- remoteまたはroot URIからstable Repository IDを解決できる
- branch、detached HEAD、commit更新を安全に扱える
- renameは一意な場合だけ追従する
- whitespace/EOLは既定で変更扱い、設定時だけ無視する
- historyとcurrent stateが矛盾しない

## P3 diff editorとPR進捗

### 目的

ローカルbase/head比較を使い、GitHub接続前でもPR相当のdiff操作と進捗計算を完成させる。

### 現在の進捗

- T300 共通除外policy: 完了
- T301 PR差分ベース進捗calculator: 完了
- T302 仮想diff URIとimmutable content provider: 完了
- T303 diff editor両側の確認・解除: 完了
- T304 PR Progress Tree provider: 完了
- T305 Activity Bar、Current Context View、Status Bar、refresh/select context: 未着手
- T306 diff操作から進捗UIまでのExtension Host試験: 未着手

### 終了チェックポイント

- 仮想URIからcontext、file、filesystem semantics、side、immutable revisionを復元できる
- Local Git metadataとblobが同じruntime executable・timeoutを使用する
- process timeout時のpartial diagnosticと終了lifecycleを保持する
- original削除行とmodified追加行を確認・解除できる
- 置換を削除と追加として数え、GlobalをPR進捗へ混入させない
- 未確認、完了、除外、rename-only、binary/encoding対象外を分類表示する
- Activity Bar、Tree View、Status Barをruntimeへ接続する

## P4 GitHub PR連携

### 目的

GitHub接続を追加しつつ、認証・network・API障害がローカルレビューを停止させない構成にする。

### 現在の進捗

- T401 GitHub PR context resolver: 完了・main統合済み
- T402 local Git、PR files patch、base/head contentの3段差分取得fallback: 完了・main統合済み
- T403 GitHub metadata・diff cacheとoffline読込: 未着手
- T404 永続PR context layer: 未着手
- T405 Review Contexts ViewとPR管理UI: 未着手
- T406 GitHub障害・複数PR・closed PR統合試験: 未着手

### 終了チェックポイント

- 認証sessionまたはpublic APIでPRを検出する
- local Git、PR patch、base/head contentの順で差分取得する
- tokenとsource本文を不要に保存・log出力しない
- open/closed/merged PRを保存し、表示layerを管理できる
- offline時は更新日時付きcacheを使用する

## P5 Global確認済みと理解率

### 目的

context確認状態とGlobalを同期し、PR進捗と分離した理解率を提供する。

### 現在の進捗

- T501 Repository Global State repository: 完了・main統合済み
- T502 Global mappingと表示優先順位: 完了・main統合済み
- T503 repository file列挙とGlobal集計候補: 完了・main統合済み
- T504 Global理解率の再計算基盤: 完了・main統合済み
- T505 Global Understanding View、Status Bar、Global layer設定UI: 未着手
- T506 複数contextとGlobal集計の統合・Extension Host試験: 未着手

### 終了チェックポイント

- 確認・解除がcontextとGlobalへatomicに反映される
- 現在PR未確認変更をGlobalだけで確認済みにしない
- binary、invalid encoding、gitignore、生成物、user globを共通policyで除外する
- current valid non-empty lineだけで理解率を計算する
- 大規模集計をchunk化する
- PR進捗とGlobal理解率を別UIとして表示する

## P6 Gitなし対応と堅牢化

### 目的

fallback、履歴改変、storage障害、並行実行、大規模dataを含む初期版の受け入れ条件を閉じる。

### 現在の進捗

- T601 圧縮snapshotと非Git行追従: 完了・main統合済み
- T602〜T608: 未着手

### 終了チェックポイント

- Git未導入・非Gitでsnapshot diffが動く
- rebase・force-push後も証拠がある範囲だけ追従する
- migration backup、破損隔離、stale lock回復が動く
- multi-root、Remote SSH、Dev Containers、Codespaces境界を扱える
- 1万変更行規模でもUIを段階表示する
- 設計書21章の受け入れ条件を自動または明示的手動試験で証明する

## Phase間の依存関係

```mermaid
flowchart LR
    P0["P0 開発基盤"] --> P1["P1 ローカル行範囲管理"]
    P1 --> P2["P2 編集・Git差分追従"]
    P2 --> P3["P3 diff editorとPR進捗"]
    P3 --> P4["P4 GitHub PR連携"]
    P2 --> P5["P5 Global確認済みと理解率"]
    P4 --> P5
    P1 --> P6["P6 Gitなし対応と堅牢化"]
    P2 --> P6
    P3 --> P6
    P4 --> P6
    P5 --> P6
```
