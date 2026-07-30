# KinCall — Start Here

The application is built and working. To run it, see **[README.md](README.md)** —
`npm install`, `cp .env.example .env.local`, `npm run dev`, then launch a demo
scenario from a profile page.

This file is the orientation for the *documents*, which are the authority on what
KinCall may and may not do.

## Read in this order

| File | What it is | Status |
|---|---|---|
| [`docs/PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md) | The product scope: agents, cascade, MVP feature list, safety rules | Frozen |
| [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) | The implementation baseline: stack, schema, idempotency | Frozen |
| [`docs/DECISION_LOG.md`](docs/DECISION_LOG.md) | Every approved deviation from the two above, DEC-001 onward | Living — **read last, and treat as authoritative where it conflicts** |
| [`CLAUDE.md`](CLAUDE.md) | Working rules for Claude Code, including the change-control procedure | Living |

The decision log matters more than its position in that list suggests. Several
things the specification states have been deliberately superseded by an approved
decision — the frozen documents are **not** edited when that happens, the change
is recorded in the log instead. The clearest examples:

- **No human-review state.** §15 lists `HUMAN_REVIEW_REQUIRED` and §9.2 lists
  `REQUEST_HUMAN_REVIEW`; DEC-011 removed every path to both. Nothing in the
  workflow waits for a person. An exhausted cascade ends at
  `ATTENTION_UNRESOLVED` instead, a fourteenth state §15 does not list.
- **No priority tier.** §9.2 and §16 show a `priority` field; DEC-011 removed it
  and DEC-012 dropped the column, because high and medium always triggered the
  identical cascade. The decision is binary: close the check-in, or contact the
  trusted circle.
- **Bounded retries.** The person and each trusted contact are called at most
  twice (DEC-011). A contact who answered and declined is never called again.
- **Flat Companion result.** §9.1's nested `signals[]` array was flattened into
  top-level categorical fields (DEC-002, extended by DEC-003 and DEC-011).

## Before changing anything

`CLAUDE.md` requires that a conflict with the frozen specification be **named,
not silently resolved**: explain why the existing choice fails, confirm the
product behaviour is unchanged, get approval, add a `DEC-XXX` entry, and only
then update the architecture document. Applied migrations (`0001`–`0009`) are
never edited.

## The rules that are not negotiable

These hold in every mode, and no decision entry has ever relaxed one:

- KinCall never contacts emergency services.
- KinCall never diagnoses, and never assesses medical severity.
- Nobody is called without confirmed consent.
- Phone numbers are masked wherever they are displayed, and never logged unmasked.
- A model never chooses which telephone number is dialled.
- Uncertainty is preserved in wording — KinCall never asserts that someone is safe.
