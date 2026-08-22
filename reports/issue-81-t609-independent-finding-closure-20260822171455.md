# Review report

## Review type

`independent_final_review_finding_limited_closure`。初回一度限り・全範囲 independent final review を行った同一reviewer `/root/issue81_independent_review` が、そこで確定した `T609-IFR001`〜`T609-IFR006` だけを一括処分した。新規観点、新規finding探索、severity再分類、実装、test/build/lint/Host/CI実行・待機は行っていない。

## Target identity

Issue #81 / T609 / PR #82。source independent reviewed HEAD は `ecd2b0b8e09c614bb351ed958d09d5ee3180bc30`、最終production/test technical HEAD は `5501cd7b613066ac8a6300aabd75d1ff4a407069`、本closureのfrozen administrative HEADとupstreamはともに `0cc50f7e22f6ae47bfea572535f690c6f0a63f4f`、base / merge-base は `3bba5defe32b7da134817492427e09c70c97beaf` である。`5501cd7..0cc50f7` はhandoff、reports、tasks/phasesだけのadministrative deltaで、production/test差分はない。

## Scope

初回report `reports/issue-81-t609-independent-final-review-20260822060225.md` の6 findingについて、各required action、production path、actual composition / Host fixture、focused evidence、tracking / PR body factを完全なmatrixとして照合した。初回全範囲reviewのcriterionを再度広げず、fix rangeとCI/admin deltaだけを確認した。code、test、design、Breaking Changes、workflow、tracking、handoff、PRの編集、commit、push、CI待機、mergeは対象外であり、write boundaryは本予約reportの9 placeholder置換だけである。

## Evidence reviewed

- Source authority: Issue #81、PR #82、初回independent report、承認設計2文書、`Design/BreakingChanges.md`、base / merge-base、初回71 changed pathsの既存coverage。
- Closure evidence: R28 restart mapping、same normal reviewer R2、final full local equivalence、final unit failure classification、base unit comparison、normal final gate delta、normal unit baseline delta、current handoff、tasks/phases、PR body、および `ecd2b0b8..5501cd7` のfinding関連production/test pathと `5501cd7..0cc50f7` のadministrative delta。
- Provided execution evidence: final `npm run test:t609` 77/77、build/compile/lint/diff check Green、actual `npm run test:t609:extension-host` のsingle-root・prepare・restart-reopen・owned cleanup全成功。final full local gateは11 command中9 passで、unitは完全取得504 tests / 479 pass / 23 fail / 2 skip、baseは546 / 522 / 22 / 2、failure集合はexact match 22・base-only 0・current-only Windows file-symlink fixture `EPERM` 1、confirmed regression 0。`test:git` はT207 cleanup `EBUSY` 1件。これらをsuccessへ読み替えていない。
- 本closureでtest/build/lint/Host/CIを実行または待機した回数は0。read-only code/Git/PR metadataだけを使用した。

## Finding dispositions

- `T609-IFR001` — High — **closed**。Required actionの「同一revisionのencoding変更時に変更stable pathだけを再decodeし、Context/Global intervalをclear、非対象を保持、invalid/binaryを分離」は、`TextDocument.encoding`から`encodingChangedPaths`をproviderへ渡すproduction経路とmapperのtargeted refreshに接続された。focused fixtureは対象の新hint読取、hash/line count更新、非対象保持、decode不能時のidentity保持・interval clear・privacy-safe unresolvedを固定し、77/77とactual Hostのlive Shift-JIS→UTF-8、BOM非対象保持、invalid isolation、R28 restart non-reuseがGreenである。
- `T609-IFR002` — High — **closed**。Required actionのtyped cancel/stale non-destructive処理とpick後再検証はCurrent Context runtimeからUI controller/coordinatorまで接続され、fresh candidate集合に対するselection revalidationを行う。unit fixtureとactual public-command Host fixtureはmulti-root cancel/staleでselection、snapshot、dependent refresh countが不変であることを確認し、repository resolution順序とcancel/stale境界を満たす。
- `T609-IFR003` — High — **closed, validation limitation held**。Required actionのI/O前logical containment、configured rootと既存全component（finalを含む）のlink/junction fail-closed、outside sibling拒否前のmkdir禁止、検証後再validationは`NodeAtomicTextFileStore.physicalPath`と全read/write/delete経路へ接続された。real-filesystem fixtureはoutside sibling、descendant junction、final file symlink、root junction、outside-directory不作成、sentinel不変を保持する。R13のAtomic store focused 15件はGreenで、final unit/base deltaのconfirmed regressionは0。ただしcurrent Windowsでは新fixtureのfile `symlink()` 準備が`EPERM`となりproduction assertion前に停止したため、root/final-link fixtureのcurrent-Windows実行成功とは扱わずheldに残す。後段exact-head CIがこのfixtureを含めGreenであることをmerge条件とする。
- `T609-IFR004` — Medium — **closed**。Required actionのURI query/fragment/authority/scheme境界はshared typed URI→filesystem helperに実装され、T305 hint rootとT405 context rootの両consumerが使用する。actual `vscode.Uri` unit/Host fixtureはquery、fragment、NUL、local authority、unsupported scheme、異なるremote authority、workspace外をfail closedにし、同一remote authorityのworkspace descendantだけを許可する。77/77とactual Host Greenである。
- `T609-IFR005` — Medium — **closed**。Required actionのuser-reachable semantic matrixは公開 `reviewRange.markSelectionReviewed`、T305/T405/Current Context command、production provider/mapper/storage/decorationへ到達するactual Host fixtureに接続された。mixed Shift-JIS/UTF-8 BOM/invalid、live encoding変更、rename/new/whitespace/EOL、multi-root cancel/stale、restart encoded identity保持・hint非再利用をassertし、runner cleanupを含む一度のexact Host実行が全phase Greenである。package/CI wiringは9本のT609 unit targetを各1回、focused suiteとHost gateを各1回だけ呼ぶ。
- `T609-IFR006` — Low — **closed**。tasks/phases/current handoffはtechnical head `5501cd7`、77/77、actual Host全phase、unit exact-base 22 + Windows fixture `EPERM`、T207 `EBUSY`、Markdown unsupported、exact-head CI pendingを現在事実として記録する。PR #82 bodyもadministrative head `0cc50f7`へ外部同期され、6件addressed、normal delta `pass_with_held` / unexplored 0、reports/handoff、残るsame-independent closureとCI/mergeを正確に示す。historical reportは改変していない。
- Severity reclassification: なし。High 3件、Medium 2件、Low 1件をsource reportどおり保持した。ready / closed 6、incomplete 0、open 0である。

## Validation assessment

Finding completeness matrixは6件すべてについて required action=`satisfied`、production path=`connected`、actual composition/fixture=`present`、focused evidence=`sufficient`、tracking/PR-body facts=`current` と処分した。IFR003のWindows symlink fixtureは実測failedのままheldへ分離し、R13 focused Green、direct production/fixture review、base comparison、confirmed regression 0、および後段CI必須条件を合わせてclosure blockerではないと判断した。final full local gateはall-Greenではないが、既知failure全23件とT207 failureは完全分類済みでT609 confirmed regression 0。normal-path blocker、user-confirmation-required capability gap、新規findingはない。

## Held items

- `test:unit`: baseとfailure identity/cause classがexact matchする22 failures。
- `test:unit`: current-only `NodeAtomicTextFileStore` Windows file-symlink fixture setupの`EPERM`。production assertion未到達であり、成功扱いしない。
- `test:git`: T207 Windows Temp cleanupの`EBUSY` 1件。
- Markdown wording check: repository-local `tools/lint/`、`lint:md`、対応設定がないためunsupported。代替の未定義checkerは実行していない。
- current exact-head pull-request CI: 本report-only attestation commit後のmerge gateとしてheld。今回inspect/waitしていない。merge前に必須check Greenを確認し、特にIFR003 symlink/junction fixtureを含むgate failureは本verdictを無効化する。

## Unexplored

`0`。6 findingの全matrix cell、technical/admin delta、provided local gate failure全件、tracking/handoff/PR body、attestation boundaryを処分した。Markdownとexact-head CIはunexploredへ隠さずheldとして明示した。

## Verdict

`pass_with_held`。`T609-IFR001`〜`T609-IFR006` は全件closedで、required findingは残っていない。

`report_attestation_allowed = true`。ただし許可は次の全条件を満たす場合に限る。本予約reportだけを変更する**即時の exactly one report-only commit**を作成し、そのfirst parentがfrozen HEAD `0cc50f7e22f6ae47bfea572535f690c6f0a63f4f`、変更pathが `reports/issue-81-t609-independent-finding-closure-20260822171455.md` だけであること。commit前後にcode/design/workflow/config/tracking/handoff/他reportを変更せず、そのcommit後はexact-head CI確認とmergeまでrepository writeまたは後続commitを一切行わないこと。PR metadataへattestation SHA/reportを外部同期し、その新しいexact HEADの必須pull-request CIをGreenで確認してからmergeすること。

first-parent/path/no-later-write条件、またはexact-head CI Greenのいずれかを満たさない場合、attestationと本completionは無効であり、mergeしてはならない。後続repository writeが必要になった場合は新しいreview lifecycleを開始する。
