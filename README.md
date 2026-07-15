# HUUID Resolver

Production resolution engine for **`did:huuid`** — a W3C-registered health identity
method (W3C DID Extensions PR #722) built for Ghana's national healthcare identity
infrastructure.

- **Every request is audited.** The audit write happens *before* the response is
  sent; if it fails, the resolution fails with 500.
- **Every audit is immutable.** No UPDATE, no DELETE — enforced by RLS, GRANTs,
  and database triggers.
- **Medical data never touches this server.** DID documents are pointer maps only.

## Stack

Next.js 14 (App Router, TypeScript strict) · Supabase (Postgres, service-role only)
· Vercel.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /1.0/identifiers/{did}` | W3C DID Resolution (see [api.md](api.md)) |
| `GET /api/health` | Health probe |
| `GET /debug/resolver` | Temporary raw-data debug page |

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values — never commit .env.local
npm run dev
```

Checks before every commit:

```bash
npm run lint
npm run type-check
npm run build
```

## Database

Migration lives in `supabase/migrations/001_initial.sql` — two tables with the
`huuid_` prefix (shared Cedimaker Supabase project):

- `huuid_did_documents` — DID document registry (service_role: SELECT/INSERT/UPDATE; no DELETE — deactivate only)
- `huuid_audit_log` — immutable audit trail (service_role: SELECT/INSERT only)

Both tables: RLS enabled, zero anon/authenticated access, explicit GRANT blocks
(required post May 30 2026).

## Environment variables

See [.env.example](.env.example). `SUPABASE_SERVICE_ROLE_KEY` is server-side only —
guarded by a `server-only` import in `lib/supabase-server.ts`.
