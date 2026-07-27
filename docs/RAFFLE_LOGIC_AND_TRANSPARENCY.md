# Raffle Logic & Transparency (for partners / FAQ)

This document answers common questions about how Owl Raffle works: where logic runs, what is on-chain vs off-chain, and how winners are determined.

---

## 1. Whitepaper link

- **Current link (Footer):** `https://tinyurl.com/owltopia`
- If that URL doesn’t show raffle-specific details, it may point to general Owltopia content. Consider either:
  - Updating the link to a doc that explains the raffle (e.g. this file or a dedicated `/how-it-works` page), or  
  - Adding a separate “Raffle FAQ” / “How raffles work” link that goes to raffle-specific documentation.

---

## 2. Is there a smart contract that determines the winner?

**Not yet (v1).** There is no Solana program that selects the raffle winner on-chain.

- **Payments:** Ticket purchases are real on-chain Solana transactions. Those can be verified on-chain (signatures, amounts, recipient).
- **Winner selection:** The **draw** is computed **off-chain**, then published with a public seed + ledger hash. A **reveal memo transaction** is posted on Solana so anyone can recompute the result (see §3).
- **Roadmap:** Commit–reveal and/or on-chain VRF can upgrade fairness without changing the verify UX.

So: **payments + reveal memo = on-chain; draw math = off-chain but publicly verifiable in v1.**

---

## 3a. Minimum ticket threshold not met (two selling rounds, then refunds + prize return)

If a raffle has a **minimum tickets** (or NFT floor–derived) threshold and it is **not** met when the first `end_time` passes:

1. The app may **extend the sale deadline once** (same length as the original raffle window, or 7 days as a fallback), so there is a **second selling round**.
2. That extension is **sales only** — no winner is drawn, commit–reveal seeds are **not** regenerated, and (when VRF is enabled) no randomness request is made yet.
3. If the threshold is met after round 2, the draw runs against the **final** ticket ledger (round 1 + round 2 confirmed tickets).
4. If the threshold is still **not** met when that extended deadline passes, the raffle is set to **`failed_refund_available`**:  
   - **Buyers** can claim **refunds** for their tickets (per the app’s refund / funds-escrow flows).  
   - **NFT (or partner SPL) prizes** that were held in escrow are **returned to the creator** when possible (automatically, or via the creator “claim prize back” action if the on-chain return needs a retry).  
   - There is **no draw** and no VRF / reveal fee in the refund path.

Implementation: `lib/raffles/min-threshold-extension.ts` (extension), `lib/raffles/min-threshold-terminal.ts` (terminal state + prize return attempt), `app/api/raffles/[id]/claim-failed-min-prize-return` (creator claim if needed). Public FAQ: `/how-it-works#second-selling-round`.

---

## 3. How is the winner determined? (draw logic)

- **Where it runs:** Backend (Next.js API + Supabase).  
  - Code: `lib/db/raffles.ts` → `selectWinner(raffleId)` → `lib/raffles/draw` (`performDrawV1`).
- **When it runs:**
  - When an admin triggers “Select winner” for a raffle, or
  - When cron / auto-draw runs after end time with threshold met.
- **Algorithm (`owltopia-draw-v1` / `owltopia-draw-v2-commit-reveal`):**
  1. Only **confirmed** entries count (entries whose payment was verified; refunded excluded).
  2. Tickets are summed **per wallet**, then wallets are sorted **lexicographically** into a contiguous ticket ledger.
  3. **Seed timing**
     - **v1:** a fresh public `drawSeed` (32-byte hex) is generated **at draw time**.
     - **v2 (default for new raffles):** the seed is chosen **at raffle create**. Public `draw_commit_hash = SHA256(seed)` is stored immediately; the raw seed stays in a **service-role-only** secrets table until draw.
  4. `winnerIndex = SHA256(seed + ":" + soldCount) % soldCount` (first 8 bytes of the hash as a big-endian uint). Same math for v1 and v2.
  5. The wallet owning that ticket index wins. More tickets ⇒ higher win probability.
  6. Stored on the raffle at draw: `draw_algo`, `draw_seed`, `draw_sold_count`, `draw_winner_index`, `draw_ledger_hash` (plus `draw_commit_hash` for v2).
  7. Best-effort **on-chain reveal memo** tx posts  
     `owltopia-draw-v*:<raffleId>:<seed>:<soldCount>:<winnerIndex>:<ledgerHash>`  
     (signature in `draw_reveal_tx`). Anyone can recompute via **Verify draw** on the raffle page or `GET /api/raffles/[id]/verify-draw`, and download the ticket map (CSV/JSON). Public FAQ: `/how-it-works#how-draws-work`.
- **Trust model:**
  - **v1:** Payments + escrow + reveal memo are on-chain; draw math is publicly re-derivable. Seed is chosen at draw time (not pre-committed).
  - **v2:** Same as v1, plus the community can see `draw_commit_hash` **before** the draw and check that the revealed seed matches it (operator cannot pick a seed after seeing the final ticket ledger without breaking the commit).
  - **Roadmap (v3):** on-chain VRF / raffle program behind the same Verify UX.

Legacy raffles drawn before this change have no seed fields and show as `legacy_draw` in the verify API.

---

## 4. Where is the draw logic?

| What                    | Where |
|-------------------------|--------|
| Ticket purchases        | On-chain (Solana: SOL or USDC transfer). Signatures can be stored and verified. |
| Entry records           | Supabase DB (`entries` table: wallet, ticket_quantity, status, transaction_signature, etc.). |
| Winner selection (draw) | Off-chain: `lib/raffles/draw` + `selectWinner()`, triggered by API/cron. |
| Public verify           | `GET /api/raffles/[id]/verify-draw` + raffle page **Verify draw** panel. |
| Reveal memo             | On-chain Solana memo tx (`draw_reveal_tx`) when escrow key can sign. |
| Winner storage          | Supabase DB (`raffles.winner_wallet`, `winner_selected_at`, draw_* fields). |

So: **ticket payments and reveal memo = on-chain; draw computation = off-chain but publicly verifiable (v1).**

---

## 5. Business model (NFT raffles) – for partner clarification

Dralcor’s understanding (for confirmation with the founder):

- **Proposal (their words):** You (the site) receive an NFT upfront to raffle; after the raffle you send them “100% of the value” and keep any “profits” for yourself.
- **In the code:** The app records raffles, entries, winner, and (for NFT prizes) an optional `nft_transfer_transaction` for the transfer to the winner. It does **not** encode the commercial split (e.g. “100% to partner, profit to site”); that’s a business/legal agreement to state clearly in a separate doc or terms.

Recommendation: Confirm that understanding in a short partner agreement or email and, if true, add a one-line summary to the site (e.g. “Proceeds: 100% of prize value to the NFT owner; platform keeps ticket revenue above that.”) so it’s transparent.

---

## 6. Quick answers for Dralcor

- **Whitepaper:** The “Whitepaper” link currently points to `https://tinyurl.com/owltopia`. If it doesn’t show raffle details, we’ll add a dedicated raffle FAQ or update the link.
- **Smart contract for winner?** Not yet. v1 publishes a verifiable seed + on-chain reveal memo; full on-chain selection (VRF/program) is a later upgrade.
- **Proof of work / detailed winner logic?** Yes: weighted by confirmed tickets, seeded SHA-256 index, public verify endpoint.
- **Where does the draw happen?** In our backend; anyone can recompute from published seed + ledger.
- **Business model (NFT, 100% value, profits)?** That’s a commercial/legal point; the founder should confirm and optionally publish a short, clear statement on the site.

---

*Last updated: Jul 2026. Reflects `owltopia-draw-v2-commit-reveal` (default for new raffles) and `owltopia-draw-v1` fallback.*
