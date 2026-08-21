# T607 independent finding follow-up R3

## タスク

Issue #79 / PR #80 の independent closure R2 で残った `T607-IFR002`、`T607-IFR004`、`T607-IFR006` の実装証跡を、base `dca4447f44ffdc810216dcd929d7ed14993245ff` 上の未コミット technical working tree に一括で補完した。IFR001 と IFR003 の既存修正は維持した。

## sub-agentを使う理由

implementation owner が reviewer と独立して、既存 finding の required action だけを実装した。independent reviewer の verdict は含めない。

## 対象範囲

`T405ReviewContextsSource` と登録済み Review Contexts controller/tree の実経路で、256 saved workspace contexts、PR HEAD cache mutation 中の逆 supersession、abort、accepted generation 一回だけの cache publish を固定した。通常 editor は activation が実際に使う descriptor/state/options/bookkeeping/VS Code host factory を抽出して再利用し、10,000 Unicode lines、2,048 intervals、split visible editors を actual document-state provider と最小 host double で実行した。

## 対象外

CI、commit、push、PR metadata、review、self-review、全 unit suite は実行していない。新しい finding 観点、設計拡張、IFR005 は対象外である。

## 実行コマンド

Red: factory 導入直後の `npm run compile:test` は test-mode runtime query の `appliedDecorations` 未公開で失敗し、factory return contract の不足を確認した。修正後、`npm run test:t607` は 79 pass / 0 fail。`npm run build`、`npm run lint`、`npm run typecheck:contracts`、`npm run validate:architecture` は pass。`npm run validate:architecture:negative` は expected 11 violations を一致確認。`git diff --check` は pass。Markdown wording tooling は repository wiring 不在のため unsupported held。

## 対象ファイル

`src/ui/review-contexts/vscode-review-contexts-runtime.ts`、`src/extension.ts`、`test/unit/t607-performance-incremental-ui.test.ts`、既存 IFR001/IFR002 production changes の `src/t405-pull-request-review-runtime.ts`、`src/t505-global-understanding-source.ts`、`src/application/global-understanding/global-understanding-background-recalculator.ts`、`src/adapters/crypto/node-sha256-stable-hash.ts`。

## 指摘事項

新規指摘は作成しない。`T607-IFR002` は fabricated `load` provider を使用せず actual `registerT405ReviewContextsRuntime` の source/controller/tree/cache path を通す fixture へ差し替えた。`T607-IFR004` は fabricated descriptor/model を使用せず `createNormalEditorDecorationActivation` の actual descriptor/state/options/bookkeeping/host path を通す fixture へ追加した。stale refresh failure が newer accepted projection を clear しない generation check も Review Contexts provider に追加した。`T607-IFR006` は README、tasks、phases、handoff をこの未コミット technical state と closure pending に同期する。

## 結果

local implementation evidence は Green。technical HEAD はまだ `dca4447f44ffdc810216dcd929d7ed14993245ff` 上の未コミット差分であり、new technical commit SHA は存在しない。same independent reviewer による IFR001〜IFR004/IFR006 finding-limited closure が次工程で、CI はその freeze 後の merge gate まで held。

## リスク

local focused/static evidence は exact-head `pull_request` CI の代替ではない。reviewer が finding-limited scope で required action と current diff を確認するまで merge は認可されない。
