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

## Ecosystem note: gateways and AO “NASA”

Decentralized **gateway** staking programs (e.g. AO availability staking announcements) relate to **how** Arweave data is **served** over time. They do **not** replace Sugar/upload steps for creators. Canonical on-chain NFT `uri`s should still point at **permanent** storage locations; your gateway strategy for *read reliability* stays separate from upload.

---

## Phase B — In-app uploads (planned shape)

Goal: admins (later partners) can **stage** assets in the dashboard; a **server-side job** (not a single long browser request) validates pairs, pushes to Arweave-compatible storage (e.g. via Irys), and updates Owl Center asset package rows. Candy Machine deployment may remain CLI or migrate to scripted Umi later.

Until Phase B lands, **`/api/upload/image` remains for small admin-only images** (e.g. raffle fallbacks), not bulk collection packages.

---

## Quick links

| Resource | URL |
|----------|-----|
| Sugar overview | https://developers.metaplex.com/candy-machine/sugar |
| Candy Machine (concept) | https://developers.metaplex.com/candy-machine |
| Sugar GitHub | https://github.com/metaplex-foundation/sugar |
