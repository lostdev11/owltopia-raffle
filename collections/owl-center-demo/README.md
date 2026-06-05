# Owl Center demo collection (pre-rendered)

Supply: **5** · Symbol: **OWLDEMO**

Art is copied from `public/images/gen2-carousel/` by `scripts/prepare-owl-center-demo-collection.mjs`.

## Sugar deploy

1. Edit `config.json` — set `creators[0].address` to your deployer wallet.
2. `cd collections/owl-center-demo`
3. `sugar validate`
4. `sugar upload` (Arweave via bundlr)
5. `sugar deploy` — note **candy_machine_id** and **collection_mint**
6. Owl Center admin → `/admin/owl-center/demo` — paste IDs, create launch with supply **5**
7. Mint at `/owl-center/collection/demo` until sold out
8. Sell-out auto-generates hash list for Magic Eden + Tensor

See `docs/OWL_CENTER_DEMO_MINT.md`.
