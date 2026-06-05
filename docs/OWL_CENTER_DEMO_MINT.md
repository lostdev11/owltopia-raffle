# Owl Center demo mint (pre-rendered art → mint → Magic Eden)

Real end-to-end demo using **5 pre-rendered owl PNGs** in `collections/owl-center-demo/`. Proves Sugar upload, Owl Center mint, sell-out automation, and Magic Eden / Tensor listing.

## What’s in the repo

| Path | Purpose |
|------|---------|
| `collections/owl-center-demo/assets/` | `0.png`–`4.png` + Metaplex JSON + `collection.png` |
| `collections/owl-center-demo/config.json` | Sugar config (edit creator wallet) |
| `scripts/prepare-owl-center-demo-collection.mjs` | Regenerates assets from `public/images/gen2-carousel/` |

Regenerate art anytime:

```bash
npm run prepare:owl-center-demo
```

## Full flow

### 1. Migrations

Apply `137_owl_center_public_simple_mint.sql` and `138_owl_center_sellout_hash_list.sql`.

### 2. Sugar deploy (mainnet for real ME listing)

```bash
cd collections/owl-center-demo
# Edit config.json — set creators[0].address to deployer wallet
sugar validate
sugar upload    # Arweave via bundlr
sugar deploy    # note candy_machine_id + collection_mint
```

### 3. Owl Center admin

1. `/admin/owl-center/demo` → **Create demo launch** (supply **5**, network **mainnet**)
2. Paste CM + collection mint → **Save**
3. Optional: `/admin/owl-center/collections/{id}/assets` — set paths, mark metadata uploaded

### 4. Mint

`/owl-center/collection/demo` — connect wallet, mint all 5.

Each confirm stores `minted_nft_mints` for the hash list.

### 5. Sell-out (automatic)

When the **last** mint confirms:

- Launch → `SOLD_OUT`
- **Hash list** generated from on-chain mint addresses
- ME + Tensor URLs prefilled (from collection mint)
- Status → `READY_FOR_INDEXING`
- Download: `/api/owl-center/collections/demo/hash-list`

Mint page shows **Sold out** panel with download + ME link.

### 6. Magic Eden (manual submit — required by ME)

Magic Eden does not expose a public “auto-upload hash list” API for all creators. After sell-out:

1. Download hash list (mint page or admin)
2. [Magic Eden Creators](https://magiceden.io/creators) → your collection → **submit hash list**
3. Wait for indexing

### 7. Tensor

Verify collection mint on [Tensor Create](https://tensor.trade/create).

### 8. Activate trading on Owl Center

Admin → Marketplace panel:

- **Mark ME listed** / **Mark Tensor listed** (after they index)
- **Activate trading links**
- **Confirm TRADING_ACTIVE**

Public page shows **Magic Eden** and **Tensor** trade buttons.

## Devnet smoke test

Use `mint_network: devnet` in admin and devnet CM fields. Sell-out prep still runs; ME mainnet listing does not apply on devnet.

## Gen3 note

This demo uses **pre-rendered** art (same model as Gen2). Gen3 will add the in-app trait generator; this pipeline stays the same after generation.
