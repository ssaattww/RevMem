# Sub-agent実行レポート

## タスク

Issue #81 / PR #82 / T609 の一度限りの全範囲 `independent_final_review`。repository は `ssaattww/RevMem`、branch は `task/issue-81-repository-encoding`、base / merge-base は `3bba5defe32b7da134817492427e09c70c97beaf`、reviewed implementation HEAD は `ecd2b0b8e09c614bb351ed958d09d5ee3180bc30`、range は `3bba5defe32b7da134817492427e09c70c97beaf...ecd2b0b8e09c614bb351ed958d09d5ee3180bc30` である。開始時に local HEAD、`origin/task/issue-81-repository-encoding`、PR head OID、指定 frozen HEAD は一致し、追跡対象外は予約report `reports/issue-81-t609-independent-final-review-20260822060225.md` だけだった。技術 verdict は frozen implementation HEAD だけに適用する。

## sub-agentを使う理由

reviewer identity は `/root/issue81_independent_review` である。T609 の設計・実装・通常review・通常finding修正/closure・検証を担当した agent とは別であり、過去の verdict に依存せず frozen range を独立に確認した。この reviewer 自身は追加 sub-agent を使用していない。

## 対象範囲

Authoritative source は Issue #81、PR #82、`AGENTS.md`、承認設計 `doc/design/document-context-routing.md` と `doc/design/vscode-review-range-tracker-design.md`、`Design/BreakingChanges.md`、tasks/phases、T609 reports 25件、および handoff inventory である。base...HEAD の changed paths 71 / 71（production 22、test 14、type fixture 3、design 2、reports 25、tasks 2、workflow/package/test config 3）を確認し、repository resolution、document encoding、revision mapping/history rewrite、Current Context、Review Contexts、Global、normal editor、state storage、Host runner、package/CI の direct dependencies / consumers / composition を必要範囲で追跡した。

Required coverage disposition は次のとおりである。

- frozen identity / Issue・PR・approved design / scope discipline: `checked_no_finding`
- requirement / design conformance: `checked_finding`（T609-IFR001〜T609-IFR005）
- correctness / edge cases / failure modes: `checked_finding`（T609-IFR001〜T609-IFR004）
- repository resolution order（active Git editor、opened documents、Current/known root、workspace candidates、multi-root explicit selection）: `checked_finding`（順序・dedup・T405再検証は確認、Current Context cancel/stale は T609-IFR002、URI境界は T609-IFR004）
- encoding（`TextDocument.encoding` / `workspace.decode`、Shift-JIS / UTF-8 / UTF-8 BOM mixed、hintなしfatal UTF-8、binary・unknown・invalid file isolation）: `checked_finding`（mixed/file isolationは確認、encoding変更時のstate再計算は T609-IFR001）
- rename / copy / add / encoding change / restart hint non-reuse / whitespace・EOL: `checked_finding`（unique rename、copy/add非継承、restart再観測、whitespace/EOL既存契約は確認、encoding changeだけ T609-IFR001）
- T305 / T405 / T602 / T605 / T606 production compatibility: `checked_finding`（T405 typed cancellation、T602 hint propagationとfile isolation、generic unresolved history、T605 root分離、T606 privacy-safe reasonは確認。T305は T609-IFR002/004、storageは T609-IFR003）
- state / history / unresolved diagnostics: `checked_finding`（generic `immutable-text-unavailable` とpath/encoding非露出は確認、誤ったreviewed interval保持は T609-IFR001）
- Windows storage containment / symlink・junction・reparse security: `checked_finding`（T609-IFR003）
- public API / data / configuration / BreakingChanges compatibility: `checked_no_finding`（追加引数・descriptor・diagnostic・Test-only runtime memberはoptionalで旧shape fixtureに接続され、承認済みbreaking changeはない）
- security / privacy / secret handling: `checked_finding`（diagnostic redactionは確認、filesystem/URI boundaryは T609-IFR003/004）
- cancellation / concurrency / stale publication: `checked_finding`（T405とmapping generation fenceは確認、Current Contextは T609-IFR002）
- test / package / CI wiring / actual Host semantic reachability: `checked_finding`（専用unit/Host/CI wiringは一意に接続されるが、必須Host matrixとpublic command reachabilityは T609-IFR005）
- 通常review 7 findings closure: `checked_finding`（NR001/003/005/007の限定closureは確認したが、NR002/004/006のclosure evidenceを T609-IFR001/002/005 が反証する）
- full local gate evidence: `held`（static 6/6、Git 35/35、GitHub 48/48、T502 11/11、通常VS Code Host全phase Green、focused `test:t609` 52/52、T609/changed-file failure 0をprovided evidenceとして確認。`test:unit`の既知Windows環境22件は成功へ読み替えずheld）
- current exact-head pull-request CI: `held`（merge gate。依頼どおりinspect/wait/pollしていない）
- Markdown wording: `held`（repository-local wiring不在のため`unsupported`。lintは実行していない）
- tasks / phases / reports / handoffs / PR metadata accuracy: `checked_finding`（tasks/phasesとhistorical report provenanceは整合するが、current PR bodyとhandoffは T609-IFR006）

`unexplored = 0`。該当しないcriterionはなく、`not_applicable = 0` である。

## 対象外

test、build、compile、typecheck、lint、architecture validation、`git diff --check`、Extension Host、CI は実行・再実行・待機していない。CI check run / log / artifact もinspectしていない。implementation、test、design、workflow、configuration、tasks/phases、handoff、既存report、branch、commit、push、PR/Issue metadata、tracking、mergeは変更していない。唯一のwriteは予約reportの9箇所のreviewer placeholder置換である。`Design/BreakingChanges.md` は確認したが、現在のoptional public additionsに新しいbreaking entryは不要である。

## 実行コマンド

Read-only evidence collectionとして `git status --short`、`git rev-parse`、`git merge-base`、`git log`、`git show`、`git diff --name-status/--stat/--unified`、`rg -n`、`rg --files`、`Get-Content`、package JSON script表示を使用した。GitHub metadataは `gh issue view 81` と `gh pr view 82` を一度取得した。provided validationは focused `test:t609` 52/52、T609 functional Host 3 phase Green、full local static 6/6、Git 35/35、GitHub 48/48、T502 11/11、通常VS Code Host全phase Green、T609/changed-file failure 0として受領した。`test:unit`の既知Windows/POSIX fixture 19件、SIGKILL 1件、owned Host cleanup 2件の計22件はheldである。current exact-head CIはmerge gateとしてheld、Markdown wordingはwiring不在の`unsupported` heldであり、いずれもpassへ読み替えない。

## 対象ファイル

Changed 71 / 71 は `.github/workflows/ci.yml`、`package.json`、`tsconfig.test.json`、設計2文書、tasks/phases 2文書、T609 reports 25件、`src` 22件、`test` 14件、legacy contract fixture 3件である。Productionは Local Git adapters/revision source、document session providers、atomic store、history rewrite recovery、review-context contracts/mapper、history recorder、`extension.ts`、`t305-extension.ts`、T405 Global/Review Contexts composition、T609 repository/cancellation helpers、Current/Review Contexts UI runtimeを確認した。Testsは document lifecycle、history rewrite、diff content、state repository、T405 regression、T609 unit 7件、Host runner/suiteを確認した。

Direct dependencies / consumersとして repository/global/context persistence contracts、normal-editor command/decorations、Global Understanding source/runtime、PR selection/Review Contexts provider、Git file transition/diff mapping、poll generation/CAS、workspace URI ownership、public barrels/type fixtures、T305/T405/T602/T605/T606 suites、CI contractと通常/専用gateを追跡した。Handoff inventoryにはT609 handoffが存在しないことも確認した。

## 指摘事項

- **T609-IFR001 — High — `src/application/review-context/git-context-revision-mapper.ts:343-359,488-503,832-899`; `src/adapters/document-review-state/git-context-document-review-state-session-provider.ts:334-353,507-565`; `test/unit/document-git-context-lifecycle.test.ts:531-559`.** 同一revisionでopened documentのencodingが変わると、mapperはhintが1件でも全保存fileを再readする一方、Contextは既存fileをspreadして`modifiedReviewed`を保持し、Globalも既存fileをspreadして`reviewed`を保持する。新hintでdecoded text、hash、lineCountが変わっても旧line mappingを再利用し、変更対象外fileまで再read失敗でsnapshotから落とし得る。これは「旧hintのdecoded text/content hash/line mappingを再利用せず対象fileだけ再計算」の承認設計に反し、別の文字列/行へ確認済み表示を誤適用できる。追加testは新hintがreadへ渡ったことだけをassertし、reviewed interval、異なるdecode結果、line count、非対象file保持を検証しない。Required actionはencoding変更対象のstable file identity/pathをmapperへ明示し、そのfileだけを新hintで再decodeして旧Context/Global intervalを安全にclearまたは完全な本文証拠で再mappingし、他fileを触らないこと、および同じraw bytesが異なるtext/line countになるfixtureでContext/Global/history/unresolvedを固定することである。
- **T609-IFR002 — High — `src/ui/current-context/current-context-runtime-composition.ts:36-50`; `src/ui/current-context/current-context-ui-controller.ts:159-178`; `src/ui/current-context/current-context-runtime-coordinator.ts:18-24`; `src/ui/current-context/current-context-candidate-selection.ts:40-47`; `test/unit/t609-normal-review-followup.test.ts:35-53`.** Current Contextの通常`recompute`は複数候補でQuick Pickを呼んだ後、取消を通常の`undefined`として返し、UI controllerが既存Tree/Statusをclearして`acceptRecomputed(undefined)`、coordinatorがselected contextを`undefined`へ変更し依存viewをrefreshする。また明示選択pathと異なり、Quick Pick後に候補を再列挙せず選択root/repository identityを再検証しないため、待機中に消滅・変更したstale candidateをpublishできる。fixtureは取消後に自ら`acceptRecomputed(undefined)`を呼んでおり、既存selection/UI/dependent stateの不変をassertしていない。Impactはmulti-rootのcancel/staleで「選択操作だけ中止」の契約を破り、正常なCurrent Context/Global/decorationsを消すかstale repositoryへ束縛することである。Required actionはcancel/staleをtyped non-destructive outcomeとしてcontroller/coordinatorまで伝播し、既存表示・selection・Global・dependent refreshを変更せず終了し、選択後に候補/root/repositoryIdを再検証すること、およびactual `reviewRange.refreshContext` / `reviewRange.selectContext` のmulti-root cancel/stale regressionを追加することである。
- **T609-IFR003 — High — `src/adapters/state-repository/atomic-text-file-store.ts:85-90,111-146`; `test/unit/state-repository.test.ts:711-738`.** `writeTextAtomically`はconfigured root containmentを検証する前に`mkdir(dirname(filePath), { recursive: true })`を実行するため、root外/sibling targetでも拒否前にroot外directoryを作成する。`physicalPath`はroot自身を`lstat`せず`realpath`で追従し、relative pathの最後のcomponentもlink/reparse検査から外すため、既存root junctionはroot外を正規rootとして受理し、`readText`は最終file symlinkを通じてroot外をreadできる。既存testはdescendant directory linkと例外だけを確認し、拒否前のroot外mutation、root link、final file linkを固定していない。Impactは承認済みWindows storage containment/threat modelに反するroot外mutation/readである。Required actionは一切の`mkdir`/read/write/delete前にlogical containment、rootおよび既存全component（final componentを含む）のsymlink/junction/reparse/identityをfail closedに検証し、検証済みphysical descendantだけをI/Oへ渡し、root外directory不作成・root junction・final symlink・Windows case/siblingをsentinel付きtestで固定することである。
- **T609-IFR004 — Medium — `src/t305-extension.ts:198-217,302-328`; `src/t405-review-contexts-runtime.ts:622-657`; `src/t609-repository-resolution.ts:28-39`; `doc/design/document-context-routing.md:60-70,166`.** T405のactive/opened repository候補だけはquery/fragmentを除外するが、T305はactive/opened/workspace URIをschemeだけで`fsPath`へ変換し、fallbackも同じである。T405もworkspace folder候補とopened encoding hint収集ではquery/fragmentを除外しない。helper contractの「unsafe URIは渡さない」をcallerが満たさず、query/fragment付きfilesystem URIがphysical repository候補または別documentのencoding hintへ昇格する。ImpactはURI identity境界を失い、誤repository選択または誤hintによるmappingを起こせることである。Required actionはworkspace-side URI→filesystem path/hint変換を一つの検証関数へ集約し、scheme、query、fragment、remote authority/host semanticsを全T305/T405 active/opened/known/workspace/fallback/hint経路で同じくfail closedにし、実`vscode.Uri`境界testを追加することである。
- **T609-IFR005 — Medium — `test/vscode/t609-suite/index.ts:75-117,129-197`; `test/unit/t609-gate-wiring.test.ts:151-172`; `doc/design/vscode-review-range-tracker-design.md:1029-1033`.** 専用Host gateはsingle-root no-active-editorとmixed file open、T405 Review Contexts cancel/stale、restart時のhint snapshotを通すが、Current Contextのmulti-root cancel/stale/revalidationを通さず、encoding変更後のmapping/interval再計算も行わない。通常editor markは公開command registrationではなくTest-only `markNormalEditorSelectionForTest`からcommand serviceを直接呼び、restart phaseもhint snapshotだけでstate/Global mappingを確認しない。さらに設計がHostで要求するrename/new file/whitespace/EOL/encoding変更のsemantic matrixはunitにしかない。Impactは52/52とHost 3 phase GreenでもT609-IFR001/002を検出できず、user-reachable composition closureの証拠にならないことである。Required actionはpublic commandsから実T305/T405/normal-editor/provider/mapper/storageへ到達するHost matrixを追加し、Current Context cancel/stale不変、post-pick再検証、live encoding変更のContext/Global interval、rename/new/whitespace/EOL、invalid file isolation、restart non-reuseをassertし、通常/専用CIへ一意に接続することである。
- **T609-IFR006 — Low — PR #82 body; `handoffs/`; `tasks/tasks-status.md:11-18,370`; `tasks/phases-status.md:40,188`.** tasks/phasesは通常7 findings closed、full local結果、Windows 22件/Markdown/CI held、independent待ちを正しく記録する一方、PR bodyは依然「production実装とTDDは進行中」「通常review・独立review・最終local gateは未実施」で、report linkもdesign 1件だけである。またfrozen independent targetへ渡すT609 implementation/normal-review handoffがrepositoryに存在しない。ImpactはPR/current handoffだけを読む後続workerが実際のreview/evidence/head/held stateを復元できず、tracking source間で状態が分岐することである。Required actionはhistorical reportを書き換えず、finding修正・通常finding-limited verification・新target freeze時にcurrent T609 handoff、tasks/phases、report referencesを同期し、PR bodyを実際の状態/検証/held/next actionへ更新することである。

## 結果

**Verdict: FAIL.** Required findingsはHigh 3件（T609-IFR001〜003）、Medium 2件（T609-IFR004〜005）、Low 1件（T609-IFR006）であり、この一度のfull-scope independent passで全件を同時に確定した。severity reclassification / erratumはなく、後続で新規criterionまたは新規findingを追加しない。通常7 findingsのうちNR001/003/005/007 closureは維持するが、NR002/004/006のclosure evidenceは本findingにより不十分である。Heldは既知Windows unit 22件、current exact-head CI merge gate、Markdown wording tooling `unsupported`。Unexploredはnone。

`report_attestation_allowed: false`。passing verdictではないため、このreserved reportをfrozen HEAD直後のterminal administrative report-attestation commitとして扱えない。Next actionはimplementation ownerがT609-IFR001〜006を一括でtracked workへ戻し、project-required TDD/validation、report/tracking/handoff同期、commit/push、同一normal reviewerのfinding-limited verificationを完了して新technical HEADをfreezeすることである。その後、このindependent reviewerは本6件のproduction path / actual composition / focused evidence / gate wiring / trackingだけをclosureし、新規観点を追加しない。全件closedかつverdictが`pass`または許容されたheldだけの`pass_with_held`になった場合に限り、reviewed technical HEADをfirst parentとしreserved reportだけを含む単一の直後commit、後続commitなし、administrative-only明記というreport-attestation条件を満たせる。mergeは禁止する。

## リスク

Current exact-head pull-request CIはmerge gateとしてheldであり、inspect/wait/pollしていない。Markdown focused/full wordingはrepository wiring不在の`unsupported` heldである。provided full local equivalenceはT609 failure 0だがrepository-defined `test:unit` 22件のため全体passではなく、今回のcode findingsを上書きしない。本reportのpersistence modeはfail verdictを記録するreserved repository fileで、report-attestation headはnullである。report commit、technical completion、merge authorizationとして扱ってはならない。唯一の許可write以外のrepository/GitHub stateは変更していない。
