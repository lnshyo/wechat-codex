# Skill Evolution Rules

Use when extracting reusable workflows, modifying global skills, creating project-local skills, or turning repeated repository lessons into cross-repository standards.

## Extraction Criteria

Promote a workflow into a reusable skill only when at least one is true:

- The pattern applied successfully in this repository and is likely to apply to multiple other repositories.
- The task has fragile steps that should not be reconstructed from memory each time.
- The same mistake or correction has appeared more than once.
- The workflow benefits from bundled templates, scripts, or reference files.

## Sequence

1. Finish the current repository change first.
2. Record practical lessons in `memory/YYYY-MM-DD.md` and candidates in `memory/learning-inbox.md`.
3. Distill what generalized and what stayed repo-specific.
4. Update or create the reusable skill.
5. Validate the skill metadata and, when practical, pressure-test it on realistic scenarios.

## Skill Quality Rules

- Keep `SKILL.md` concise and move large templates or detailed standards into `references/`.
- Do not put a one-off repository narrative into a reusable skill.
- Include triggers in the skill description so future sessions load it at the right time.
- If the skill changes repository files, require startup inspection before scaffolding anything.
