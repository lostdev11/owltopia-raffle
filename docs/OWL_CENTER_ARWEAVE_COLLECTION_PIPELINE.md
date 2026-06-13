# Owl Center: Arweave-aligned collection pipeline (recommended)

This document is the **approved operator workflow** for shipping a Metaplex Candy Machine collection (e.g. Gen2, 2000 supply) with **pre-rendered art + metadata**, storing assets on **Arweave** (typically via Sugar’s uploader / bundler path), then **wiring the site** via Owl Center admin.

The app mint UI (`mintGen2FromCandyMachine` and related routes) consumes **on-chain Candy Machine + collection NFT** IDs from env and/or `owl_center_launches`; it does **not** upload folders or deploy the CM itself.

---

## Recommended phases

| Phase | What | Who |
|--------|------|-----|
| **A — Ship (now)** | Pre-render → **Metaplex Sugar** validate/upload/deploy → paste bundle references in Owl Center → devnet mint test → production | Operators + admins |
| **B — Product (later)** | Optional in-app staging (e.g. zip to object storage), validation UX, background job to push to Arweave / refresh metadata URIs — without doing full CM deploy in a single browser request | Engineering |

Phase A minimizes moving parts during launch; Phase B improves repeatability for partners without changing Phase A semantics.

---

## Phase A — Step by step

### 1. Pre-render outputs (your generative pipeline)

From trait layers and bases, produce **one image + one JSON per index**:

- Pairing: `0.png` + `0.json`, `1.png` + `1.json`, … through `1999` for a 2000 supply.
- Each JSON must include Metaplex-friendly fields (`name`, `symbol`, `description`, `image`, `attributes`, etc.). Run Sugar’s validator before upload.

Naming does not have to be `0…N` forever if Sugar is configured accordingly, but **the default Sugar layout is numeric pairs** — matching that avoids configuration mistakes. See [Sugar — preparing your files](https://developers.metaplex.com/candy-machine/sugar/getting-started#preparing-your-files).

### 2. Install and configure Sugar

- **Docs:** [Metaplex Sugar](https://developers.metaplex.com/candy-machine/sugar)  
- **Repo:** [metaplex-foundation/sugar](https://github.com/metaplex-foundation/sugar)

Use a **dedicated deployer keypair** and an RPC that can handle many transactions (Helius, Triton, etc.). Set Solana CLI `config` to the same cluster you intend to deploy (devnet first).

### 3. Validate, upload, deploy

Typical flow (exact flags depend on Sugar version):

1. **`sugar validate`** — fixes structural issues before paying for storage/upload.
2. **`sugar upload`** — uploads media + metadata and builds the upload cache (Arweave / bundler is configured in Sugar; follow current Sugar docs for storage provider choice).
3. **`sugar deploy`** (or **`sugar launch`** for guided setup) — creates the Candy Machine on-chain.

Keep the **Sugar cache file** and project directory in version control excluded backup (or secure internal storage): it is needed for verifies, reveals, or re-runs.

### 4. Record provenance in Owl Center (admin UI)

After upload you will have identifiable storage locations (URLs, txn IDs, or manifest paths depending on tooling). Enter them where the codebase expects **paths or URLs**:

- **Admin:** `/admin/owl-center/collections/{launch_id}/assets`  
  (Gen2 shortcut: `/admin/owl-center/gen2/assets`)

Fields (see `CollectionAssetsAdminClient`):

- **Assets storage path / URL** — canonical location of uploaded images or combined asset drop.
- **Metadata storage path / URL** — canonical location of uploaded JSON set or manifest.
- **Total images / Total metadata / Expected supply** — for Gen2 the product expects **2000 / 2000 / 2000** before calling the collection “ready” for CM work.
- **Metadata upload status** — move through `UPLOADED_TO_ARWEAVE` (or `UPLOADED_TO_IPFS` if you ever use IPFS) toward `READY_FOR_CANDY_MACHINE` when the manual checklist is complete.
- Complete the **validation checklist**, then use **Mark ready for Candy Machine** (requires full checklist).

### 5. Wire Candy Machine + collection mint

In **Owl Center admin** (`/admin/owl-center`) set:

- `candy_machine_id` (+ `collection_mint`) for production.
- `devnet_candy_machine_id` (+ `devnet_collection_mint`) for devnet proof mints.

The site resolves these via `lib/solana/network.ts` + env overrides documented in `.env.example`. Mint confirmation (`/api/owl-center/gen2/confirm-mint`) checks that txs reference the configured CM.

### 6. Verification

- **Devnet:** use the embedded devnet checklist / mint UI as configured.
- **Mainnet:** mint a small quantity, verify metadata resolves (image + traits) via wallet and explorers.

---

## Gen2 candy guard groups (mainnet)

The site minter (`lib/solana/gen2-guards.ts`) resolves a **guard group per mint phase** and builds
`mintArgs` automatically from the on-chain candy guard. Configure the candy guard (e.g. via
`sugar guard add` / config.json `guards`) with these group labels (labels are limited to 6 chars;
override the mapping with `NEXT_PUBLIC_GEN2_GUARD_GROUP_*` if you choose different labels):

| Group | Phase(s) | Recommended guards |
|-------|----------|--------------------|
| `gen1` | AIRDROP — free Gen2 mint for Gen1 holders, **1 per Gen1 NFT held** (Gen1 is the already-minted collection; holders mint Gen2 themselves on-site, nothing is air-dropped by the team) | `allowList` (merkle root of the Gen1 holder **snapshot** — see below), `mintLimit` (unique `id`; flat per-wallet cap ≥ the largest Gen1 holding in the snapshot — caps direct on-chain abuse since guards cannot vary limits per wallet; the exact per-NFT count is enforced server-side), `botTax`, `startDate`/`endDate`. No payment guard. The phase is **optional per holder** — whatever they leave unminted simply stays in the remaining supply for later phases; later phases never wait for the GEN1 pool to mint out. |
| `pre` | PRESALE + PRESALE_OVERAGE (free redemption, already paid in USDC) | `allowList` (merkle root of paid presale wallets), `botTax`, `startDate`/`endDate`. No payment guard. |
| `wl` | WHITELIST (paid in SOL) | `allowList` (merkle root of WL wallets), `solPayment` at WL price to the treasury, `botTax`. |
| `pub` | PUBLIC (paid in SOL) | `solPayment` at public price to the treasury, `mintLimit` (per-wallet cap, unique `id`), `botTax`. |

**Gen1 holder snapshot (AIRDROP allowlist).** The `gen1` group needs a frozen holder snapshot
(`gen2_gen1_airdrop_snapshot`, migration 142). Announce the snapshot time (holders should delist —
NFTs in marketplace escrow snapshot the escrow wallet), then as admin:

```
POST /api/admin/owl-center/gen2/gen1-snapshot   { "mode": "chain", "replace": true }   # Helius DAS scan of current holders
POST /api/admin/owl-center/gen2/gen1-snapshot   { "mode": "csv", "text": "...", "replace": false }   # manual corrections only (wallet or wallet,count lines)
GET  /api/admin/owl-center/gen2/gen1-snapshot   → { wallets, total_nfts, last_updated_at }
```

The snapshot is **final**: wallets that buy Gen1 after the snapshot are not added (no late-buyer
additions). CSV mode exists for fixing scan mistakes (e.g. a known escrow wallet), not for new entries.

**Merkle roots come from the app, not from hand-rolled lists.** After the snapshot + WL / presale
tables are final, fetch the canonical roots (no `wallet` param = operator mode):

```
GET /api/owl-center/gen2/wl-proof?phase=AIRDROP     → { merkle_root, count }   # gen2_gen1_airdrop_snapshot
GET /api/owl-center/gen2/wl-proof?phase=WHITELIST   → { merkle_root, count }   # owl_center_wl_allocations (allowed_mints > 0)
GET /api/owl-center/gen2/wl-proof?phase=PRESALE     → { merkle_root, count }   # gen2_presale_balances (purchased_mints > 0)
```

Paste each base58 `merkle_root` into the matching group's `allowList.merkleRoot` in the guard config.
At mint time the client fetches the per-wallet proof from the same endpoint and sends the allowList
`route` instruction before `mintV2` — so the **DB lists must be frozen** (no WL adds, no presale refunds)
once the roots are on-chain. If a list must change, re-fetch the root and `sugar guard update`.

Guards the in-app minter supports: `solPayment`, `freezeSolPayment`, `mintLimit`, `allowList`,
plus no-arg guards (`botTax`, `startDate`, `endDate`, `redeemedAmount`, `addressGate`, `programGate`).
Anything else (`thirdPartySigner`, token payments/gates, `gatekeeper`, `allocation`, …) fails fast
with a clear error before any wallet signature.

---

## Mainnet launch day checklist (Gen2)

Rehearse the full list on devnet first (same steps with `NEXT_PUBLIC_GEN2_USE_DEVNET_MINT=true`,
devnet CM + `NEXT_PUBLIC_SOLANA_CLUSTER=devnet`).

**T-minus days — assets + CM**

1. Collection ready in Owl Center admin: 2000/2000/2000, checklist complete, `READY_FOR_CANDY_MACHINE`.
2. `sugar validate` → `sugar upload` → `sugar deploy` on **mainnet** with the dedicated deployer keypair and a paid RPC. Back up the Sugar cache file.
3. Configure candy guard groups (`gen1` / `pre` / `wl` / `pub`) per the table above. Treasury destination for `solPayment` = launch `treasury_wallet`.
4. Take the Gen1 holder snapshot at the announced time (`POST /api/admin/owl-center/gen2/gen1-snapshot` with `{ "mode": "chain", "replace": true }`; apply migration 142 first), freeze WL + presale tables, then fetch the three merkle roots from `/api/owl-center/gen2/wl-proof` (prod deployment or a checkout pointed at the prod DB) and set them in the guard config (`sugar guard add` / `update`).
5. Verify on-chain config: `sugar guard show` — group labels, prices (lamports), merkle roots, dates.

**T-minus hours — site flip (Vercel Production env)**

6. Set/confirm production env (full list in `.env.example`, "Gen2 mainnet launch" block):
   - `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`, `NEXT_PUBLIC_GEN2_USE_DEVNET_MINT` **unset**
   - `NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID` + `NEXT_PUBLIC_GEN2_COLLECTION_MINT` (and/or fill `candy_machine_id` + `collection_mint` in `/admin/owl-center` — DB wins)
   - `NEXT_PUBLIC_SOLANA_RPC_URL` (paid mainnet RPC) + `SOLANA_RPC_URL` (server verify)
   - `NEXT_PUBLIC_GEN2_GUARD_GROUP_*` only if your labels differ from the defaults
7. Keep `OWL_CENTER_MINT_DISABLED=true` (kill switch) until go-time; redeploy.
8. Set `phase_schedule` + active phase in `/admin/owl-center`; confirm `/api/owl-center/gen2/mint-check` shows `mint_operational=false` only because of the kill switch.

**Go-time**

9. Remove `OWL_CENTER_MINT_DISABLED`, redeploy, admin-unpause.
10. Team smoke mint (1 NFT) on the active phase from a mobile wallet (Phantom **and** Solflare in-app browser — ~75% of minters are mobile): wallet shows correct SOL price, tx confirms, metadata + image render, `/api/owl-center/gen2/confirm-mint` recorded it (minted counter increments).
11. Open each subsequent phase by flipping `active_phase` in admin **and** confirming the matching guard group dates on-chain.

**Monitoring / abort**

12. Watch RPC dashboard (rate limits), `owl_center_mint_events`, and bot-tax revenue on the treasury.
13. Abort path: set `OWL_CENTER_MINT_DISABLED=true` (site) and `sugar guard update` with a future `startDate` or `sugar pause` (on-chain). The site kill switch alone does **not** stop direct on-chain mints — guards are the real protection.

---

## Ecosystem note: gateways and AO “NASA”

Decentralized **gateway** staking programs (e.g. AO availability staking announcements) relate to **how** Arweave data is **served** over time. They do **not** replace Sugar/upload steps for creators. Canonical on-chain NFT `uri`s should still point at **permanent** storage locations; your gateway strategy for *read reliability* stays separate from upload.

---

## Phase B — In-app uploads (implemented)

Admins stage a **Sugar export ZIP** on `/admin/owl-center/collections/{launch_id}/assets`:

1. **Stage Sugar ZIP** — uploads to private Supabase Storage (`owl-center-asset-staging`), runs validation, auto-fills asset package counts + checklist.
2. **Push to Arweave** — requires `IRYS_PRIVATE_KEY` (funded Solana wallet). Uploads PNGs then rewritten JSONs via Irys in batches (`OWL_CENTER_ASSET_UPLOAD_BATCH`, cron every 2 min).
3. **Mark ready for Candy Machine** — same checklist gate as Phase A; then `sugar deploy` with on-chain URIs from Arweave.

Migration: `143_owl_center_asset_upload_jobs.sql`. Cron: `/api/cron/owl-center-asset-upload`.

Until Irys env is set, Phase B still handles **staging + validate**; Arweave push is manual via admin button or cron after env is configured.

---

## Quick links

| Resource | URL |
|----------|-----|
| Sugar overview | https://developers.metaplex.com/candy-machine/sugar |
| Candy Machine (concept) | https://developers.metaplex.com/candy-machine |
| Sugar GitHub | https://github.com/metaplex-foundation/sugar |
