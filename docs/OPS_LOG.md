# Admin Ops Log

Internal Owl Vision tool for tracking **manual money moves** and **support incidents**: refunds sent by hand, prize payouts, treasury top-ups, mis-sends, stuck buyers, fee refunds, and one-off ops notes.

- **UI:** `/admin/ops-log` (also linked from the Owl Vision dashboard for `mod` and `full` roles).
- **API:** `/api/admin/ops-log` (list/create) and `/api/admin/ops-log/[id]` (patch/delete).
- **Database:** `public.admin_ops_log` — migration `250_admin_ops_log.sql`.

## Access

Uses the existing **`admins`** table roles:

| Role | Ops Log |
|------|---------|
| `mod` (junior) | View, create, edit status/fields |
| `full` | Same + hard delete |

Session auth matches other Owl Vision admin routes (`requireAdminSession` / `requireFullAdminSession`).

### Granting Arc (or any junior mod)

No new env var is required. Add or update a row in **`public.admins`** with role **`mod`**:

```sql
INSERT INTO public.admins (wallet_address, role, created_at)
VALUES ('<ARC_SOLANA_WALLET>', 'mod', now())
ON CONFLICT (wallet_address) DO UPDATE SET role = EXCLUDED.role;
```

Arc’s support wallet was seeded in migration `196_admin_mod_role.sql`. dev dad can confirm the wallet in Supabase or run the upsert above if the address changes.

Full admins (`role = 'full'`) already have Ops Log access.

## Migration

Apply on Supabase (production/staging as usual):

```bash
# filename
supabase/migrations/250_admin_ops_log.sql
```

Table is **RLS-enabled** with an explicit deny-all policy; only **service_role** (Next.js admin API) can read/write.

## Fields (summary)

- **type:** `refund`, `prize_payout`, `top_up`, `mis_send`, `incident`, `fee_refund`, `other`
- **status:** `pending`, `done`, `lost`, `needs_decision`
- **asset:** `SOL`, `OWL`, `USDC`, `NFT`, `other` (optional)
- **related:** free text (pack open id, raffle slug/URL, GitHub PR link, etc.)
- **created_by_wallet / updated_by_wallet:** set from the signed-in admin session

## Follow-up

When admin payout tools (e.g. packs **resolve-open** from PR #263) land on `master`, consider calling `insertAdminOpsLogAuto()` from those code paths so successful on-chain actions append a row automatically.
