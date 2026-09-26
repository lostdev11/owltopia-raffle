# Packs server RPC audit (Helius)

Production uses **`SOLANA_RPC_URL`** / **`NEXT_PUBLIC_SOLANA_RPC_URL`** (Helius) via `lib/solana-rpc-url.ts` → `getSolanaConnection()` / `getSolanaReadConnection()`. No pack open path should hit the public `api.mainnet-beta.solana.com` default when those env vars are set.

## Pack open hot path

| Step | Module | Connection | Notes |
|------|--------|------------|--------|
| Payment verify | `lib/packs/verify-payment.ts` | **Read** (`getSolanaReadConnection`) | Single `getTransaction` with retry; not indexed → retryable |
| Switchboard VRF | `lib/raffles/draw/vrf-switchboard.ts` | **Primary** (`getSolanaConnection`) | Same Helius URL; wrapped in pack retry on transient RPC |
| Vault SOL/OWL/SPL payout | `lib/packs/vault.ts` | Primary send + read for ATA/mint scans | Replaced tight `confirmTransaction` with 1.5s status polling + retry |
| Core / cNFT payout | `lib/solana/payout-nft-from-keypair.ts` | `resolveServerSolanaRpcUrl()` | Same Helius endpoint as primary |
| Admin vault balances | `lib/packs/vault.ts` | **Read** | `getBalance` / `getAccount` only |

## Read URL split (optional)

Set **`SOLANA_RPC_READ_URL`** to a second Helius API key for:

- Payment `getTransaction` (verify-payment)
- Vault ATA / mint program resolution (`resolveTokenProgramForMint`)
- On-chain payout recovery checks (`lib/packs/payout-verify.ts`)
- Admin vault balance reads

Writes (sendRawTransaction, VRF commits) stay on **`SOLANA_RPC_URL`**.

## Call volume reductions

- Payout confirm: poll `getSignatureStatuses` / `getTransaction` every **1.5s** instead of web3.js default confirm loop.
- Payment verify: one archival fetch per attempt (with backoff), not a failed→`failed` row on 429.
- Resume: committed `open_seed` + `category` skips re-verify, re-VRF, and re-roll; payout only.
