# KinCall

> Because every vulnerable person deserves someone who checks in.

KinCall is a multi-agent phone care coordinator. A Companion Agent calls a
vulnerable person for a natural check-in, a deterministic orchestrator analyses
the structured result, and a Family Agent contacts the trusted circle in order
until someone confirms they can intervene.

KinCall does not replace families, health professionals or emergency services.

## Documentation

The product and architecture are frozen. Read these before contributing:

- [`docs/PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md) — frozen product scope
- [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) — frozen implementation baseline
- [`docs/DECISION_LOG.md`](docs/DECISION_LOG.md) — approved deviations
- [`CLAUDE.md`](CLAUDE.md) — Claude Code working rules

## Stack

Next.js App Router, TypeScript, Tailwind CSS, Vitest. Supabase PostgreSQL and
the CALL-E REST API are part of the frozen baseline but are not wired up yet.

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Status

Project scaffold only. The fake-mode vertical slice described in
`docs/TECHNICAL_ARCHITECTURE.md` section 11, phase 2 is not implemented yet.
