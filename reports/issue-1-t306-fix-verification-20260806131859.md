# T306 通常レビューfinding修正確認

> 予約済み出力先。初回通常レビューと同じレビュワーが `T306-R1-P1` と `T306-R1-P2` のbounded closure verification結果を記録する。

## 判定

- verdict: `fail`
- reviewed head: `933641219993f44cc96f39932b8837055a3851b8`
- source review head: `82400f6726445691ef8e0e2e11b0894a274d0bcc`
- inspected fix range: `82400f6726445691ef8e0e2e11b0894a274d0bcc..933641219993f44cc96f39932b8837055a3851b8`
- verification kind: normal-review finding fix verification（bounded closure verification）
- report attestation: `not_allowed`

対象は初回通常レビューで記録した2件だけとし、finding IDとseverityを維持した。修正差分、直接影響、同一欠陥クラスのsibling、必要な既存テスト、および指定されたexact-head CIを確認した。新規findingの探索や通常レビューの再実行はしていない。

## Finding disposition

### `T306-R1-P1` — High — `open`（not closed）

実プロダクション構成への置換、永続化repository、TextDocumentContentProvider、PR Progress Tree、登録済みcommand経由の受け入れテスト追加は、元findingを大きく改善している。しかし、findingの必須境界である「実際に開いたVS Code diff editorのoriginal/modified側へフォーカスして登録済みcommandを実行する」はまだ立証されていない。

- `src/extension.ts:569-581` は `vscode.diff` をfire-and-forgetで実行し、成功を待たずにopened recordを追加する。`vscode.diff` がrejectする、またはdiff editorを開かない場合でも、テスト用recordは成功相当に見える。
- `test/vscode/t306-suite/index.ts:170-175` と `test/vscode/t306-suite/index.ts:193-195` はTree command実行後、recordから得た各URIを `showTextDocument` で個別の通常text editorとして開き、mark/unmark commandを実行する。実際のdiff editorの左右paneをフォーカスしていない。
- `src/extension.ts:482-491` はURI schemeが `review-range-diff` であればactive diff editorとして扱うため、上記の個別text editorでもcommandが通る。このため同一欠陥クラスのfalse-positiveが残る。

必要な修正は、`vscode.diff` の完了をawaitし、active tabが対象2 URIの `TabInputTextDiff` であることを確認したうえで、実際のoriginal/modified paneをフォーカスして登録済みcommandを実行する受け入れテストにすること。`vscode.diff` のrejectまたは未open時にGreenにならない回帰ケースも必要である。

### `T306-R1-P2` — Medium — `open`（not closed）

owned worker、launch timeout、process-tree termination、診断、意図的hang/finite failureテストの追加は、元findingを大きく改善している。しかし、「各Extension Host launchが成功通知後も含めて有界である」という同一ライフサイクル欠陥クラスが閉じていない。

- `test/vscode/owned-extension-host-launch.ts:138-155` はworkerから `succeeded` messageを受け取るとtimeoutをclearし、その後 `await closed` を無期限に待つ。workerが成功通知後にhandleまたは子processを残した場合、owned treeをterminateせずrunnerが再び無期限にhangする。
- `test/unit/owned-extension-host-launch.test.ts:26-86` は「成功通知なしのhang」と「有限exit failure」は確認するが、「成功通知後にworker/子processが残る」siblingを確認していない。
- `package.json:213` の明示的な `test:unit` 対象には `owned-extension-host-launch.test.js` がなく、専用scriptは `package.json:233` に分離されている。.github/workflows/ci.ymlのUnit testsおよびVS Code Extension Host testsにも `test:vscode-runner` の実行はないため、指定CIは意図的hang回帰を実行していない。

必要な修正は、launch開始時のabsolute deadlineをworker closeまで維持し、成功通知後も残り時間内にcloseしなければowned process treeをterminateしてfailureにすること。また、成功通知後にtimerまたはnested childを残すworkerの回帰テストを追加し、`test:vscode-runner` を `test:unit` またはrequired CI stepへ組み込むこと。

## Exact-head CI evidence

- GitHub Actions run `31070807328`: `success`、event `push`、head SHA `933641219993f44cc96f39932b8837055a3851b8`
- job `92518177076` (`build-and-lint`): `success`
- Build、Contract typecheck、Architecture validation/negative contract、Lint、Unit tests、T403、T304、T502、T503、T504、Temporary Git、Mock GitHub、VS Code Extension Host testsはすべて成功した。
- VS Code Extension Host logでは `t306`、`t302`、`lifecycle-confirm`、`lifecycle-restore-confirmed-and-unmark`、`lifecycle-restore-unmarked` の5 launchが `status: succeeded` かつ `exitCode: 0` だった。
- ただし、このGreen runはP1の実diff pane focus失敗ケース、およびP2の成功通知後hang回帰を実行していないため、上記2 findingのclosure evidenceにはならない。

## 実施した確認

- `git diff --check 82400f6726445691ef8e0e2e11b0894a274d0bcc..933641219993f44cc96f39932b8837055a3851b8`: pass
- 修正差分と対象実装・テストの静的確認
- `gh run view 31070807328 --repo ssaattww/RevMem --json ...`: exact-head run/job/step status確認
- `gh run view 31070807328 --repo ssaattww/RevMem --job 92518177076 --log`: 5 launchの成功ログとrunner regression未実行を確認
- ローカルの広範なtest suiteは再実行していない。指定されたexact-head CIと、残存欠陥を直接示すコード・テスト境界で判定した。

## Held risk / scope boundary

- 初回レビューでheldとした、このworktreeの既知のWindows unit test 19 failuresは本確認のfindingへ昇格せず、引き続き外部リスクとして保持する。
- Markdown wording checkは `tools/lint/`、`lint:md`、focused lint wiringがrepositoryに存在しないため `unsupported`。対象は本レポート1ファイル、設定変更候補やbacktick/quoteによるprose lint回避はなく、設定は変更していない。このunsupported stateは本bounded closure verdictを上書きしない。
- 本確認は `T306-R1-P1` と `T306-R1-P2` のclosureだけに限定した。範囲外の変更や新規finding候補は探索・評価していない。
- 次回は上記残存境界だけを修正したHEADに対し、同一レビュワーが再度bounded closure verificationを行う。
