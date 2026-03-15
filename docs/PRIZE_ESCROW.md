# Prize escrow (automatic NFT transfer to winner)

When an NFT raffle uses the **prize escrow**, the creator sends the NFT to a platform-held wallet at creation time. At settlement, the platform automatically transfers that NFT to the winner—no manual “send to winner” step.

## Setup

1. **Run the migration**  
   Apply `034_add_prize_escrow_fields.sql` so `raffles.prize_deposited_at` exists.

2. **Create a dedicated escrow wallet**  
   Generate a new Solana keypair used only for holding NFT prizes (e.g. with `solana-keygen new` or Phantom: create account → export private key).

3. **Configure the server**  
   Set the secret key in env (server-only, never expose to the client):

   - **Option A – JSON array (recommended)**  
     Export the keypair as a JSON array of 64 numbers (e.g. from Phantom or Solana CLI) and set:
     ```bash
     PRIZE_ESCROW_SECRET_KEY=[1,2,3,...,64]
     ```

   - **Option B – Base58**  
     If you have the secret key as a base58 string:
     ```bash
     PRIZE_ESCROW_SECRET_KEY=yourBase58SecretKey
     ```

   Do **not** commit this value. Use your hosting provider’s env (e.g. Vercel) or a secrets manager.

4. **RPC**  
   Server-side transfer uses `SOLANA_RPC_URL` or `NEXT_PUBLIC_SOLANA_RPC_URL`. Prefer a private RPC (Helius, QuickNode, etc.) for reliability.

**Devnet:** For testing, set both RPC vars to `https://api.devnet.solana.com` (or your devnet RPC), use a devnet-only escrow keypair, and fund it with devnet SOL. See [ESCROW_DEVNET_TESTING.md](./ESCROW_DEVNET_TESTING.md) for a full devnet checklist.

## Flow

1. **Create NFT raffle**  
   Creator creates the raffle with NFT details (mint, etc.) as today.

2. **Deposit prize**  
   Creator sends the NFT to the **prize escrow address**. The escrow address is returned by:
   - **GET /api/config/prize-escrow** → `{ "address": "<pubkey>" }`  
   If prize escrow is not configured, this returns 503.

3. **Verify deposit (optional)**  
   - **POST /api/raffles/[id]/verify-prize-deposit**  
   Checks that the escrow holds the raffle’s NFT mint and sets `raffles.prize_deposited_at`.  
   Useful so the UI can show “Prize deposited” and optionally gate “Go live” on verified deposit.

4. **Settlement**  
   When a winner is selected (cron or admin “Select winner”):
   - Winner is chosen and stored as today.
   - For NFT raffles with `nft_mint_address` and no `nft_transfer_transaction`, the server **automatically** sends the NFT from the escrow to the winner’s wallet and stores the transaction signature on the raffle.

   No manual “transfer NFT to winner” or “record signature” step is required.

## Return prize to creator (admin-only)

In defined cases the platform can send the NFT **back from escrow to the original creator** instead of to a winner. This is **admin-only** and **reason-gated** to avoid abuse.

**Allowed reasons:**

| Reason | When to use |
|--------|------------------|
| `cancelled` | Raffle was cancelled before draw; no winner. |
| `wrong_nft` | Creator deposited the wrong mint by mistake (before draw). |
| `dispute` | Dispute resolution (e.g. support ticket) — return to creator after review. |
| `platform_error` | Bug or platform mistake; returning prize to creator. |

**Rules:**

- Return is only allowed while the NFT is **still in escrow** (no winner has been selected, or winner was selected but automatic transfer to winner has not run yet — i.e. `nft_transfer_transaction` is null).
- Once the NFT has been sent to the winner, it cannot be “returned” via this flow (that would be a separate winner→creator agreement).
- Each raffle can only be returned once (`prize_returned_at` is set after a successful return).

**API:** `POST /api/raffles/[id]/return-prize-to-creator`  
- **Auth:** Full admin session required.  
- **Body:** `{ "reason": "cancelled" | "wrong_nft" | "dispute" | "platform_error" }`  
- **Response:** `{ success, raffleId, reason, transactionSignature, message }`

**Database:** Migration `036_add_prize_return_fields.sql` adds `prize_returned_at`, `prize_return_reason`, and `prize_return_tx` to `raffles`.

## APIs

| Endpoint | Purpose |
|----------|--------|
| **GET /api/config/prize-escrow** | Returns `{ address }` of the prize escrow (for “Send NFT to this address”). |
| **POST /api/raffles/[id]/verify-prize-deposit** | Verifies escrow holds the NFT and sets `prize_deposited_at`. |
| **POST /api/raffles/[id]/return-prize-to-creator** | (Admin) Returns NFT from escrow to creator; body `{ reason }`. |

## Behaviour when escrow is not configured

- **GET /api/config/prize-escrow** returns 503.
- **POST …/verify-prize-deposit** can return 502 if escrow isn’t configured.
- **Automatic transfer** after `selectWinner` is skipped if `PRIZE_ESCROW_SECRET_KEY` is unset; the draw still succeeds and the raffle is marked completed, but `nft_transfer_transaction` stays null (admin can still record a manual transfer via the existing NFT transfer flow if needed).

## Security

- Keep `PRIZE_ESCROW_SECRET_KEY` only on the server and in env/secrets.
- Use a dedicated wallet for the escrow; do not reuse a wallet that holds other funds.
- Ensure RPC and Supabase are locked down as per your existing security practices.
