# Prize escrow: testing → production → deploy

Follow these steps to finish devnet testing, prepare for production, and ship the latest updates.

---

## Phase 1: Complete devnet testing

Do this with your app running **locally** (`npm run dev`) and wallet + RPC on **devnet**.

### 1.1 Prerequisites check

- [ ] `.env.local` has devnet RPC:
  - `SOLANA_RPC_URL` = Helius devnet URL
  - `NEXT_PUBLIC_SOLANA_RPC_URL` = same
- [ ] `.env.local` has `PRIZE_ESCROW_SECRET_KEY` (devnet escrow keypair; JSON array or base58).
- [ ] Escrow wallet is funded with devnet SOL (e.g. [faucet.solana.com](https://faucet.solana.com)).
- [ ] Wallet (Phantom etc.) is set to **Devnet**.
- [ ] You have a **devnet NFT** and its mint address for testing.
- [ ] Migration `034_add_prize_escrow_fields.sql` is applied (Supabase).

### 1.2 Quick API check

With dev server running:

```bash
npm run check:prize-escrow
```

- [ ] Output shows “OK – Prize escrow is configured” and the escrow address.

### 1.3 Full flow (detailed checklist)

Use **[ESCROW_DEVNET_TESTING.md](./ESCROW_DEVNET_TESTING.md)** and complete every section:

- [ ] **§1 Config API** – GET `/api/config/prize-escrow` returns 200 + address.
- [ ] **§2 Create NFT raffle** – New NFT raffle has `is_active: false`, redirect to detail.
- [ ] **§3 Deposit & verify** – “Transfer NFT to escrow” → “Verify deposit” → `prize_deposited_at` set, `is_active: true`.
- [ ] **§4 Verify-deposit edge cases** – Non-NFT, NFT not in escrow, already verified (as in doc).
- [ ] **§5 Settlement** – Select winner → NFT auto-transfers to winner, `nft_transfer_transaction` set.
- [ ] **§6 No escrow key** – With escrow key unset, draw still runs; no crash.

When all boxes in Phase 1 are done, escrow is **tested and ready** to enable for production.

---

## Phase 2: Production readiness

### 2.1 Create production escrow wallet (mainnet)

- [ ] Generate a **new** keypair used only for **mainnet** prize escrow (e.g. Phantom: new account → export private key, or `solana-keygen new` on mainnet).
- [ ] Fund it with a small amount of SOL on **mainnet** (for transfer fees when sending NFTs to winners).
- [ ] Export the secret as JSON array (recommended) or base58. You will use this **only** in Vercel (and local production builds if you run them), never in git.

### 2.2 Set production RPC (mainnet)

- [ ] In Helius (or your provider), get your **mainnet** RPC URL (e.g. `https://mainnet.helius-rpc.com/?api-key=...`).
- [ ] Keep this for Vercel env; do **not** use devnet URLs in production.

### 2.3 Configure Vercel environment variables

In your Vercel project → **Settings → Environment Variables**, add (for **Production**):

| Variable | Value | Notes |
|----------|--------|--------|
| `SOLANA_RPC_URL` | Your **mainnet** Helius RPC URL | Server-side |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Same mainnet RPC URL | Client wallet connection |
| `PRIZE_ESCROW_SECRET_KEY` | **Production** escrow key (JSON array or base58) | Server-only; mainnet keypair |

- [ ] All three are set for **Production**.
- [ ] If you use Preview deployments for production-like tests, you can add the same vars to **Preview** or use a separate mainnet key for preview.

Do **not** put devnet RPC or devnet escrow key in Production env.

### 2.4 Other production checks

- [ ] Supabase (or your DB) has migration `034_add_prize_escrow_fields.sql` applied on the **production** database.
- [ ] Any other env vars your app needs (Supabase URL/key, auth, etc.) are already set in Vercel Production.

---

## Phase 3: Deploy latest updates

### 3.1 Commit and push

- [ ] All escrow/testing changes are committed (docs, scripts, and any code).
- [ ] Do **not** commit `.env.local` or any file containing `PRIZE_ESCROW_SECRET_KEY` or API keys.
- [ ] Push to the branch you use for production (e.g. `main`):

  ```bash
  git add .
  git status   # confirm no .env or secrets
  git commit -m "Prize escrow: devnet tested, docs and production runbook"
  git push origin main
  ```

### 3.2 Deploy on Vercel

- [ ] Trigger a production deploy (e.g. Vercel auto-deploys on push to `main`, or use **Deployments → Redeploy**).
- [ ] After deploy, confirm env vars are present: Vercel project → Settings → Environment Variables (no need to expose values; just confirm they exist for Production).

### 3.3 Smoke check in production

- [ ] Open your production site and, if possible, call **GET** `/api/config/prize-escrow` (e.g. `https://your-domain.com/api/config/prize-escrow`). You should get `200` and `{ "address": "<mainnet_escrow_pubkey>" }`. If you get 503, double-check `PRIZE_ESCROW_SECRET_KEY` is set for Production and redeploy if you changed it.
- [ ] Create a test NFT raffle on **mainnet** (or skip if you prefer not to touch production data), then go through: deposit NFT to escrow → verify deposit → (optionally) run winner selection and confirm NFT transfer. If any step fails, check RPC and escrow key and logs.

---

## Summary

| Phase | What you do |
|-------|-------------|
| **1. Testing** | Run locally on devnet; complete [ESCROW_DEVNET_TESTING.md](./ESCROW_DEVNET_TESTING.md); ensure all checklist items pass. |
| **2. Production** | Create mainnet escrow wallet; set mainnet RPC + production `PRIZE_ESCROW_SECRET_KEY` in Vercel Production; confirm DB migration. |
| **3. Deploy** | Commit (no secrets), push, deploy on Vercel; smoke-check `/api/config/prize-escrow` and optionally one full NFT raffle flow on mainnet. |

After Phase 3, the latest updates are live and escrow is ready for production use.
