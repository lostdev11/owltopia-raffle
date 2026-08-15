# Implementation Plan: Owltopia Coin NFT Art Upgrade

## Overview

Optional, paid art upgrade for **Owltopia Coins** (MPL Core nest NFTs). Holders keep original art if they skip; upgraders pay **0.15 SOL**, receive new “owl holding coin” metadata/art, and earn **+2 $OWL/day** instead of **+1 $OWL/day** while nested.

This is a **new product surface**. The repo has nesting (freeze lock + `owl-nest-365` at 1 OWL/day) and Owl Center fee/metadata patterns, but **no** coin art-upgrade flow today.

## Spec sources

- Discord DM (Gembird → Devdad.sol): “start the upgrade thing, art will be rdy soon”
- Discord `#community-vote` (Gembird, 2024-08-11):
  - ~1,000 owl-holding-coin looks (traits / backgrounds)
  - **Not mandatory** — keep original art allowed
  - Original nest yield: **+1 $OWL/day** → upgraded: **+2 $OWL/day**
  - Upgrade fee: **0.15 SOL**
  - Extra: giveaways / marketing (out of scope for core eng unless specified)

## Current system (facts from codebase)

| Piece | Today |
|-------|--------|
| Collection | `EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB` (+ legacy DAS `9KLam…`) |
| Standard | **MPL Core** + `FreezeDelegate` nest lock |
| Nest perch | `owl-nest-365` — 365-day lock, **1 OWL/day** |
| Accrual | `reward_rate_snapshot` copied at stake time — **pool edits do not bump open nests** |
| Capacity UI | Default **1000** (`NESTING_OWL_NEST_GLOBAL_CAPACITY`) |
| Marketplace card | “Owltopia Coins” often shows **~60** listed supply — clarify vs 1,000 art set |
| Art / URI update for coins | **None** |
| 0.15 SOL product | **None** (Reveal Day uses USD→SOL fee verify — reusable pattern only) |

Key paths: `lib/nesting/*`, `lib/staking/rewards.ts`, `lib/solana/mpl-core-freeze.ts`, `supabase/migrations/076_owl_nesting.sql`, `104_nesting_canonical_owl_nest_365.sql`.

## Product decisions to lock before build

Resolve these with Gembird / ops before Phase 2 coding:

1. **Supply model** — Are there ~60 live coins now, with new art variants prepared for up to 1,000 nest slots? Or is upgrade a 1:1 remint / collection expansion?
2. **One-way vs reversible** — Vote implies opt-in once; recommend **one-way** (no downgrade) unless product wants otherwise.
3. **Upgrade while nested** — Preferred: **allow while frozen** (authority-signed Core update + DB rate bump) so holders do not break 365-day nests. Fallback: require thaw → upgrade → re-nest (worse UX, loses lock continuity).
4. **Yield bump scope** — Recommend: permanent **mint-level** upgraded flag; any future nest of that mint uses **2 OWL/day**. Open positions: settle accrued at old rate through upgrade timestamp, then set `reward_rate_snapshot = 2` (or split ledger) so history stays correct.
5. **Art assignment** — Deterministic per mint (hash → trait set), holder-chosen traits, or admin-assigned? Affects metadata pipeline.
6. **Update authority** — Confirm who can change MPL Core asset URI/name while `FreezeDelegate` is active (collection/update authority vs freeze delegate).
7. **Treasury** — Reuse `OWL_PLATFORM_FEE_TREASURY_WALLET` for the 0.15 SOL fee?
8. **Launch gate** — Ship UI behind feature flag until art pack is uploaded and dry-run on 1–2 assets succeeds.

## Recommended architecture

```
Holder wallet
  → pay 0.15 SOL to platform treasury (memo / structured verify)
  → POST /api/me/nesting/coin-art-upgrade { mint, paymentSig }
Server
  → SIWS session + ownership check (collection allowlist)
  → verify payment (fixed 0.15 SOL ± band)
  → idempotent upgrade ledger row (mint unique)
  → assign / load new metadata URI (Arweave/Irys)
  → MPL Core update (URI ± name/attributes) with update authority
  → if active nest: bump reward_rate_snapshot to 2 (with accrual cutover)
  → return success + new image URI for UI refresh
```

### Data model (new)

`owl_coin_art_upgrades` (name flexible):

- `mint` TEXT PRIMARY KEY (or UNIQUE)
- `wallet_address` TEXT NOT NULL (upgrader at time of upgrade)
- `payment_signature` TEXT NOT NULL UNIQUE
- `fee_lamports` BIGINT NOT NULL
- `old_uri` / `new_uri` TEXT
- `trait_seed` / `metadata_version` (optional)
- `status` (`pending_payment` | `paid` | `metadata_updated` | `failed`)
- `nested_position_id` UUID NULL (if rate bumped)
- `created_at` / `updated_at`

Optional: `owl_coin_art_assets` catalog mapping mint → trait JSON + URI once art is ready.

Do **not** only bump `staking_pools.reward_rate` — that leaves existing nests at 1 forever and would also affect non-upgraded mints if set globally to 2.

### Yield cutover (critical)

For an active `owl-nest-365` position on the upgraded mint:

1. Compute accrued OWL through `upgrade_at` at snapshot rate `1`.
2. Persist cutover (adjustment event or fold into claimed/accrual accounting so nothing double-pays).
3. Set `reward_rate_snapshot = 2`, `updated_at = upgrade_at` (or store `rate_effective_from` if schema is extended).
4. Future accrual uses rate `2` from that timestamp.

For un-nested upgraded mints: on next stake, read upgrade ledger and snapshot **2** instead of pool default **1**.

### On-chain / metadata

- Reuse Owl Center Irys/Arweave upload patterns (`docs/OWL_CENTER_ARWEAVE_COLLECTION_PIPELINE.md`) adapted for **Core** assets (not Token Metadata `updateV1`).
- New helper: `lib/solana/mpl-core-update-uri.ts` (authority signer from env; never expose key client-side).
- Frozen assets: verify update path with freeze plugin present in a **devnet/mainnet dry-run** before public launch.
- Indexers (Helius DAS): expect lag; UI should show new URI from our ledger immediately after success.

### Payment verify

Mirror `lib/owl-center/reveal-day-payment.ts`:

- Fixed **0.15 SOL** = `150_000_000` lamports ± small band
- Treasury = platform fee wallet
- Reject reused signatures (UNIQUE on `payment_signature`)
- Optional memo: `owl-coin-art-upgrade:<mint>`

### Frontend

- Entry: `/dashboard/nesting` (and optionally `/nesting` explainer)
- Per eligible coin: Upgrade CTA → preview new art (when ready) → pay 0.15 SOL → confirm
- Badges: “Original” vs “Upgraded · 2 OWL/day”
- Admin: `/admin/nesting` — upgrade counts, failed jobs, retry metadata update, feature flag

### Config / env

- `NESTING_COIN_ART_UPGRADE_ENABLED`
- `NESTING_COIN_ART_UPGRADE_FEE_SOL=0.15`
- `NESTING_COIN_ART_UPGRADE_OWL_PER_DAY=2`
- Update-authority key material (existing nesting/update patterns — confirm which secret)
- Art pack version / base URI

## Phases

### Phase 0 — Align & inventory (no code)

- [ ] Confirm answers to product decisions above
- [ ] Inventory live coin mints (Helius DAS on `EZdg…` + legacy)
- [ ] Confirm update authority key availability and freeze+update interaction
- [ ] Agree art delivery format (PNG/WebP sizes, trait JSON schema, naming)

**Exit:** Written decisions + mint count + authority checklist.

### Phase 1 — Art pipeline (can start when sample art lands)

- [ ] Trait schema + generation / assignment rules for up to 1,000 looks
- [ ] Upload images + JSON to Arweave/Irys; store URIs
- [ ] Staging map: `mint → new_uri` (or seed → URI) for all live mints
- [ ] Keep originals untouched until holder upgrades

**Exit:** Dry-run metadata pack for all current mints; 1–2 assets updated on a test wallet.

### Phase 2 — Backend ledger + payment + rate bump

- [ ] Migration: upgrade table + indexes + RLS (API/service role only)
- [ ] `verifyCoinArtUpgradePayment` (0.15 SOL)
- [ ] Upgrade service: ownership, idempotency, Core URI update, nest rate cutover
- [ ] Stake path: if mint upgraded, snapshot rate `2`
- [ ] Feature flag off by default
- [ ] Unit tests: payment bands, double-spend sig, rate cutover math, non-coin mint rejection

**Exit:** API succeeds on staged mint with flag on; open nest accrues at 2 after cutover.

### Phase 3 — Holder + admin UI

- [ ] Nesting dashboard upgrade flow + copy (optional, fee, +2 OWL/day)
- [ ] Show upgraded art immediately from ledger if DAS stale
- [ ] Admin metrics + failed-update retry
- [ ] Public nesting page blurb when flag enabled

**Exit:** Wallet can upgrade end-to-end on staging; non-upgraded coins unchanged.

### Phase 4 — Launch

- [ ] Mainnet art pack finalized
- [ ] Flag on; announce Discord (fee, optional, yield)
- [ ] Monitor treasury inflows, upgrade rate, claim anomalies
- [ ] Support runbook: payment confirmed but metadata failed (retry), DAS lag

**Exit:** Live optional upgrade; giveaways handled by community ops.

## Out of scope (unless re-opened)

- Forced / mandatory art swap
- Changing Gen1/Gen2 perch rates
- New Anchor nesting program (stubs exist; not required for v1)
- Giveaway mechanics
- Reminting into a new collection (prefer in-place Core URI update)

## Risks

| Risk | Mitigation |
|------|------------|
| Frozen NFT cannot update URI | Prove update+freeze on one asset before launch; else force unnest path |
| Pool rate change used instead of per-mint | Always use upgrade ledger + snapshot cutover |
| Double upgrade / double fee | Unique mint + unique payment signature |
| Art not ready | Flag off; complete Phase 1 first |
| DAS shows old image | Prefer ledger URI in nesting UI after upgrade |
| 60 vs 1000 confusion | Phase 0 inventory; art set size ≠ current supply |

## Acceptance criteria (launch)

1. Holder can keep original art and still nest at **1 OWL/day**.
2. Holder can pay **0.15 SOL**, get new art on-chain, and nest/earn at **2 OWL/day**.
3. Upgrade is **optional** and **idempotent** per mint.
4. Active nests that upgrade do not lose lock incorrectly; accrual math is auditable across the rate cutover.
5. Non-coin NFTs cannot use the flow.
6. Feature can be disabled instantly via env/flag.

## Suggested implementation order (eng)

1. Phase 0 decisions + mint inventory script  
2. DB ledger + payment verify (flagged)  
3. MPL Core URI update helper + dry-run  
4. Rate cutover + stake snapshot wiring  
5. Dashboard UI  
6. Art pack attach + enable flag  

## Open questions for Gembird / art

- Exact trait list and rarity for the 1,000 looks?
- Final image resolution and whether animation is required?
- Launch date relative to “art will be rdy soon”?
- Should upgraded coins show a different name on-chain (e.g. `Owltopia Coin · Upgraded`)?
