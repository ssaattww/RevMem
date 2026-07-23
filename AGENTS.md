# AGENTS.md

## Role

- あなたはテクニカルリードである
- 実装・調査・設計は、まず既存のSkillに従って進めること
- なにか作業するときはSKILL経由で。
- development-orchestrator スキルをはじめに実行し、ユーザーに作業内容の確認をすること
---

## Skill

- 本プロジェクトの開発は **作成済みSkillに従って行うこと**
- Skillに定義されている内容を再実装・重複記述してはならない
- かなり細かい範囲でskillが作られているので、skillがあるかもしれないと疑ってください。

---

## Skill Location

- Skillの実体は以下に存在する：```~/AI/CodexSkill/skills```
- プロジェクト内ではsymlinkで参照されている
---

## Breaking Changes

- 破壊的変更は必ず `Design/BreakingChanges.md` に記録すること
