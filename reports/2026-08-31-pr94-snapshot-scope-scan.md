# Sub-agent実行レポート

## タスク

- 目的: `PR94-CI-003`のimmutable revision snapshot未実装範囲を依存順の0.5h sliceへ確定する。
- タスク種別: design-to-code scope investigation

## sub-agentを使う理由

- 理由: Terra/highが設計・既存core・payload evidenceを直接照合し、過大な一括実装を避けるため。

## 対象範囲

- 対象: immutable revision snapshot design、missing product/test、直接依存、focused validation計画。

## 対象外

- 対象外: 実装、design/workflow/package/tracking編集、performance、commit、push、merge、review、CI待機。

## 実行コマンド

- 実行コマンド:
  - Read-only: `git rev-parse HEAD` — `1171bb9132ddd72c263715bd5beb605137a69da2`、branch `codex/pr94-ci-review`。
  - Read-only: current contracts, revision mappers, PR runtime, filesystem state repository, focused tests, package registration, and `git show HEAD:.github/issue-92-revision-snapshot-{implementation,correction}.py`。
  - `git diff --check -- reports/2026-08-31-pr94-snapshot-scope-scan.md` — report更新後に実行する。build/testは調査scopeのため未実行。

## 対象ファイル

- 変更または確認したファイル:
  - 変更: `reports/2026-08-31-pr94-snapshot-scope-scan.md` のみ。
  - 現在snapshot model未実装: `src/core/contracts/review-state.ts`（`ReviewContextState`/`RepositoryGlobalState`に`revisionSnapshots`およびsnapshot typeなし）、`src/core/contracts/index.ts`、`src/core/review-state/index.ts`。
  - 現在snapshot restore/miss未実装: `src/application/review-context/git-context-revision-mapper.ts`、`src/application/github-pr-context/immutable-pull-request-revision-mapper.ts`。後者はtarget snapshotを見ず常にevidenceをloadしてmappingし、BASE-only経路で`originalReviewedByDiff`を空にするため、過去pair保持要件とも不一致。
  - atomic integration: `src/application/github-pr-context/github-pull-request-context-layer-store.ts`はContext/Globalを一回のrepository CASでcommit済み、`src/t405-pull-request-review-runtime-base.ts`はPR selection/file commandのcommitterを同repositoryへ直結、`src/adapters/document-review-state/git-context-document-review-state-session-provider.ts`はlocal Git mapping結果を同じcomplete commitでpublishする。
  - persistence validation: `src/adapters/state-repository/coherent-file-system-review-state-repository.ts`/`validated-file-system-review-state-repository.ts`はcomplete Context/Global CAS・stale rejectを提供済み。`src/adapters/state-repository/persistence-schema-recovery.ts`はcurrent filesを厳格検証するがnested `revisionSnapshots`をまだ検証・隔離しない。
  - test gap: `package.json`は`test-dist/test/unit/immutable-revision-review-snapshot.test.js`を`test:unit`へ登録済みだが、source `test/unit/immutable-revision-review-snapshot.test.ts`は存在しない（`Test-Path` false）。

## 指摘事項

- 指摘要約または「指摘なし」:
  - 設計必須contractは、full immutable SHA keyのContext/Global snapshotと比較pair-keyのOriginal rangeを分離し、A→B→C→AではA hitをexact restore（reverse diffなし）とする。Context/Global hit/missは独立でも、source capture・restore/mapping・target capture・publishは一回のcomplete CASでなければならない。
  - hitはschema/key/payload revision、file key/ID/path、line count、content hash、interval canonicality、timestamp、target descriptor/evidenceを全て検証する。不正hitを別revisionやmappingへsilent fallbackせずfail closed、stale generation/CAS conflictも再読込・再計画前にpublishしない。
  - `git show HEAD`で読んだtemporary payloadは、上記の型追加・`revision-snapshot-service.ts`・PR mapper/testの候補を示す。しかしimplementation版はgeneric core mutationへPR専用synchronizeを混入し、correction版はそれを`origin/main`へ戻してT405 commandだけでwrite-throughする。この二案は、設計4.1/4.2の「全current stateとsource capture」要件に対して互いに矛盾し、どちらもlocal Git/normal command経路を完全には閉じない。payloadの全量適用は不可。
  - safe recommendation: snapshot synchronization/restoreをcoreのimmutable value serviceへ集約し、core transactionの型をPR固有にしない。既存repositoryのcomplete CASを唯一のpublication boundaryとして、PRとlocal Gitのcallerが同一serviceを使う。
  - Design evidence: `doc/design/immutable-revision-review-snapshots.md` sections 2–11 and `doc/design/vscode-review-range-tracker-design.md` 10.2, 10.3.1, 15.2–15.4 require exact identity, complete snapshots, atomic CAS, stale rejection, and persistence quarantine.

## 結果

- 結果:
  - 最小依存順（各slice ≤0.5h、TDD）は次の3段階。
  - Slice 1 — model/persistence Red→Green: write `src/core/contracts/review-state.ts`, `src/core/contracts/index.ts`, new `src/core/review-state/revision-snapshot-service.ts`, `src/core/review-state/index.ts`, `src/adapters/state-repository/persistence-schema-recovery.ts`, and new `test/unit/immutable-revision-review-snapshot.test.ts` only. Redはmissing test/source imports（package登録済み）と、legacy current-revision seed・corrupt key/revision/path/hash/line/interval rejectionを固定する。Greenは`npm run compile:test`、emitted immutable snapshot focused test、`state-repository`/`core-contracts` focused tests。exitはoptional legacy fieldを受理し、nested invalid snapshotをquarantine/fail-closedし、pure serviceがdeep-frozen inputを変えずContext/Global snapshotを独立hit/missとして返せること。
  - Slice 2 — PR transition Red→Green: write `src/application/github-pr-context/immutable-pull-request-revision-mapper.ts`, `src/application/github-pr-context/github-pull-request-context-layer-store.ts`, and direct `immutable-revision-review-snapshot`/`github-pull-request-context-layer-store` tests only. RedはA→B→C→A exact hitでevidence loaderを呼ばないこと、Context-hit/Global-miss mixed plan、HEAD shared + BASE pair separation、history reasonを固定する。Greenは同focused tests。exitはsource capture、per-layer restore-or-map、target captureを既存single CASでpublishし、BASE-onlyでold `originalReviewedByDiff` pairを消さず、stale/CAS failureでhistoryもsnapshotもpublishしないこと。
  - Slice 3 — mutation/local-Git write-through Red→Green: write `src/t405-pull-request-review-runtime-base.ts`, `src/adapters/document-review-state/git-context-document-review-state-session-provider.ts`, `src/application/review-context/git-context-revision-mapper.ts`, and direct `t405-pull-request-review-runtime`, `document-git-context-lifecycle`, `git-context-revision-mapper-binary`, plus immutable snapshot tests only. Redはsuccessful PR selection/file and local Git normal command/mapping update current revision snapshot; no-op/cancel/stale/commit failure must not update it. Green is those emitted focused tests. exitはPR runtimeとlocal Git pathのcommitterがcurrent Context/Global/Original snapshotをsame complete transactionへwrite-throughし、local Git exact target hit bypasses reverse mapping while miss maps conservatively; no snapshot-specific second write is introduced.
  - Scope boundary: Slice 3 is the smallest route that covers both product paths required by the design. If the accepted issue is PR-only, omit the local-Git two source/test paths only after explicit design scope reduction; otherwise a T405-only fix is knowingly incomplete.

## リスク

- 未解決のリスクまたは後続対応:
  - No implementation/test was run or changed in this scan. The package registration with no test source is a current test-tracking gap and will fail the full unit command once it reaches that node target.
  - `revisionSnapshots` must not recursively contain a parent snapshot map; the new persistence validator and clone/capture service need an explicit non-recursive projection. Payload uses JSON clone and an `as unknown` evidence fixture, so it is evidence only, not authoritative code.
  - A generic core write-through approach versus application-boundary synchronization is an architectural choice. The design forbids partial publication, but the current callers need a shared boundary; resolve this in Slice 1 API design before editing mutation paths.
