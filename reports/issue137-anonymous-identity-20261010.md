# Issue137 短命匿名identity alias 実装・検証

通常実装 report。対象は既存 PR138 / `issue-136-137-refresh-and-safe-diagnostics`、開始かつ指摘対象 HEAD `cc59c2c6357786afc8f03809088c540d90db22f2`、base `72082d336f8d00480f3e50908f929e88529bcaf8`。review-target commit/push と新HEAD CIはこの記録時点では pending。結果 SHA は commit後の外部 handoff / PRコメントに記録する。本 report は自己変更の独立レビュー判定ではない。

## 要求と指摘

根拠は [Issue137 accepted design](https://github.com/ssaattww/RevMem/issues/137#issuecomment-6007653447) と canonical design §16.2。IR138-REQ-003 は Medium の未充足要求で、cc59の production boundary `current-context-pull-request-views.ts` における選択・登録・snapshotの0/1 ordinalだけでは異なるrepository/branch/PR/context/snapshotを区別できないという指摘である。独立証拠は `task-4/pr138-closure-cc59/requirements-assessment.json` と `requirements-identity-probe.json`。生値や単純hash、永続化、session外で再利用できるidentityタグを使わず、検証済みidentityの匿名対応関係を実stage間で追跡する。severityは変更しない。

同じcc59で独立reviewerがIR138-HOST-002 / IR138-MAIN141-001をclosedとした事実を保持する。今回その修正、通常selection/failure/generation/cache、Issue139 discovery、PR141 reader分類を変更しない。

## 実装

- `pull-request-refresh-aliases.ts`: owner/generationごとの短命allocator。rawキーはそのownerのmemory mapだけに置く。固定kindとidentity由来ではないprocess内allocation ordinalの型付き参照を発行し、同一identityは同じ参照、別identityは別参照にする。WeakMapの発行証明で偽造・clone・wrong-kind・別owner/generation・異なるscope混入を拒否する。完了・failure・cancel・supersede時にmapを破棄し、新ownerでは同じ対象にも新参照を発行する。formatterの既存記録はsafeな参照だけで後から読める。
- `operation-feedback.ts` / exports: 件数とは別のallowlisted aliases項目を検証し、Outputに `repository=repo-N branch=branch-N pullRequest=pr-N context=context-N snapshot=snapshot-N` の固定順で出力する。raw自由文字列を受理しない。
- Current Context descriptor / T405 projection / coordinator: 検証済みcandidateのbranchだけを伝え、受理したselectionにrepo/branch/PR/context aliasを割り当てる。PR labelやremote branchから推測しない。ownerなし、未受理、workspace、branch未検証の場合は対応するaliasを省略する。
- production PR views: 実登録snapshotが受理selection/immutable BASE/HEADと一致した後だけsnapshot aliasを割り当て、既存Progress/Tree identity検査を通した同一ownerの参照を登録→Progress→Treeまで引き継ぐ。失敗は成功公開として扱わず、取消後の遅延処理は対応表を再構築しない。
- 既存回帰、README/canonical design、旧Issue90 PR file表示契約の優先関係、tasks/phasesを更新。依存・環境・認証設定・永続state/history/telemetryへのalias対応表は追加しない。

## 検証証拠

FA780 / PowerShell / Windows、既存Node24.20.0、TypeScript6.0.3、Git2.46、既存node_modulesを使用。`verification_capability=local_execution_available`。ログ・stdout/stderr・コマンド・PID・開始/終了UTC・exit・SHA-256を workspace外部 `pr138-issue137-alias-20261010` に保存する。実行入力465件のLF正規化manifestは最終 `publication-executable-inputs.json`、fingerprint `cc1a75a2c0b1c60b05f6dfdc9a87a6265bc2ab184fafc5009dc497b83cde66f1`。先行manifestも保持し、tooling fixture変更・ownerless guard追加に伴う検証対象の差分を記録した。後続commit treeとの照合は外部で記録する。

| 検査 | 結果 / 根拠 |
| --- | --- |
| 実production checkout/list/selection/snapshot/Treeのalias回帰 | `alias-production-red`: compile成功後6件すべてalias欠落で実Red、製品変更後 `alias-production-green` 6件成功 |
| 同じ/異なる対象・owner・privacy | OFF/ON実経路で同一ownerの参照一致、新ownerの同一対象にも新参照、実repository root/context/BASE/HEADを構造化記録とformatterへ出さないことを検査 |
| 型付き発行証明・terminal cleanup | OFF/ONで複数identity、偽造/clone/kind/scope/owner/generation混入拒否、success/failure/cancel後allocation不可を検査 |
| 既存関連回帰 | `alias-focused` 123成功/0失敗/0skip（追加のterminal assertion前）。最終 `alias-terminal-regressions` 18成功/0失敗/0skip、実T405取得拒否/中断ではidentity aliasを作らず、publication failureは検証済み参照、cancel/supersedeは破棄を検査 |
| compile / build / lint / contracts / architecture | 各exit0。testへの追加privacy assertionでfixture field名のcompile errorを1件保存し、正しい既存root accessorへ修正後 `alias-candidate-compile-2` exit0。architecture negativeも期待する違反contractでexit0 |
| ownerのないrefresh境界 | `alias-ownerless-red`: 明示ownerなしでsnapshot aliasを発行してambient ownerへ混入する実Redを保存。1行guard追加後 `alias-ownerless-green` tooling15件成功。明示ownerのない参照は省略し、通常Tree更新を維持 |
| 全unitの前段tooling fixture | 先行 `alias-full-unit` で旧 `owner:{}` fixture2件がcleanup API欠如で失敗。実OperationFeedbackのactive lifecycleを使う形に変更し元の順序/branch保持assertを維持。`alias-tooling-owner-regressions`14件成功、`alias-full-unit-2` tooling31/unit1015成功。後続ownerless差分のため最終候補へ流用せずaffected gateを再実行 |
| 公開候補全unit / Git / GitHub / T502 | `alias-full-unit-final`: tooling32/unit1015成功、0失敗/0skip。`alias-final-git`:67成功/0失敗/3既存skip、`alias-final-github`:49成功/0失敗/0skip、`alias-final-t502`:11成功/0失敗/0skip。Git/GitHub/T502はcompile成功済み同一sourceでpackage scriptと同一のcompiled Node test一覧を実行。先行結果も履歴として保持 |

## Issue136証拠の訂正と限界

Issue136には既存の[Output抜粋](https://github.com/ssaattww/RevMem/issues/136#issuecomment-6027111986)がある（2026-10-06T23:09:34Z）。read-onlyで本文を保存し、日時116箇所・lifecycle marker63箇所を確認した。raw本文は共有出力へ再掲していない。欠けるのは版、特定branch/PR、checkout前後のselection/registration/snapshot/Treeの対応trace等である。「全Outputが未取得」という表現を訂正し、物理端末の完全再現済みとは扱わない。checkout自動eventを新たな必須要件にはせず、受理済みrefresh時の再評価契約を維持する。

FA780 Hostは既知の `vscode-updating` mutexで起動前阻害される。updaterや設定を操作せず、ローカルfull gateはHost成分unsupportedのまま、supported local gatesと同一HEAD CIを区別する。cc59のPR38031385064/push38031382382で全HostとPR版VSIX配布が成功した歴史的証拠は新実装HEADの証拠に流用しない。今回の新HEAD CI、元実機の特定対象再現、IR138-REQ-003の独立closureはこの時点で未完了。通常fix verificationへの引継ぎではローカル検証済みreview-target HEADを渡し、CIの未完了は外部で明示する。最終attestation後のrequired PR CI待機は親のmerge gateである。main push、force push、PR merge、新branch/PR/Issue、依存追加は行わない。

## 引継ぎ

build成功の通常review-target commit/push後、PR138本文とRefsのみの関係付けを保持して証拠を公開する。外部handoffへ正確な新HEAD、remote readback、同一HEAD CI/成果物、未確認範囲を記録し、同じ独立reviewerへIR138-REQ-003と差分のclosureを渡す。今回のreportは通常repository_fileであり、独立final review attestationは作成していない。
