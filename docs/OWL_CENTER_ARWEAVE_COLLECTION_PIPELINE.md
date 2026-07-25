# Owl Center: Arweave-aligned collection pipeline (recommended)

This document is the **approved operator workflow** for shipping Owl Center collections with **pre-rendered art + metadata**, storing assets on **Arweave** (Irys / Sugar), then **wiring the site** via Owl Center admin.

## Standards (moving forward)

| Launch type | On-chain standard | Deploy path |
|-------------|-------------------|-------------|
| **New partner / admin `public_simple`** | **Metaplex Core** + **Core Candy Machine** (default) | In-app onchain deploy (`mint_standard=core`) |
| **Legacy escape hatch** | Token Metadata + Candy Machine V3 | Same helper when `mint_standard=token_metadata` |
| **Owltopia Gen2** | Token Metadata CM V3 (sold out) | Mint tools soft-retired; keep thaw / ledger / marketplace |

New submissions default to `mint_standard: core`. Freeze Collection requires Core (collection PermanentFreezeDelegate). Admin thaw: `POST /api/admin/owl-center/collections/{id}/core-thaw`.

Public mint UI (`CollectionMintPanel`) uses Core `mintV1` when `mint_standard === 'core'`, otherwise TM `mintV2`.

**Mobile:** verify Phantom / Solflare mint first (~75% of users). Core mint txs are smaller than TM `mintV2`. Nesting and raffle escrow already support `mpl_core`.

---

## Recommended phases

| Phase | What | Who |
|--------|------|-----|
| **A — Ship** | Pre-render → Arweave (Irys) → **in-app Core CM deploy** → wire IDs → mobile mint test → production | Operators + admins |
| **B — Product** | Staging ZIP, validation UX, background Arweave jobs | Engineering |

Sugar CLI remains valid for **legacy Token Metadata** only. Sugar does not deploy Core Candy Machines — use in-app Core deploy for partners.

---

## Phase B — In-app uploads (implemented)

Admins stage a **Sugar export ZIP** on `/admin/owl-center/collections/{launch_id}/assets`:

1. **Stage Sugar ZIP** — uploads to private Supabase Storage (`owl-center-asset-staging`), runs validation, auto-fills asset package counts + checklist.
2. **Push to Arweave** — requires `IRYS_PRIVATE_KEY` (funded Solana wallet). Uploads PNGs then rewritten JSONs via Irys in batches (`OWL_CENTER_ASSET_UPLOAD_BATCH`, cron every 2 min).
3. **Mark ready for Candy Machine** — then **Deploy CM + guard** in admin (`mint_standard=core` → Core collection + Core CM + botTax guard + config lines; optional PermanentFreezeDelegate when freeze enabled).

Migration: `143_owl_center_asset_upload_jobs.sql`. Cron: `/api/cron/owl-center-asset-upload`. On-chain deploy API: `POST .../assets/sugar-deploy` with `{ "action": "deploy_onchain" }` (uses `IRYS_PRIVATE_KEY`; cap 250 supply on server).

Until Irys env is set, Phase B still handles **staging + validate**; Arweave push is manual via admin button or cron after env is configured.

---

## Gen2 (sold out)

Gen2 mint ops are soft-retired via `isGen2PublicMintRetired()` (emergency re-open: `GEN2_PUBLIC_MINT_ENABLED=true`). Phase-advance and reprice crons are removed from `vercel.json`. Keep confirm/reconcile, freeze/thaw, metadata repair, milestones, nesting, and marketplaces.

Historical Gen2 guard group labels (`gen1` / `pre` / `wl` / `pub`) live in `lib/solana/gen2-guards.ts` for ledger/reconcile only.

---

## Quick links

| Resource | URL |
|----------|-----|
| Core Candy Machine | https://developers.metaplex.com/core-candy-machine |
| Sugar overview | https://developers.metaplex.com/candy-machine/sugar |
| Candy Machine V3 (legacy TM) | https://developers.metaplex.com/candy-machine |
| Sugar GitHub | https://github.com/metaplex-foundation/sugar |
