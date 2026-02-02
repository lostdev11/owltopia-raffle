# Supabase Postgres Best Practices for AI Agents

Reference: [Postgres Best Practices for AI Agents](https://supabase.com/blog/postgres-best-practices-for-ai-agents)

This document maps Supabase’s recommended practices to the Owl Raffle codebase so AI agents and developers follow consistent patterns when changing schema, queries, or connection logic.

---

## 1. Query Performance (CRITICAL)

- **Indexes**: Add indexes for `WHERE`, `ORDER BY`, and join columns used in hot paths. Avoid unnecessary indexes.
- **Optimization**: Prefer targeted `SELECT` columns; avoid `SELECT *` on wide tables when not needed.

**In this project:**

- Initial indexes: `supabase/migrations/001_initial_schema.sql` (e.g. `idx_raffles_slug`, `idx_entries_raffle_id`, `idx_entries_raffle_status`).
- Extra index hints: `supabase/migrations/021_index_hints.sql` (e.g. `idx_raffles_status`, `idx_raffles_end_time_desc`, `idx_raffles_created_at_desc`). Apply only what’s missing after checking `pg_indexes`.
- When adding new query patterns (filters, sorts, joins), add or document supporting indexes in a migration; see 021 for the style.

---

## 2. Connection Management (CRITICAL)

- **Pooling & scaling**: Use connection pooling where appropriate; avoid unbounded connection growth.
- **Transient failures**: Retry with backoff on connection/timeout errors; do not retry on validation or auth errors.

**In this project:**

- **Retry utility**: `lib/db-retry.ts` — `withRetry()` and `withQueryRetry()` with exponential backoff; `isRetryableError()` filters connection/timeout/PostgREST-style errors.
- **Usage**: Critical DB calls in `lib/db/raffles.ts`, `lib/db/entries.ts`, and `lib/db/admins.ts` are wrapped with `withRetry`.
- **Realtime**: `lib/supabase.ts` configures realtime reconnect with backoff; `lib/hooks/useRealtimeEntries.ts` falls back to polling on failure.
- **Admin client**: `lib/supabase-admin.ts` uses health checks and client recreation on failure.

See **DATABASE_RECONNECTION.md** for full behavior and configuration.

**Rules for agents:** When adding new server-side DB access, use `withRetry()` from `lib/db-retry.ts` for Supabase calls that can hit connection issues.

---

## 3. Security & RLS (CRITICAL)

- **Row Level Security**: Keep RLS enabled on user-facing tables; define policies so access is explicit (who can SELECT/INSERT/UPDATE/DELETE).
- **Principle of least privilege**: Avoid permissive policies (e.g. `USING (true)`) unless clearly required and documented.

**In this project:**

- RLS is enabled on `raffles` and `entries` (001); admins table and policies in 003–005, 008–010, 013, 020.
- Policies are tightened in `020_fix_permissive_rls_policies.sql`; avoid reintroducing overly broad policies.
- When adding tables or new access patterns, add RLS and policies in a migration and document the intent.

---

## 4. Schema Design (HIGH)

- **Structure**: Normalize where it reduces duplication and ambiguity; use constraints and types that match domain rules.
- **Partial indexes**: Use partial indexes when queries always filter on the same condition (e.g. `WHERE is_active = true`).

**In this project:**

- Schema and constraints live in migrations (001, 002, 006, 007, 012, etc.). Use `CHECK` and `REFERENCES` as in existing migrations.
- Index hints in 021 include notes on partial indexes where relevant (e.g. active raffles). Follow that pattern for new filters.

---

## 5. Concurrency & Locking (MEDIUM–HIGH)

- **Contention**: Avoid long-running transactions and broad locks; keep transactions short and focused.
- **Unique constraints**: Prefer `UNIQUE`/constraints over “check-then-insert” to avoid races (e.g. slug uniqueness).

**In this project:**

- Raffles use `slug TEXT UNIQUE`; entries and other critical uniqueness are enforced in the schema or in small, targeted transactions.
- When adding “reserve then confirm” or similar flows, use DB constraints or short transactions rather than long-held locks.

---

## 6. Data Access Patterns (MEDIUM)

- **Consistency**: Use the same access path for the same concept (e.g. “list raffles” goes through one function/query pattern).
- **Pagination**: For lists, use limit/offset or keyset pagination and index accordingly (see 021).

**In this project:**

- Public raffle listing and single raffle by slug/id are centralized in `lib/db/raffles.ts`; entries in `lib/db/entries.ts`. Add new patterns there and document any new indexes.

---

## 7. Monitoring & Diagnostics (LOW–MEDIUM)

- **Logging**: Log retries and connection failures at debug/warn level; avoid logging full rows or PII.
- **Health checks**: Use lightweight checks to detect unhealthy connections (e.g. admin client health check).

**In this project:**

- `lib/db-retry.ts` logs retry attempts; `lib/supabase-admin.ts` runs periodic health checks and recreates the client on failure. Keep logs free of sensitive data.

---

## 8. Advanced Features (LOW)

- **Vector / AI**: Not used in this app. If adding pgvector/embeddings later, follow Supabase AI docs (e.g. vector columns, indexing, going to prod).

---

## Quick checklist for AI agents

When editing database-related code:

1. **New query pattern** → Consider an index (see 001 and 021); add migration if needed.
2. **New server-side Supabase call** → Wrap with `withRetry()` from `lib/db-retry.ts`.
3. **New table or column** → Use a migration; add RLS and policies for new tables.
4. **RLS / policy change** → Prefer least-privilege; document in migration and here if broad.
5. **Connection / retry behavior** → Keep retries for transient errors only; see `isRetryableError()` and DATABASE_RECONNECTION.md.

---

## Related docs

- [DATABASE_RECONNECTION.md](./DATABASE_RECONNECTION.md) — Retry, reconnection, and realtime behavior
- [Supabase: Postgres Best Practices for AI Agents](https://supabase.com/blog/postgres-best-practices-for-ai-agents)
- [Supabase: Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) — Pooling and connection options
- [Supabase: Realtime](https://supabase.com/docs/guides/realtime) — Realtime and reconnection
