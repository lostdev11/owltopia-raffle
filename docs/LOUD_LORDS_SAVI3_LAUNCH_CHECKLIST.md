# Loud Lords Revival (Savi3) — Owl Center launch checklist

Ops notes for onboarding **Loud Lords Revival** on Owltopia `public_simple` (Partner Program). Nesting / raffles / OwlSend remain existing products — configure those separately after mint infra is live.

## Collection & mint phases

| Item | Target |
|---|---|
| Total supply | **3,333** or **4,444** (confirm with Savi3) |
| Free Mint Token phase supply | **~1,500** |
| Free Mint Token | SPL mint address from Savi3 (`redeem_token_mint`); burn **1** raw unit per NFT (`redeem_token_amount=1`, `redeem_mode=burn`) |
| Phase price | **0** for Free Mint Token (Candy Guard `tokenBurn` only — no `solPayment`) |
| Remaining supply | Paid / public phases as agreed |
| Large CM deploy | Use Arweave + Sugar ops pipeline ([OWL_CENTER_ARWEAVE_COLLECTION_PIPELINE.md](./OWL_CENTER_ARWEAVE_COLLECTION_PIPELINE.md)) — in-app deploy cap is ~250 |

## Creator mint config (Mint details)

1. Enable allowlist phases; add a phase labeled **Free Mint Token** (preset key `fmt` available).
2. Set phase supply ~1500, price `0`, wallet mint limit as agreed.
3. Paste Savi3’s Free Mint Token **SPL mint** into **Free Mint Token (SPL mint)**. Soft WL wallet paste is **not** required for that phase — holding the token is the ticket.
4. Set Public start so the Free Mint Token window ends when public opens.
5. Deploy / sync Candy Guards so on-chain groups include `tokenBurn` for that phase.

## Platform fee rebate (20% floor-sweep share)

Buyer still pays **100%** of the ~$1 platform mint fee to the Owltopia treasury. Partner share accrues locked and pays out after mint ends (or admin override).

On the launch (admin Launchpad hub → **Fee rebate**, or launch PATCH):

| Field | Value |
|---|---|
| `platform_fee_rebate_bps` | **2000** (20%) |
| `platform_fee_rebate_wallet` | Savi3 / partner payout Solana address |

Server payout (optional auto-release after sellout): set `OWL_PLATFORM_FEE_REBATE_PAYOUT_SECRET_KEY` to a funded key that can send SOL from the rebate pool (typically treasury or a dedicated hot wallet). If unset, rows become `releasable` and admin releases manually.

Ledger table: `owl_center_platform_fee_rebates` (`locked` → `releasable` → `released` / `forfeited`). **No public status UI.**

## Partner Program extras (no code gaps)

- Nesting / free staking — existing product onboarding
- Raffles + token — existing raffle product
- OwlSend 50% discount — commercial ops on Partner Program pricing

## Verify before go-live

- [ ] Guard plan / sync fingerprint includes `tokenBurn` for Free Mint Token phase
- [ ] Eligibility: wallet with ≥1 FMT can mint; wallet without cannot; soft WL not required
- [ ] Confirm-mint accrues rebate rows at 20% of platform fee lamports when rebate config is set
- [ ] After sellout / trading-active: locked rows → releasable; admin Release / Forfeit works
- [ ] Large collection metadata + CM via Arweave/Sugar pipeline complete
