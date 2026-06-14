# Papers — Sugar deploy (Phase B)

Prepared from Owl Center upload job `3b748c2b-18fb-4064-b03e-f6c864cc6c9d`.

- Launch: `c9d9e021-2ac8-473c-b1a6-a2ca04e319b7` · slug `sub-feae56d904034b21a2edf92e301c5eae`
- Staged file: `papers--batch-5.zip`
- Arweave links pre-filled in `cache.json` (skip `sugar upload` for numbered items).

## Deploy

1. Edit `config.json` if `creators[0].address` should be your deployer (not creator wallet).
2. Install [Sugar CLI](https://developers.metaplex.com/candy-machine/sugar).
3. `solana config set --url` your mainnet RPC; fund deployer keypair.
4. From repo root (mainnet — config already includes default guards):

```bash
npm run sugar:deploy -- collections/papers
```

**Already deployed without a guard?** Run only:

```bash
cd collections/papers
node --env-file=../../.env.local ../../scripts/configure-solana-mainnet-from-env.mjs
sugar guard add
sugar guard show
```

5. Paste **candy_machine_id** + **collection_mint** in Owl Center admin → Marketplace readiness.
6. Mint test: `/owl-center/collection/sub-feae56d904034b21a2edf92e301c5eae`

Regenerate: `npm run prepare:sugar-deploy -- --launch-id=c9d9e021-2ac8-473c-b1a6-a2ca04e319b7`
