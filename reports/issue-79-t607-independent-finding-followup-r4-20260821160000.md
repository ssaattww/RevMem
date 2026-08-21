# T607 independent finding follow-up R4

## タスク

Issue #79 / PR #80 の independent closure R3 で残った `T607-IFR002`、`T607-IFR004`、`T607-IFR006` の required action だけを、committed base `68de40686cb5573fcbe71cd72bab1dcb027185f0` 上の未コミット technical working tree に一括で補完した。`T607-IFR001`、`T607-IFR003`、`T607-IFR005` は R3 closure で closed のため変更対象外とした。

## sub-agentを使う理由

implementation owner が reviewer と独立して、既存 finding の required action だけを実装した。independent reviewer の R4 verdict は含めない。

## 対象範囲

IFR002 は Global recalculator の初期 path map/order、opened evidence copy、actual T405 Review Contexts source/controller/tree の candidate collection・projection・sort を共有 `<=128` scheduler の管理下に置いた。256 saved contexts の production registration fixture で late projection abort、dispose、reverse supersession、stale nonpublication、cache ownership 不変、started generation ごとの exactly-one terminal を固定した。IFR004 は production decoration session/load handler に generation-aware current PR diff を接続し、actual activation factory の PR context fixture で1万行 Unicode document、1万 changed-line diff、2,048 intervals、multiple contexts、split visible editors、reverse supersession、exact options/bookkeeping/host apply を実行した。

## 対象外

R3 closure で closed の IFR001/IFR003/IFR005、新しい finding 観点、設計拡張、CI、commit、push、PR metadata、review、self-review、全 unit suite は対象外である。

## 実行コマンド

source Red は `reports/issue-79-t607-independent-finding-closure-r3-20260821153000.md` の IFR002/IFR004/IFR006 FAIL である。minimal implementation 後に fixture を固定したため local focused test は初回から Green であり、合成 Red は作っていない。`npm run test:t607` は 79 pass / 0 fail。`npm run build`、`npm run lint`、`npm run typecheck:contracts`、`npm run validate:architecture` は pass。`npm run validate:architecture:negative` は expected 11 violations と一致。`git diff --check` は pass。Markdown wording tooling は repository wiring 不在のため unsupported held。

## 対象ファイル

`src/application/global-understanding/global-understanding-background-recalculator.ts`、`src/t505-global-understanding-source.ts`、`src/application/review-contexts/review-contexts-controller.ts`、`src/application/review-contexts/index.ts`、`src/t405-review-contexts-runtime.ts`、`src/ui/review-contexts/vscode-review-contexts-runtime.ts`、`src/application/editor-decoration/normal-editor-decoration-model.ts`、`src/ui/normal-editor/normal-editor-decoration-controller.ts`、`src/extension.ts`、`src/t305-extension.ts`、`src/t405-pull-request-review-runtime.ts`、`test/unit/t607-performance-incremental-ui.test.ts`、tracking/report/handoff ファイル。

## 指摘事項

新規指摘は作成しない。IFR002 では fabricated staged `load` result を使わず、actual T405 saved-context acquisition/source/runtime/controller/tree composition と Global source/recalculator を通した。IFR004 では fabricated descriptor/model を使わず、current PR diff を actual activation decoration composition へ接続した。すべての instrumented operation は `<=128` items で、stale generation は I/O・publication・host apply を行わない。IFR006 は README、tasks、phases、handoff、reports を actual base/current count/closure state へ同期した。

## 結果

IFR002/IFR004 の actual production fixtures と `npm run test:t607` 79/79、static gates は local Green。technical HEAD は committed base `68de40686cb5573fcbe71cd72bab1dcb027185f0` のままで、R4 technical delta は未コミット。same independent reviewer による IFR002/IFR004/IFR006 R4 finding-limited closure が pending である。CI は technical commit freeze 後の merge gate まで held。

## リスク

local focused/static evidence は exact-head `pull_request` CI の代替ではない。same independent reviewer が R4 finding-limited scope で required action と最終 technical diff を確認するまで merge は認可されない。
