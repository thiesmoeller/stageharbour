# Proposed agent skill configuration

Review draft only. The user has chosen local Markdown issues, standard triage labels, and the existing shared domain context. Selection of AGENTS.md or CLAUDE.md is pending.

## Agent-instructions block

```markdown
## Agent skills

### Issue tracker

Before reading, creating, or updating issues, follow the local Markdown conventions in docs/agents/issue-tracker.md.

### Triage labels

Before assigning issue status, read the standard label mapping in docs/agents/triage-labels.md.

### Domain docs

Before domain design or implementation, follow the shared glossary and ADR reading rules in docs/agents/domain.md.
```

## Proposed docs/agents/issue-tracker.md

```markdown
# Issue tracker: Local Markdown

Issues live in .scratch/<feature-slug>/issues/<NN>-<slug>.md, numbered from 01. The current feature slug is stage-planner. Read the existing directory before allocating a number.

Each issue has a title, Status: and Type: lines, and What to build, Acceptance criteria, and Blocked by sections. Use relative links to actual issue files for dependencies. A ready status indicates specification readiness; complete blockers before picking up a dependent issue.

Publishing means creating the issue file. Fetching means reading its complete contents and comments. Append discussion under a Comments section. Preserve existing issue text unless the requested workflow calls for an update.

Source planning documents remain in docs/. Add a Parent section only when the source is an existing tracker issue or PRD. A future tracker PRD can live at .scratch/<feature-slug>/PRD.md.

On completion, retain the triage Status and add Resolution: completed with a Completion section describing verification. A dependent issue is unblocked only when its blockers have that resolution and the implementation is present. The repository has no pull-request tracker configured.
```

## Proposed docs/agents/triage-labels.md

```markdown
# Triage labels

Record one standard triage label in the issue's Status: line:

- needs-triage: requires evaluation.
- needs-info: waiting for information.
- ready-for-agent: sufficiently specified for AFK implementation once dependencies are complete.
- ready-for-human: requires human participation.
- wontfix: will not be actioned.

Record Type: AFK or Type: HITL separately. Resolution is separate from triage status; see issue-tracker.md for completion handling.
```

## Proposed docs/agents/domain.md

```markdown
# Domain documents

This repository has one shared domain context.

Before exploring or changing domain behavior, read the root CONTEXT.md and relevant decisions in docs/adr/. Use glossary terms in issues, code, and tests. Flag conflicts with ADRs rather than silently replacing a decision.

For implementation scope, read docs/planner-decisions.md and the relevant milestone in docs/project-plan.md, then the active issue. CONTEXT.md is a glossary, not an implementation specification.

If a referenced domain document is absent, proceed with the available context; create new domain documents only when terminology or decisions are established.
```
