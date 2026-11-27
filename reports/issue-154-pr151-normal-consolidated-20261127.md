# Issue #154 / PR #151 — 通常レビュー・検証統合記録

### 対象

- 子Issue：[ #154 — GitHub Viewedの読み取りとPR進捗表示](https://github.com/ssaattww/RevMem/issues/154)
- 親Issue：#93（第2段階の書き込み対応は対象外、Openを維持）
- [Draft PR #151](https://github.com/ssaattww/RevMem/pull/151)
- Branch：`task/issue-93-github-viewed-sync-design`
- Base：`main` / `1a25b982ae42490e9cb609108ac0372dad82d333`
- `technical_head`: `4f0726181e540da33b69131bbe700ebbafeb4eba`
- `administrative_parent`: `4f0726181e540da33b69131bbe700ebbafeb4eba`
- 記録状態：`commit_pending`
- 通常レビュー判定：`pass_with_held`

### 実装範囲

GitHub.com の本人Viewed状態を読み取り、ローカル確認状態と区別して表示する。既定OFF、本人・PR・差分・ファイル識別、完全取得および古い結果の失効を必須とする。GitHubへの更新、Approve、レビュー送信、コメント、Unview、マージは対象外。

設計根拠：`doc/design/issue-93-github-viewed-sync.md`。設計レビューの必須6件は解消済み。

### 通常レビューと指摘解消

R01–R06は、既存の `I93-NR-001`〜`I93-NR-006` に対応する。重大度は変更しない。

| ID | 重大度 | 指摘と解消根拠 |
|---|---|---|
| R01 | High | 固定viewer IDとloginの照合を追加。未紐付けのローカル状態は表示専用とし、同期適格性をfalseに固定。 |
| R02 | High | GitHub.com以外を認証取得前に拒否。Enterpriseの発行元不確定リスクを対象範囲の限定によって解消。 |
| R03 | Medium | 有効対象の認証・通信・取得失敗を「取得不可」と表示。既存の期限とAbortSignalを使用。 |
| R04 | Medium | 選択、設定、認証、ローカル確認操作の変更時に同じ表示コントローラで失効。通常エディタの非同期保存先確定前の選択変更にも対応。 |
| R05 | Medium | ローカルとGitHubの変更ファイル一覧全体を照合し、不一致・識別不能時の部分表示を禁止。 |
| R06 | Medium | 認証、コントローラ、通常コマンド、文書編集の試験を通常テストへ登録。成功・保存失敗・非同期選択変更の回帰を確認。 |

同一通常レビュアーにより全6件解消、新規必須0件を確認した。最終通常レビュー対象25ファイルのハッシュ照合に加え、CI対応3ファイルを含む公開HEADの28ファイルすべてでGit blobの一致を確認した。

### 後続CI対応（R01–R06と区別）

| 対象HEAD | 自動CI | 対応・結果 |
|---|---|---|
| `5087cd68ab2aa210e83d7a4bc20509a416c71bf0` | [46074215175](https://github.com/ssaattww/RevMem/actions/runs/46074215175) | `mock-github.test.ts` のオプショナル型不整合で失敗。 |
| `9dc42619532f5dfa99bc5b430fe3cded4b12da88` | [46074895778](https://github.com/ssaattww/RevMem/actions/runs/46074895778) | 認証モックの型を修正。既存assertionを維持。次にT609の旧通知構造契約で失敗。 |
| `4f0726181e540da33b69131bbe700ebbafeb4eba` | [46075453598](https://github.com/ssaattww/RevMem/actions/runs/46075453598) | T609構造契約と公開4コマンドの通知動作試験を修正。 |

CI対応はテスト3ファイルのみ。製品コード・合否条件の弱体化はない。同一通常レビュアーによる両差分の必須指摘は0件。

### 検証

- 最終通常レビュー時の独立した焦点再実行：65/65成功、TypeScript `--noEmit` 成功。
- 実装側の報告：焦点101/101、型・層・静的検査成功。後続CI修正後の`test:unit` 1068/1068成功。
- CI差分の焦点再実行：1/1成功。
- 挙動変更のRed→Greenは報告された個別回帰を確認済み。初回実装全体のRed時系列証拠は本記録では独立確認していない。
- 正式HEADと一致するPR自動CI #5137（run `46075453598`）：**completed / success**。
- [build-and-lint job](https://github.com/ssaattww/RevMem/actions/runs/46075453598/job/140762013222)：成功39ステップ、失敗時診断2ステップskip。build、typecheck、architecture正負、lint、unit、T609、GitHub模擬統合、Extension Host、VSIX生成・検証成功。
- CI成果物：`review-range-user-validation-0.1.65-pre+4f07261`（artifact ID `15234813361`、同HEAD）。

### 残件と境界

実アカウントでの認証・取得、利用者実画面での操作は未検証。CIのExtension Host試験を実機検証とは扱わない。

本記録は通常レビューの閉鎖記録であり、独立最終レビュー・凍結・attestationではない。子Issue #154、Draft PR #151を維持し、親Issue #93の書き込み段階には進まない。
