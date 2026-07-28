# KinCall — Start Here

The first project step is to commit the frozen documentation before writing application code.

## Files

- `docs/PRODUCT_SPECIFICATION.md` — frozen product scope
- `docs/TECHNICAL_ARCHITECTURE.md` — frozen implementation baseline
- `docs/DECISION_LOG.md` — approved future deviations
- `CLAUDE.md` — mandatory Claude Code working rules

## Initial commit

From the project root:

```bash
git add CLAUDE.md docs/
git commit -m "docs: freeze KinCall product and technical architecture"
```

Push this commit before asking Claude Code to scaffold the application.

## First Claude Code instruction

```text
Read CLAUDE.md and every file in docs/. Do not write code yet.
Summarize the frozen product scope, technical architecture, prohibited
technologies, implementation order and the first vertical slice.
List any contradiction you find between the files.
```

Only after the summary is correct, ask Claude Code to scaffold the Next.js project and implement the fake-mode vertical slice.
