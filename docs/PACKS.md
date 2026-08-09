# Owltopia Packs Ripping

Product utility: buy a pack with SOL, instantly rip it, always win a prize from a pre-funded vault.

## Pack opening video

After payment confirms on-chain, the client plays the pack-open clip **before** showing the prize:

1. User pays pack price → tx confirms
2. Full-screen video at `/videos/owl-pack-open.mov` (override with `NEXT_PUBLIC_PACK_OPEN_VIDEO_URL`)
3. `/api/packs/open` runs in parallel (roll + payout)
4. When the video ends (or user skips) **and** the open result is ready → prize reveal

Clip is committed at `public/videos/owl-pack-open.mov`. Prefer an H.264 mp4 later for max browser coverage.

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

1. Set `PACKS_VAULT_SECRET_KEY` (server) and fund the vault with SOL, OWL, and NFTs.
2. Admin → Packs: list NFT inventory with fair values in 0.05–0.5 SOL.
3. Run `npx tsx scripts/packs-ev-simulator.ts` before going live; adjust tier weights / `owl_sol_price` until EV ≈ 0.08 SOL.
4. Pause opens when NFT inventory cannot cover the NFT category (solvency guard).

## Fairness

Algo `owltopia-pack-open-v1`:

1. At open, server generates `open_seed` and stores `open_commit_hash = SHA256(seed)`.
2. Category index = `SHA256(seed || ":category:" || weightSum) % weightSum`.
3. Within category, tier/band via `SHA256(seed || ":tier:" || category || ":" || weightSum) % weightSum`.
4. Public verify at `/packs/verify/[id]`.

## Legal / ToS posture

Chance-based paid entertainment. Before public launch: geo restrictions, 18+ copy, and utility framing vs gambling wording are an ops/legal decision. Code surfaces odds disclosure and RTP target; it does not replace counsel review.
