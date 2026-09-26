# Nesting: platform fee charged but OWL not received

## What the user sees

- Wallet shows a successful transaction (SOL spent).
- Nesting dashboard still shows claimable OWL; NFTs remain nested.

## What the transaction usually is

Claim all is **two steps**:

1. **Wallet:** SOL platform fee → `OWL_PLATFORM_FEE_TREASURY_WALLET` (default `7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY`). On Solscan this is only `System Program: transfer` — **not** an OWL token transfer.
2. **Server:** OWL SPL transfer from the nesting reward treasury → user wallet, then DB ledger update.

If step 1 succeeded and step 2 did not, the user paid the fee but OWL was never sent.

Fee size: `0.001 SOL × (number of lock-eligible nests in that Claim all)` (e.g. 11 nests → `0.011 SOL`).

## On-chain triage (no DB)

```bash
npx tsx scripts/inspect-claim-fee-orphans.ts <WALLET>
```

Flags duplicate claim-sized fee payments. Keep the newest signature for retry; older duplicates may be refundable if no OWL payout exists for that window.

## Supabase triage (Owl Raffle)

**Do not expect the fee tx in `staking_owl_reward_transfers`.** That table tracks **OWL treasury → user** payouts (`status`: `sending` / `sent` / `recorded` / `failed`). The platform fee tx is a **user → fee treasury** SOL transfer and only appears in `staking_platform_fee_payments` **after** a successful claim links it (`action = 'claim'`, `tx_signature`, `position_ids`).

For a fee-only orphan (OWL never sent):

| Check | Expected if payout never started |
| --- | --- |
| `staking_owl_reward_transfers` for fee tx sig `4We2Wk…` | **No row** (correct — no OWL transfer used that signature) |
| `staking_owl_reward_transfers` for wallet, same day | No new `recorded` row after the fee time |
| `staking_platform_fee_payments` where `tx_signature = 4We2Wk…` | Often **missing** until a claim completes and `commitStakingPlatformFeeLinked` runs; if missing, fee is still reusable on-chain (48h recovery) |
| Last successful OWL for wallet | May be **days earlier** (e.g. ~25.86 OWL on 2026-09-24) while **new** claimable accrual remains on nests |

This is **not unstake**: NFTs stay nested; only accrued OWL claim failed after the fee step.

## User recovery (dev dad voice)

1. **Do not approve another platform fee** if they already paid for the same nest count within 48 hours.
2. Open **Nesting → Claim all** again. After deploy with claim-all preview, lock checks run **before** the fee prompt; a paid fee is reused via localStorage or server recovery.
3. If Claim all still fails, read the error:
   - **Treasury / insufficient OWL or SOL** — fund `NESTING_OWL_REWARD_TREASURY_*`, then retry (fee reuse).
   - **Nest lock / Finish opening** — restore on-chain lock, then retry.
   - **Claim already processing (409)** — check `staking_owl_reward_transfers` for stuck `sending` / `sent` rows; reconcile before re-sending OWL.

## Example: Degenmonkeee (2026-09-26)

| Field | Value |
| --- | --- |
| Wallet | `25AHqZAtU2iZo8RXG3KAzrWTPpK319vcpxBJEuEwpdQt` |
| Reported tx | `4We2WkTjPQNBY43LbtiJuLbXdHdtETHkxWQ3tfSCNMBobeMFKLo3wPqVLaYS6t3tRKWXJKpsRmjTTpt6uunFKZtm` |
| On-chain effect | 11-nest platform fee (`0.011 SOL`); no OWL program in tx |
| Prior duplicate fee | `4UWhC5BFy1Y8jKWyhhg97bCF7Rrq4foKvnZVqoUYTMGg18Z7VD5baw5mB3JoGfQ33bfGsTZ6aFxqMhdX1aE9Ex2r` (2026-09-24, also 11 units) — refund candidate after retry succeeds |
| Supabase (2026-09-26 ops) | No `staking_owl_reward_transfers` row for `4We2Wk…`; last recorded OWL payout ~25.86 OWL on **2026-09-24** |

Ops: retry Claim all with fee reuse; if OWL still does not land, check reward treasury balance and transfer guard rows for this wallet.
