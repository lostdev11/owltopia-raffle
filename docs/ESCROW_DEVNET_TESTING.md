# Prize escrow – devnet testing checklist

Use this checklist to confirm the escrow flow is ready when users create NFT raffles on **devnet**: NFT is transferred to escrow after creation, verified, then automatically sent to the winner at settlement.

## Prerequisites

1. **Devnet RPC**  
   Server (and wallet) must use devnet:
   - In `.env.local` set:
     - `SOLANA_RPC_URL=https://api.devnet.solana.com` (or your devnet RPC)
     - `NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com`
   - Wallet (e.g. Phantom) must be switched to **Devnet**.

2. **Escrow wallet on devnet**  
   - Create a new keypair for devnet only (e.g. `solana-keygen new` while using devnet).
   - Fund it with a little devnet SOL (e.g. from https://faucet.solana.com).
   - Set in `.env.local`:
     - `PRIZE_ESCROW_SECRET_KEY=[1,2,...,64]` (JSON array) or base58 secret key.
   - Do **not** commit this value.

3. **Database**  
   - Migration `034_add_prize_escrow_fields.sql` applied (e.g. `prize_deposited_at` exists on `raffles`).

4. **Test NFT on devnet**  
   - Have an NFT mint on devnet and its mint address (e.g. from Metaplex/Helius devnet mint).

---

## 1. Config API

- [ ] **GET /api/config/prize-escrow**
  - With `PRIZE_ESCROW_SECRET_KEY` set: returns `200` and `{ "address": "<escrow_pubkey>" }`.
  - With env unset: returns `503` and `{ "error": "Prize escrow is not configured" }`.
- Optional: run `node scripts/check-prize-escrow-api.mjs` (with dev server running) to verify.

---

## 2. Create NFT raffle

- [ ] Create a new raffle with **Prize type: NFT** and a valid devnet NFT mint address.
- [ ] After create:
  - Raffle is saved with `is_active: false` and `prize_deposited_at: null`.
  - You are redirected to the raffle detail page.

---

## 3. Deposit & verify (raffle detail)

- [ ] On the raffle detail page you see the **“Prize in escrow required”** card (because `prize_type === 'nft'` and `!prize_deposited_at`).
- [ ] Escrow address is shown and matches the address from GET `/api/config/prize-escrow`.
- [ ] Click **“Transfer NFT to escrow”**:
  - Wallet prompts to sign (create ATA for escrow if needed + transfer 1 NFT).
  - Transaction succeeds on devnet.
  - Page refreshes; the same card may still show until you verify.
- [ ] Click **“Verify deposit”** (or equivalent):
  - **POST /api/raffles/[id]/verify-prize-deposit** is called.
  - Response: `200` and `{ "success": true, "prizeDepositedAt": "..." }`.
  - Raffle updates: `prize_deposited_at` set, `is_active` set to `true`.
- [ ] After refresh, the “Prize in escrow required” card is gone and the raffle is active (entries can open if within start/end time).

---

## 4. Verify-deposit API edge cases

- [ ] **POST .../verify-prize-deposit** for a raffle that is not NFT: returns `400` (“This raffle does not have an NFT prize”).
- [ ] **POST .../verify-prize-deposit** before the NFT is in escrow: returns `400` (“NFT not found in prize escrow...”).
- [ ] **POST .../verify-prize-deposit** after already verified: returns `200` with `alreadyVerified: true`.

---

## 5. Settlement (winner + auto transfer)

- [ ] Create an NFT raffle, deposit and verify as above. Add at least one confirmed entry (or use admin to confirm). Set `end_time` in the past (or use admin “Select winner” for a specific raffle).
- [ ] Trigger winner selection:
  - Admin: **POST /api/raffles/select-winners** with `{ "raffleId": "<id>" }` (and optionally `forceOverride: true` if min tickets / 7-day rule would block).
  - Or wait for cron that calls the same draw logic.
- [ ] After winner is selected:
  - Raffle has `winner_wallet` and `winner_selected_at` set.
  - For NFT raffles, `transferNftPrizeToWinner(raffleId)` runs automatically.
  - Raffle gets `nft_transfer_transaction` set to the transfer signature.
- [ ] On devnet: confirm the winner’s wallet holds the NFT (check explorer or wallet).

---

## 6. Draw logic (no escrow key)

- [ ] With `PRIZE_ESCROW_SECRET_KEY` unset, run select-winners for an ended NFT raffle:
  - Winner is still selected and raffle marked completed.
  - `nft_transfer_transaction` remains null (automatic transfer is skipped).
  - No server crash; behaviour matches docs (admin can record manual transfer if needed).

---

## Quick API check (script)

With the dev server running (`npm run dev`):

```bash
node scripts/check-prize-escrow-api.mjs
```

Optional: set `BASE_URL` (e.g. `http://localhost:3000`) if your app runs elsewhere.

---

## Summary

When all items pass:

- Escrow is ready for **creation flow**: new NFT raffles get `is_active: false` until prize is in escrow.
- Creators **transfer NFT to escrow** on the raffle detail page, then **verify**; `prize_deposited_at` and `is_active` are set.
- At **settlement**, the platform **automatically transfers** the NFT from escrow to the winner and stores the tx signature.

Use this checklist on devnet before relying on escrow in production.
