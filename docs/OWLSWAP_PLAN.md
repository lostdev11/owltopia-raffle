# OwlSwap — Product & Engineering Plan

Sibling to [OwlSend](./OWLSEND_DEV_ANNOUNCEMENT.md). Goal: peer-to-peer NFT trading that is **easier than FoxySwap**, plus a later **token swap** tab, with OwlSend-style clarity (fees, estimate → review → confirm, ledger, holder discounts, mobile-first).

**Decisions locked**

| Decision | Choice |
|----------|--------|
| Scope | **Both** — NFT P2P first, then token swap (phased) |
| Trade completion | **Create offer → shareable link** (`/owl-swap/o/[id]`) |
| Fees | Low base Owl fee + **same Gen1/Gen2 holder discount ladder as OwlSend** (10–50% off platform fee only) |

Live product URL (target): `https://www.owltopia.xyz/owl-swap`

---

## 1. Why OwlSwap (vs FoxySwap)

FoxySwap (Famous Fox Federation) today:

- P2P NFT trades (not a DEX)
- Up to **10 NFTs / 3 pNFTs** per trade
- Optional **SOL** to balance uneven trades
- **0.1 SOL** flat fee
- Verified collections (~600+)
- Wallet-connect UI that many users find dense / unclear on mobile

OwlSwap should win on:

1. **Clarity** — OwlSend-style live cost estimate, one-job sections, review before sign
2. **Price** — undercut Foxy’s 0.1 SOL with a low Owl fee + holder discounts
3. **Mobile** — ~75% of Owltopia users; 44px targets, single-column flow ([MOBILE_FIRST.md](./MOBILE_FIRST.md))
4. **Trust continuity** — same brand, wallet stack, holder perks as OwlSend / raffles
5. **Link-first** — create offer, copy link/QR, counterparty opens and accepts (no “both online” requirement)

---

## 2. Product phases

```mermaid
flowchart LR
  P0[Phase0 Spec_Gates] --> P1[Phase1 NFT_Offer_MVP]
  P1 --> P1b[Phase1b Asset_Coverage]
  P1b --> P2[Phase2 Token_Swap]
  P2 --> P3[Phase3 Trustless_Program]
```

### Phase 0 — Spec & gates (this doc)

- Fee numbers, limits, trust model, admin rollout gate
- No user-facing UI yet

### Phase 1 — NFT P2P offer MVP (ship first)

**User stories**

1. Maker connects wallet → sees holder fee tier (reuse OwlSend quote pattern)
2. Maker picks **their** NFTs (and optional SOL sweetener)
3. Live estimate: Owl fee (discounted) + rent/network notes
4. Review → Confirm → deposit assets into OwlSwap escrow → offer becomes `open`
5. Maker copies **share link** (+ QR on mobile)
6. Taker opens `/owl-swap/o/[code]` → sees maker side → picks their NFTs (+ optional SOL)
7. Taker Review → Confirm → deposit + complete swap (or single accept tx that settles)
8. Both sides get success UI; swap recorded in **ledger**
9. Maker can **cancel** an open offer (reclaim assets) before accept
10. Offers **expire** after a TTL; reclaim path for maker

**Out of scope for Phase 1**

- Token↔token DEX tab
- Public offer browse marketplace
- Counterparty wallet lock (open link is enough; optional “only this wallet” field is nice-to-have)
- cNFT / Core / complex pNFT paths (Phase 1b)

**Asset support Phase 1**

- Classic SPL NFTs (Metaplex Token Metadata)
- Optional SOL on either side
- Collection allowlist: start with Owltopia Gen1/Gen2 + curated partners; expand like Foxy’s verified list

### Phase 1b — Asset coverage parity with OwlSend send paths

Reuse OwlSend special paths where possible:

| Asset | Approach |
|-------|----------|
| pNFT | Programmable NFT transfer rules; limit ≤3 per side (match Foxy) |
| cNFT | Bubblegum; usually 1 per approval — batch carefully |
| MPL Core | Server prepare pattern like OwlSend `prepare-core-transfer` |
| Frozen / nested | Skip + thaw hints (same eligibility UX as OwlSend) |

Raise limits toward **10 NFTs / 3 pNFTs per side** once tx size + mobile wallet injection headroom are validated (OwlSend already learned packet-size lessons in `lib/owl-send/constants.ts`).

### Phase 2 — Token swap tab (Jupiter)

Same page, second tab (OwlSend NFT | Tokens pattern):

- SOL ↔ SPL via **Jupiter Quote + Swap API** (aggregator; no custom AMM)
- OwlSend UX: amount in → estimate (price impact, route hops, Owl fee) → review → confirm
- Optional Owl platform fee (tiny SOL) with holder discount
- Ledger entries for completed swaps
- No “scatter” — single destination is the user’s wallet

### Phase 3 — Trustless on-chain program (optional upgrade)

Replace custodial escrow with an Anchor (or Pinocchio) atomic swap program:

- Maker deposits to PDA escrow
- Taker accepts in one instruction set that swaps both sides + pays fee
- Cancel / expire on-chain
- Removes “trust Owltopia with custody” for high-value trades

Ship Phase 1 with **documented custodial trust** (same class as prize escrow) so UX can launch; Phase 3 when volume or risk warrants it.

---

## 3. UX (mirror OwlSend)

### Information architecture

| Route | Purpose |
|-------|---------|
| `/owl-swap` | Create offer + My offers + Token tab (Phase 2) |
| `/owl-swap/o/[code]` | Public accept page for a share link |
| `/admin/owl-swap` | Admin preview bench (like `/admin/owl-send`) |

Nav: Community → OwlSwap (gated like OwlSend via `OWL_SWAP_PUBLIC` / `NEXT_PUBLIC_OWL_SWAP_PUBLIC`).

### Single create flow (mobile-first)

1. **Connect** (wallet primary CTA)
2. **Your side** — NFT picker (reuse `WalletNftPicker`), optional SOL amount
3. **Cost** — emerald estimate card (Owl fee after discount; rent/network callouts)
4. **Review offer** → **Confirm & create**
5. **Share** — link, copy, QR; status `open`
6. Mid-flow failure → **resume / reclaim** (OwlSend session-draft spirit)

### Accept flow

1. Open link → load offer (maker assets read-only)
2. Connect → pick **your side**
3. Estimate (fee paid by taker on accept — see fees)
4. Review both sides → Confirm
5. Success + ledger

### Design tokens

Reuse Owltopia: `theme-prime` / `#00ff88`, Bebas `font-display` hero “OwlSwap”, dark `border-white/10 bg-black/40` surfaces, segment toggles. No new purple/cream AI-default look. One composition hero; no card clutter in hero.

### Ease-of-use vs Foxy (explicit)

| Pain (Foxy-like) | OwlSwap fix |
|------------------|-------------|
| Unclear fee until late | Always-visible estimate before first sign |
| Dense multi-panel trade UI | One column: Your side → Cost → Review → Share |
| 0.1 SOL flat | ~0.02 SOL base + holder discounts |
| Hard to resume | Draft + cancel/reclaim + ledger recover |
| Mobile wallet friction | OwlSend batch gaps, absolute API URLs, touch targets |

---

## 4. Fees & holder discounts

**Proposed defaults** (env-overridable; tune before go-live):

| Item | Value |
|------|--------|
| Base Owl fee | **0.02 SOL per completed swap** (5× cheaper than Foxy’s 0.1) |
| Who pays | **Taker on accept** (maker sees “counterparty pays Owl fee” in estimate; maker pays only rent/network to deposit) |
| Discount | Same ladder as OwlSend (`lib/owl-send/holder-discount.ts`) — Gen1/Gen2 hold ranks → 10–50% off **Owl fee only** |
| Non-holder | 0.02 SOL |
| OwlHolder (10%) | 0.018 SOL |
| … | … |
| OwlFounder / GEMBIRD (50%) | 0.01 SOL |

Discount applies to the **taker’s** wallet holder status at accept time (auto-quoted). Document clearly so makers aren’t surprised.

Treasury: reuse `OWL_PLATFORM_FEE_TREASURY_WALLET` (same as OwlSend) unless product wants a dedicated swap treasury later.

Env:

- `OWL_SWAP_FEE_SOL` / `NEXT_PUBLIC_OWL_SWAP_FEE_SOL` (default `0.02`)
- `OWL_SWAP_PUBLIC` / `NEXT_PUBLIC_OWL_SWAP_PUBLIC` (default admin-only)
- `OWL_SWAP_OFFER_TTL_HOURS` (default `72`)
- Escrow: `OWL_SWAP_ESCROW_SECRET_KEY` (server-only; dedicated keypair — do not reuse prize escrow)

---

## 5. Trust model (Phase 1)

**Custodial OwlSwap escrow wallet** (same operational class as [prize escrow](./PRIZE_ESCROW.md)):

1. Maker deposits selected NFTs (+ optional SOL) to escrow; offer status → `open`
2. Taker deposits their side and triggers settlement (server builds/signs escrow release of maker assets to taker + taker assets to maker + fee to treasury)
3. Cancel: maker reclaim while `open`
4. Expire: cron or on-read expiry → reclaimable

**Risks & mitigations**

- Escrow key compromise → dedicated keypair, no shared prize/funds keys, monitor balance, rate limits
- Partial deposit failures → status machine + resume; never mark `open` until maker deposit verified on-chain
- Fake collections → allowlist + DAS verification before accept
- DoS / spam offers → SIWS for create; rate limit; small deposit or max open offers per wallet

**User-facing copy:** “Assets sit in Owltopia OwlSwap escrow until the other side accepts or you cancel.” Phase 3 removes this.

---

## 6. Data model (Supabase)

New migration (suggested name `2xx_owl_swap_offers.sql`):

### `owl_swap_offers`

| Column | Notes |
|--------|--------|
| `id` uuid PK | |
| `short_code` text unique | URL slug for share links |
| `maker_wallet` text | |
| `taker_wallet` text nullable | Set on accept (or optional lock at create) |
| `status` text | `draft` \| `open` \| `completed` \| `cancelled` \| `expired` |
| `maker_sol_lamports` bigint | Sweetener |
| `taker_sol_lamports` bigint | Expected or filled |
| `owl_fee_lamports` bigint | Fee charged at settle |
| `fee_discount_bps` int | Snapshot at settle |
| `maker_deposit_sig` text nullable | |
| `settle_sig` text nullable | |
| `expires_at` timestamptz | |
| `created_at` / `updated_at` | |
| `completed_at` nullable | |

### `owl_swap_offer_assets`

| Column | Notes |
|--------|--------|
| `id` | |
| `offer_id` FK | |
| `side` | `maker` \| `taker` |
| `asset_kind` | `spl_nft` \| `pnft` \| `cnft` \| `core` \| `spl_token` |
| `mint` / `asset_id` | |
| `amount` | 1 for NFT; raw for tokens |
| `collection` nullable | |
| `verified` bool | Allowlist / DAS check |

### `owl_swap_ledger`

Mirror OwlSend ledger privacy: SIWS-gated “my swaps”; store signatures, sides, fee, timestamps. Recover-from-signature API optional (Phase 1b).

RLS: makers/takers read own rows; service role for settle; public read of **open offer display fields** by `short_code` only via API (not full table).

---

## 7. API surface (Phase 1)

| Method | Path | Role |
|--------|------|------|
| GET | `/api/owl-swap/holder-fee` | Quote discount (reuse OwlSend holder count logic) |
| POST | `/api/owl-swap/offers` | Create draft + return deposit instructions |
| POST | `/api/owl-swap/offers/[id]/verify-deposit` | Confirm maker deposit → `open` |
| GET | `/api/owl-swap/offers/by-code/[code]` | Public offer view |
| POST | `/api/owl-swap/offers/[id]/accept` | Build/settle taker accept |
| POST | `/api/owl-swap/offers/[id]/cancel` | Maker reclaim |
| GET | `/api/owl-swap/ledger` | SIWS my ledger |
| GET | `/api/config/owl-swap-escrow` | Escrow pubkey for deposits |

Admin: preview access when not public (`canAccessOwlSwap` clone of `lib/owl-send/access.ts`).

---

## 8. Code layout (reuse OwlSend)

```
app/owl-swap/page.tsx
app/owl-swap/o/[code]/page.tsx
app/admin/owl-swap/page.tsx
app/api/owl-swap/...
components/owl-swap/OwlSwapClient.tsx
components/owl-swap/OwlSwapAcceptClient.tsx
components/owl-swap/OwlSwapLedgerPanel.tsx
lib/owl-swap/
  access.ts
  constants.ts          # limits, fee default, TTL
  fee.ts                # wrap shared holder discount
  cost-estimate.ts
  escrow.ts             # deposit / settle / reclaim builders
  offer-state.ts
  allowlist.ts
lib/db/owl-swap-offers.ts
lib/db/owl-swap-ledger.ts
supabase/migrations/..._owl_swap.sql
docs/OWLSWAP_DEV_ANNOUNCEMENT.md   # when ready to announce
```

**Reuse as-is or thin-wrap**

- `components/WalletNftPicker.tsx`
- `lib/owl-send/holder-discount.ts` + holder counts / fee quote APIs (shared module later: `lib/owl-holder-fee/` if both products call it)
- `lib/solana/*` connection, confirm, platform fee treasury
- `WalletProvider`, SIWS hooks, site nav gate pattern
- Mobile helpers: `isMobileDevice()`, approval gaps

**Do not** fork Jupiter into Phase 1; keep token swap Phase 2.

---

## 9. Limits (Phase 1 → 1b)

| Limit | Phase 1 | Target (1b) |
|-------|---------|-------------|
| NFTs per side | 5 classic | 10 |
| pNFTs per side | 0 (defer) | 3 |
| SOL sweetener | yes | yes |
| Open offers / wallet | 3 | 5 |
| Offer TTL | 72h | env |
| Collections | allowlist | growing verified list |

Tx size: follow OwlSend scatter lessons — prefer fewer assets per deposit tx; chain approvals with `~450ms` gap on mobile.

---

## 10. Security checklist

- Never expose escrow secret to client
- Simulate txs before wallet sign (maker deposit; taker accept)
- Verify mint ownership + allowlist before `open` / settle
- Idempotent settle (unique `settle_sig`, status transition guards)
- Rate limit create/accept by IP + wallet
- SIWS for ledger and cancel
- No private keys in logs; treat DAS metadata as untrusted display strings

---

## 11. Rollout

1. Admin-only (`OWL_SWAP_PUBLIC=false`) — core team trades on mainnet with low-value NFTs
2. Holder beta (optional Discord role gate) 
3. Public: set `OWL_SWAP_PUBLIC` + `NEXT_PUBLIC_OWL_SWAP_PUBLIC`, redeploy (same go-live pattern as OwlSend)
4. Announcement doc modeled on `OWLSEND_DEV_ANNOUNCEMENT.md`

---

## 12. Success metrics

- Offer create → accept conversion
- Median time create → accept
- Mobile share of completes
- Fee revenue vs support load (failed deposits, reclaim)
- Qualitative: “easier than Foxy” from community feedback

---

## 13. Implementation order (when building)

1. Migration + escrow env + access gate + empty `/owl-swap` shell in nav
2. Create offer UI + deposit verify → share link
3. Accept page + settle + fee + ledger
4. Cancel / expire / reclaim
5. Harden allowlist + mobile QA matrix (Phantom/Solflare/Seeker)
6. Phase 1b asset types
7. Phase 2 Jupiter tab
8. Phase 3 on-chain program (if needed)

---

## 14. Open tuneables (defaults above; change before go-live)

- Exact base fee (`0.02` vs `0.01` vs `0.025`)
- Fee payer (taker-only vs split)
- Whether maker may lock `taker_wallet` at create
- Starting allowlist size

These do not block Phase 1 engineering if env defaults ship as specified in §4.
