# Issue #139 PR再検出設計

## 要件と範囲

保存済みContextの有無にかかわらず、現在のローカルブランチに対応するopen / closed / merged PRを再検出し、既存の選択UIからCurrent Contextへ切り替える。PR138の変更は取り込まない。

## 候補の識別

GitHub検索は全状態を対象にする。HEAD SHA一致だけに依存せず、現在のbranch/refとidentity remote、設定されたremote tracking branchから検索するhead repository/refを決める。同名branchが別forkにある場合はhead repository識別子で除外する。tracking先が曖昧な場合は保守的に候補を絞る。detached HEADではbranch対応を推測しない。

## 表示と状態分離

候補にopen / closed / merged状態を保持し、既存Quick PickにPR番号・タイトルと状態を表示する。選択後は既存repository/PR番号に基づくContext identityとimmutable base/head revision、Progress、review stateの分離を維持する。新しい依存や認証設定は追加しない。

## 検証計画

テスト先行で未保存open/closed/merged、SHA不一致でも同じbranch/remoteの候補、別fork/別branch除外、複数状態の選択、tracking名の違い、保存済みContextと状態分離を検証する。focused tests後にbuild、contract型検査、architecture正負、lintと既存unit/integration/Extension Host検証を行い、正確なHEADとログを親へ渡す。通常レビューと独立最終レビューは親が担当する。
