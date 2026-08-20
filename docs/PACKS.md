# Owltopia Packs Ripping

Product utility: buy a pack with SOL, instantly rip it, always win a prize from a pre-funded vault.

## Pack opening video

After payment confirms **and** `/api/packs/open` returns the real prize:

1. User pays pack price → tx confirms (on-page **pack hovering** clip keeps looping)
2. Server assigns the prize (NFT / SOL / $OWL)
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
| OWL scale | 5 → 100 |
| SOL scale | 0.05 → 0.5 SOL |
| NFT fair value | 0.05 → 0.5 SOL (admin-tagged) |
| RTP target | **80%** (EV ≈ 0.08 SOL / open) |
| OWL win UX | “You have won N free tickets on raffle site” |
| Ticket mapping | Default **1 OWL → 1 free raffle ticket credit** |
| UX | Instant rip (`/packs`) |

## House edge

Guaranteed win ≠ profitable EV. Prize **values** are weighted so expected payout ≈ 80% of pack price. Jackpots (up to 0.5 SOL / 100 OWL) are funded by common low-tier wins.

## Ops

1. Grind an Owl-branded vault wallet (Solana base58 cannot use `O`/`l`, so vanity uses `owL…`):
   `npm run packs:grind-vault` → writes `.local/packs-vault-keypair.txt` (gitignored).
2. Set `PACKS_VAULT_SECRET_KEY` (server) and `NEXT_PUBLIC_PACKS_VAULT_WALLET` from that file (Vercel + `.env.local`).
3. Fund the vault with SOL, OWL, and NFTs. **All pack purchase SOL goes to this wallet**; prize payouts leave from it (house edge stays as residual balance).
4. Admin → Packs: load wallet NFTs, set floors (0.05–0.5 SOL), **Deposit & add**. SPL, Metaplex Core, and compressed NFTs are supported; pNFT and frozen/nested assets are not.
5. Run `npm run packs:ev-simulator` before going live; adjust tier weights / `owl_sol_price` until EV ≈ 0.08 SOL.
6. Admin → Packs → **Turn packs on** when the vault is funded (this is what opens buying to the public).
7. Opens auto-pause when NFT inventory cannot cover the NFT category (solvency guard). Only a full admin can turn them back on.

## Fairness

Algo `owltopia-pack-open-v1`:

1. At open, server generates `open_seed` and stores `open_commit_hash = SHA256(seed)`.
2. Category index = `SHA256(seed || ":category:" || weightSum) % weightSum`.
3. Within category, tier/band via `SHA256(seed || ":tier:" || category || ":" || weightSum) % weightSum`.
4. Public verify at `/packs/verify/[id]`.

## Legal / ToS posture

Chance-based paid entertainment. Before public launch: geo restrictions, 18+ copy, and utility framing vs gambling wording are an ops/legal decision. Code surfaces odds disclosure and RTP target; it does not replace counsel review.
