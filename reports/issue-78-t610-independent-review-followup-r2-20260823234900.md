# Sub-agent実行レポート

## タスク

- Independent closureで不足とされたIFR001〜003のactual composition fixtureを、production seamを変更せず追加する。

## sub-agentを使う理由

- 同じindependent reviewerの5-cell基準を実装workerが具体的なT305/Node/runtime fixtureへ変換し、再closure可能な証拠を作るため。

## 対象範囲

- T305 restart/startup-open、actual runtime TreeDataProvider/public stop、Node `mutateStopped` fault後のsnapshot/watcher/restart、runtime source progress contract。

## 対象外

- 性能、Host、CI、production state algorithmの追加変更、design、BreakingChanges、tracking、historical report。

## 実行コマンド

- `npm run compile:test`とIFR001〜003 focused fixtureを実行し4/4 Green。
- `npm run test:t610`は70/70 Green。`npm run build`、`npm run lint`、`git diff --check`は成功。
- T607性能test、Extension Host、CIは0回。

## 対象ファイル

- `src/ui/global-understanding/vscode-global-understanding-runtime.ts`
- `test/unit/t610-folder-understanding.test.ts`
- 本report

## 指摘事項

- IFR001: 実`createT305GlobalUnderstandingSource`とNode marker storeでstopを永続化し、新instanceがdefault false/true双方で既存open documentを観測してもstopped・content capture 0を維持する。
- IFR002: actual registered Tree providerへrunning snapshotをI/O前にpublishし、そのprovider-owned rowをpublic stop commandへ渡してpending refreshをcancel、stopped rowへ更新する。
- IFR003: actual T305 sourceとNode storeの`mutateStopped` writeをEACCES化し、resume rejection後もwatcher admission=false、snapshot=stopped、新instance restart=stoppedを維持する。

## 検証結果

- Actual composition focused 4/4、T610全体70/70、build/lint/diffcheck Green。
- runtime interfaceは既存refresh sourceのoptional progress callbackを明文化しただけで、callback未使用consumerの互換性を維持する。
- Markdown専用lintはrepository wiring不在でunsupported。設定変更なし。

## 最終結果

- IFR001〜003のproduction・actual composition・focused evidenceが揃い、same independent reviewerのfinding-limited closureへ再提出可能。性能workloadは実行せず、CIにも含めない。
