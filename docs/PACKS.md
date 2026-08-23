# Owltopia Packs Ripping

Product utility: buy a pack with SOL, instantly rip it, always win a prize from a pre-funded vault.

## Pack opening video

After payment confirms **and** `/api/packs/open` returns the real prize:

1. User pays pack price → tx confirms (on-page **pack hovering** clip keeps looping)
2. Server assigns the prize (NFT / SOL / $OWL) — VRF reveal may take a few seconds when enabled
3. Fullscreen hovering clip + **Open pack**
4. User taps Open pack → **pack opening** plays once (`/Animations/Pack opening.mp4`)
5. Clip ends on white → CSS white overlay → video removed → white fades → real prize reveal + subtle confetti

Assets (do not rename):

- `/Animations/Pack hover.webm` (transparent, desktop) + `/Animations/Pack hover.webp` (transparent, iOS/WebKit)
- `/Animations/Pack opening.mp4` — one-shot rip → white portal

Config: `lib/packs/animations.ts`. Dev playground (local only): `/dev/pack-opening`. **Admin preview** (production): Admin → Packs → **Preview pack opening**.

The `/packs` page is a single-composition hero (OWL PACKS brand, pack visual, one CTA). Odds, ticket credits, recent opens, and prize tiers live below the fold.

## Public landing, admin unpause

`/packs` and Community nav are **public**. Buying stays off until a full admin turns packs on:

- Vault row defaults to `paused = true` (migration 212)
- Create/open APIs reject purchases while paused (and auto-pause if NFT inventory is too low)
- Go live for buyers: Admin → Packs → **Turn packs on** (needs vault key + min NFT inventory)
- Hide the page again: `PACKS_PUBLIC=false` and `NEXT_PUBLIC_PACKS_PUBLIC=false`, then redeploy

## Locked MVP decisions

| Item | Value |
|------|--------|
| Pack price | **0.1 SOL** |
| Outcome | Every pack wins |
| Categories | **60% $OWL · 20% SOL · 20% NFT** |
| OWL scale | **10 → 50** (10 OWL = 0.1 SOL at default rate) |
| SOL scale | 0.02 → 0.08 SOL (sized for 0.1 SOL pack + 10–50 OWL) |
| NFT fair value | 0.05+ SOL (admin-tagged, up to 50 SOL); **higher FP = rarer** |
| RTP target | **80%** (EV ≈ 0.08 SOL / open) |
| OWL win UX | “You have won N free tickets on raffle site” |
| Ticket mapping | Default **1 OWL → 1 free raffle ticket credit** |
| UX | Instant rip (`/packs`) |
| Odds UI | ME-style **percentages** (category + tier + per-NFT) |
| Randomness | Switchboard VRF when `PACK_VRF_ENABLED=true` (`owltopia-pack-open-v2-vrf`); else local commit–reveal (`v1`) |

## Jackpot

Each **0.1 SOL** pack contributes **0.02 SOL** to a visible accumulating jackpot pool (~**0.2%** win chance per open by default). On a jackpot hit, the buyer receives the **full pool** in SOL and the pool resets to zero. Regular OWL/SOL/NFT prizes apply when the jackpot roll misses.

Apply migration **229** (`packs_jackpot`) alongside prior pack migrations.

## House edge

Guaranteed win ≠ profitable EV. Prize **values** are weighted so expected payout ≈ 80% of pack price. Jackpots (SOL / OWL / premium NFTs) are funded by common low-tier wins.

## Ops

1. Grind an Owl-branded vault wallet (Solana base58 cannot use `O`/`l`, so vanity uses `owL…`):
   `npm run packs:grind-vault` → writes `.local/packs-vault-keypair.txt` (gitignored).
2. Set `PACKS_VAULT_SECRET_KEY` (server) and `NEXT_PUBLIC_PACKS_VAULT_WALLET` from that file (Vercel + `.env.local`).
3. Fund the vault with SOL, OWL, and NFTs. **All pack purchase SOL goes to this wallet**; prize payouts leave from it (house edge stays as residual balance).
4. Admin → Packs: load wallet NFTs, set floors (0.05+ SOL; grails above 0.5 are allowed), **Deposit & add**. SPL, Metaplex Core, and compressed NFTs are supported; pNFT and frozen/nested assets are not. Aim for ~30 NFTs at launch.
5. Apply migration **227** (`packs_vrf_and_nft_snapshot`).
6. Optional fairness: set `PACK_VRF_ENABLED=true` (needs `FUNDS_ESCROW_SECRET_KEY` or `PRIZE_ESCROW_SECRET_KEY` for Switchboard fees — same as raffle VRF).
7. Run `npm run packs:ev-simulator` before going live; set `owl_sol_price` until EV ≈ 0.08 SOL. Use Admin → **Launch checklist**.
8. Admin → Packs → **Turn packs on** when the vault is funded.
9. Opens auto-pause when NFT inventory cannot cover the NFT category (solvency guard). Only a full admin can turn them back on.

## Fairness

### Algo `owltopia-pack-open-v2-vrf` (recommended)

1. Payment verified → Switchboard commit + reveal on-chain.
2. `open_seed` = VRF 32-byte hex; store `open_commit_hash = SHA256(seed)` plus VRF tx fields.
3. Category = weighted pick from seed.
4. OWL/SOL: weighted tier pick. NFT: inverse-FP weighted pick from live inventory snapshot (`nft_pool_snapshot`).
5. Public verify at `/packs/verify/[id]` (seed, commit, VRF Solscan links, NFT snapshot recompute).

### Algo `owltopia-pack-open-v1` (fallback when VRF off)

1. Server generates `open_seed` and stores `open_commit_hash = SHA256(seed)`.
2. Same category / tier / per-NFT math as v2.
3. Public verify at `/packs/verify/[id]`.

## Legal / ToS posture

Chance-based paid entertainment. Before public launch: geo restrictions, 18+ copy, and utility framing vs gambling wording are an ops/legal decision. Code surfaces odds disclosure and RTP target; it does not replace counsel review.
