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

**No.** There is no on-chain smart contract that selects the raffle winner.

- **Payments:** Ticket purchases are real on-chain Solana transactions (SOL or USDC to the raffle recipient wallet). Those can be verified on-chain (signatures, amounts, recipient).
- **Winner selection:** The **draw** (who wins) is computed **off-chain** in our backend, not by a Solana program.

So: **payments = on-chain; draw logic = off-chain.**

---

## 3. How is the winner determined? (draw logic)

- **Where it runs:** Backend (Next.js API + Supabase).  
  - Code: `lib/db/raffles.ts` → function `selectWinner(raffleId)`.
- **When it runs:**
  - When an admin triggers “Select winner” for a raffle, or
  - When someone visits a raffle’s detail page after it has ended and no winner has been selected yet (auto-draw).
- **Algorithm:**
  1. Only **confirmed** entries count (entries whose payment was verified).
  2. Tickets are aggregated **per wallet** (total tickets per wallet).
  3. **Weighted random choice:** each wallet’s chance is proportional to its total ticket count.
  4. Implemented as: `random = Math.random() * totalTickets`, then we walk through wallets by ticket weight until `random <= 0`; that wallet is the winner.
  5. The chosen `winner_wallet` and `winner_selected_at` are stored in the `raffles` table in Supabase.

So there is **no proof-of-work or on-chain verifiable randomness**; the draw is a standard weighted random in our server code. For full on-chain transparency you’d need a future design (e.g. commit–reveal, or a verifiable random function / oracle used by a smart contract).

---

## 4. Where is the draw logic?

| What                    | Where |
|-------------------------|--------|
| Ticket purchases        | On-chain (Solana: SOL or USDC transfer). Signatures can be stored and verified. |
| Entry records           | Supabase DB (`entries` table: wallet, ticket_quantity, status, transaction_signature, etc.). |
| Winner selection (draw) | Off-chain: `lib/db/raffles.ts` → `selectWinner()`, triggered by API or raffle detail page. |
| Winner storage          | Supabase DB (`raffles.winner_wallet`, `raffles.winner_selected_at`). |

So: **draw logic lives in the app backend (Node/Next + Supabase), not on Solana.**

---

## 5. Business model (NFT raffles) – for partner clarification

Dralcor’s understanding (for confirmation with the founder):

- **Proposal (their words):** You (the site) receive an NFT upfront to raffle; after the raffle you send them “100% of the value” and keep any “profits” for yourself.
- **In the code:** The app records raffles, entries, winner, and (for NFT prizes) an optional `nft_transfer_transaction` for the transfer to the winner. It does **not** encode the commercial split (e.g. “100% to partner, profit to site”); that’s a business/legal agreement to state clearly in a separate doc or terms.

Recommendation: Confirm that understanding in a short partner agreement or email and, if true, add a one-line summary to the site (e.g. “Proceeds: 100% of prize value to the NFT owner; platform keeps ticket revenue above that.”) so it’s transparent.

---

## 6. Quick answers for Dralcor

- **Whitepaper:** The “Whitepaper” link currently points to `https://tinyurl.com/owltopia`. If it doesn’t show raffle details, we’ll add a dedicated raffle FAQ or update the link.
- **Smart contract for winner?** No. We don’t use a smart contract to determine the winner.
- **Proof of work / detailed winner logic?** Yes, but only in backend code: weighted random by ticket count, in `lib/db/raffles.ts`. No on-chain proof.
- **Where does the draw happen?** In our backend (API + DB). Ticket purchases are on-chain; the draw itself is off-chain.
- **Business model (NFT, 100% value, profits)?** That’s a commercial/legal point; the founder should confirm and optionally publish a short, clear statement on the site.

---

*Last updated: Feb 2025. Reflects current codebase (Next.js + Supabase; draw in `lib/db/raffles.ts`).*
