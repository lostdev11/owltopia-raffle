# Security Audit Report — Owl Raffle Site

**Scope:** Authorized defensive security review.  
**Focus:** Payment/entry integrity, admin auth, Supabase RLS, input validation, raffle integrity.

---

## 1) Threat Model (Short)

### High-value assets
| Asset | Location / mechanism |
|-------|------------------------|
| Treasury / escrow | `RAFFLE_RECIPIENT_WALLET` (env); all SOL/USDC/OWL payments go here |
| Admin privileges | `admins` table; gates raffle CRUD, entry verify/delete, announcements, rev-share schedule |
| Raffle integrity | `raffles` (min_tickets, end_time, winner selection); `entries` (confirmed only) |
| Payment verification | `lib/verify-transaction.ts` + `POST /api/entries/verify` |
| Refunds | Not implemented in scope; admin delete entry is logical “reversal” |

### Trust boundaries
- **Client vs server:** Client sends wallet address, entryId, transactionSignature. Server must never trust client for amounts, recipient, or admin identity without proof.
- **Supabase RLS:** After migration 020, anon key has no INSERT/UPDATE/DELETE on `entries`/`raffles`; only service role can write. Any route that writes with anon will fail in production.
- **Solana tx verification:** Server must verify tx on RPC (amount, recipient, mint, confirmation). No “trust signature string” without on-chain check.
- **Env secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `RAFFLE_RECIPIENT_WALLET` (if server-only), any private keys must never be in `NEXT_PUBLIC_*`.

---

## 2) Prioritized Vulnerability Report

### Critical

| ID | Issue | Impact | Location |
|----|--------|--------|----------|
| C1 | **Admin bypass (no cryptographic auth)** | Attacker sends `x-wallet-address: <admin_wallet>` (or body `wallet_address`) and performs any admin action (create/update/delete raffles, verify entries, delete entries, announcements, rev-share schedule, etc.). No signature or session required. | All `app/api/admin/*`, `app/api/raffles` POST/PATCH/DELETE, `app/api/raffles/[id]/*`, `app/api/entries/[id]` DELETE |
| C2 | **Underpayment via client-supplied amount** | Client can send `amountPaid: 0.001` for a 1 SOL ticket. Server creates pending entry with `amount_paid: 0.001`, then verification expects 0.001 SOL. Attacker pays 0.001 SOL and gets a full ticket. | `app/api/entries/create/route.ts` (uses `amountPaid` from body) |
| C3 | **Replay of transaction signature** | One valid on-chain tx can confirm multiple entries: create Entry A (pending), pay once, get sig S; verify Entry A with S → confirmed. Create Entry B (pending), call verify with Entry B + same S → B also confirmed. No server-side check that signature is used only once. | `app/api/entries/verify/route.ts`, `lib/db/entries.ts` (no uniqueness on `transaction_signature`) |
| C4 | **Verification bypass when recipient not configured** | If `RAFFLE_RECIPIENT_WALLET` (and fallback) is unset, `verifyTransaction()` returns `{ valid: true }`. In production this would mark unpaid entries as confirmed. | `lib/verify-transaction.ts` (~line 46–48) |
| C5 | **Winner selection has no auth** | Anyone can POST to `/api/raffles/select-winners` to trigger winner selection or extend raffles (min tickets / 7-day logic). | `app/api/raffles/select-winners/route.ts` |

### High

| ID | Issue | Impact | Location |
|----|--------|--------|----------|
| H1 | **saveTransactionSignature uses anon client** | After migration 020, anon has no UPDATE on `entries`. `saveTransactionSignature()` uses `supabase` (anon). Save will fail with RLS; verify flow may leave entries stuck or rely on update in `updateEntryStatus` only (service role). If signature is saved only in updateEntryStatus, replay check must run before any write. | `lib/db/entries.ts` `saveTransactionSignature()` |
| H2 | **USDC/OWL verification uses float math** | `parseFloat(uiAmountString)` and tolerance-based comparison can allow rounding/underpayment over many decimals. Prefer integer base units (raw `amount` + decimals). | `lib/verify-transaction.ts` (USDC/OWL branches) |
| H3 | **Image upload has no auth** | Any client can POST to `/api/upload/image` and upload up to 10MB to `raffle-images`. DoS / cost abuse. | `app/api/upload/image/route.ts` |

### Medium

| ID | Issue | Impact | Location |
|----|--------|--------|----------|
| M1 | **No rate limiting** | Purchase, verify, and admin endpoints can be spammed (entries creation, verify attempts, admin checks). | All relevant API routes |
| M2 | **Raffle PATCH allows min_tickets/end_time after entries** | Admin can change min_tickets or end_time even when `hasConfirmedEntries`; only `edited_after_entries` is set. Business risk (e.g. lower min to draw early). | `app/api/raffles/[id]/route.ts` |
| M3 | **Input validation not schema-based** | Many routes use ad-hoc checks and `parseInt`/`parseFloat`/`String()` without Zod. Risk of type confusion and injection-style payloads. | Multiple API routes |
| M4 | **Error messages may leak config in dev** | Dev-only messages mention env vars and Supabase; ensure prod never returns them. | Various (e.g. GET raffles, announcements) |

### Low

| ID | Issue | Impact | Location |
|----|--------|--------|----------|
| L1 | **NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET** | If recipient is in `NEXT_PUBLIC_*`, it’s visible to client. Prefer server-only `RAFFLE_RECIPIENT_WALLET` for treasury. | Env usage in verify-transaction, entries/create |
| L2 | **select-winners GET exposes ended raffles** | GET returns list of ended raffles without winners; low info leak. | `app/api/raffles/select-winners/route.ts` GET |

---

## 3) Concrete Patches (Critical / High)

### C2: Underpayment — ignore client amountPaid

**File:** `app/api/entries/create/route.ts`

- **Change:** Do not use `amountPaid` from the client. Always compute `amount_paid` server-side as `ticket_price * ticketQuantity` (using stored `ticket_price` and validated `ticketQuantity`). Remove any assignment from `body.amountPaid` to `finalAmountPaid`.

### C3: Replay — one signature per entry + DB uniqueness

**File:** `app/api/entries/verify/route.ts`

- **Change:** Before saving or verifying, call `getEntryByTransactionSignature(transactionSignature)`. If it returns an entry and that entry’s `id !== entryId`, return 400 “Transaction signature already used for another entry.” Only then save signature and run verification.

**File:** `lib/db/entries.ts`

- **Change:** In `saveTransactionSignature` use `getSupabaseAdmin()` instead of `supabase` so the update succeeds under RLS (migration 020).

**DB:** Add unique constraint on `transaction_signature` where not null (see Section 5).

### C4: Verification bypass when recipient unset

**File:** `lib/verify-transaction.ts`

- **Change:** When `recipientWallet` is not configured, return `{ valid: false, error: 'Recipient wallet not configured' }`. Do not return `valid: true` in production or development.

### C5: select-winners must require admin

**File:** `app/api/raffles/select-winners/route.ts`

- **Change:** For both GET and POST, require wallet from header/body and call `isAdmin(wallet)`. If missing or not admin, return 401/403. Do not allow unauthenticated winner selection or listing of ended raffles for drawing.

### H1: saveTransactionSignature use service role

**File:** `lib/db/entries.ts`

- **Change:** In `saveTransactionSignature`, replace `supabase` with `getSupabaseAdmin()` for the `.from('entries').update(...)` call.

### H2: Prefer integer amounts in verification (USDC/OWL)

**File:** `lib/verify-transaction.ts`

- **Change:** For USDC and OWL, use `tokenAmount.amount` (string of raw base units) and `tokenAmount.decimals` from the balance objects. Convert expected amount to base units using raffle/entry currency decimals (e.g. from `getTokenInfo`). Compare `BigInt(expectedBase)` with `BigInt(actualBase)` with optional small tolerance in base units if needed. Reduces float rounding and underpayment risk.

### H3: Image upload auth

**File:** `app/api/upload/image/route.ts`

- **Change:** Require `x-wallet-address` (or body) and call `isAdmin(wallet)`. Return 403 if not admin. Optionally restrict to admin-only uploads for raffle images.

---

## 4) Authorization / Admin Bypass — SIWS Implementation Plan

- **Current state:** Every admin route trusts `x-wallet-address` or `body.wallet_address` and checks `isAdmin(wallet)`. There is no proof that the request comes from that wallet; anyone can forge the header.

- **Minimal SIWS (Sign-In with Solana) layer:**

  1. **Nonce:** Server generates a short-lived nonce (e.g. stored in signed cookie or server cache), keyed by session id or wallet. TTL e.g. 5 minutes.
  2. **Message format:** e.g. `"Sign in to Owl Raffle.\nNonce: <nonce>\nExpires: <iso-date>"`. Client requests nonce from e.g. `GET /api/auth/nonce?wallet=<address>`, then wallet signs this message.
  3. **Verification:** New endpoint `POST /api/auth/verify` (or similar) receives `{ wallet, message, signature }`. Server checks nonce, expiry, and `nacl.sign.detached.verify` (or equivalent) with wallet as public key. On success, create session (e.g. signed httpOnly cookie with wallet + expiry).
  4. **Session cookie:** Set httpOnly, secure, sameSite cookie with payload like `{ wallet, exp }`. Middleware or helper reads cookie and validates expiry.
  5. **Middleware guard:** For all routes under `/api/admin/*`, `/api/raffles` POST/PATCH/DELETE, `/api/raffles/[id]` PATCH/DELETE/restore/nft-transfer, `/api/entries/[id]` DELETE, and `/api/raffles/select-winners`: require valid session cookie (or alternatively, require SIWS on each request with message including method + path). If missing or invalid, return 401.

- **Short-term mitigation (no SIWS yet):** Document that admin APIs are vulnerable to header spoofing; restrict admin APIs by IP or deploy behind VPN/internal only until SIWS is in place. Do not rely on `x-wallet-address` alone for any privileged action.

---

## 5) Supabase Security (RLS + Data Exposure)

- **Service role never to client:** Confirmed: `getSupabaseAdmin()` and `SUPABASE_SERVICE_ROLE_KEY` are server-only. `lib/supabase.ts` uses only anon + `NEXT_PUBLIC_*`. Upload route uses service key when available; it should require admin (see H3).

- **Reads:** Raffles and entries are read with either anon (client) or service role (server). RLS after 020 still allows “Anyone can view all entries” and similar SELECT policies; reads are effectively public for raffles/entries, which is acceptable for a public raffle list and entry list.

- **Writes:** All entry/raffle writes must go through API using service role. No client-side write to these tables; `saveTransactionSignature` and `updateEntryStatus` must use service role (patches above).

- **SQL suggestions (migrations):**
  - **Unique constraint on payment signature:**  
    `CREATE UNIQUE INDEX idx_entries_transaction_signature_unique ON entries(transaction_signature) WHERE transaction_signature IS NOT NULL;`  
    Prevents two rows from sharing the same non-null signature (replay at DB level).
  - **Row ownership:** Entries don’t have a “user” column; they have `wallet_address`. RLS already dropped for writes; any ownership checks are in API (e.g. “my entries” filter by wallet). No change needed if all writes are server-side with service role.
  - **Preventing edits after entries:** Raffles already have `edited_after_entries`. To harden, you could add a trigger that blocks certain updates (e.g. `ticket_price`, `currency`) when `edited_after_entries = true`; currently this is enforced in API (PATCH allows updates but sets the flag). Optional.

---

## 6) Input Validation & Injection

- **Zod:** Introduce Zod schemas for all API bodies/params (e.g. entries/create, entries/verify, raffles POST/PATCH, admin payloads). Use `.safeParse()` and return 400 with clear errors on failure. Avoid `parseInt`/`parseFloat` on raw body without schema.
- **Slug/title/description:** Sanitize and length-limit (e.g. title max length, description max length, slug pattern). Zod can enforce string length and regex.
- **File upload:** Already validated type and size; add auth (H3). No SSRF found in reviewed routes; if any route fetches remote URLs from user input, validate and restrict protocol/host.

---

## 7) Next.js Runtime / Secrets / Env

- **Env:** Ensure `SUPABASE_SERVICE_ROLE_KEY`, `RAFFLE_RECIPIENT_WALLET` (if used only server-side) are not under `NEXT_PUBLIC_*`. Prefer `RAFFLE_RECIPIENT_WALLET` server-only; avoid exposing treasury in client.
- **Route handlers:** Raffles and entries routes use `force-dynamic`; ensure route handlers that need Node APIs run in Node (default). No change required if not using edge.
- **Ensuring env names are not exposed:** Use `lib/safe-error.ts` `safeErrorMessage(error)` for API error responses; in production only a generic message is returned; in dev env-like substrings are redacted. **Error messages:** In production, avoid returning stack traces or env names; use generic “Internal server error” or safe messages. Keep detailed errors in server logs only.

---

## 8) Raffle Integrity & Abuse Controls

- **min_tickets / end_time after entries:** Already tracked with `edited_after_entries`. Consider blocking reduction of min_tickets or shortening of end_time once there are confirmed entries (business rule in PATCH).
- **Winner logic:** Implemented in `lib/db/raffles.ts` (selectWinner); no tampering found. select-winners endpoint must be admin-only (C5).
- **Replaying verify:** Replay of same signature for multiple entries is addressed by C3 (signature uniqueness + check before verify).
- **Rate limiting:** Add minimal in-memory rate limit (e.g. per IP or per wallet) for `POST /api/entries/create`, `POST /api/entries/verify`, and admin endpoints. For production, use Upstash Redis or similar for distributed limits.

---

## 9) Test Plan (Confirm Fixes)

1. **Underpayment (C2):**  
   Send `POST /api/entries/create` with `amountPaid: 0.001` for a 1 SOL raffle. Assert response entry and subsequent verify expect 1 SOL (server-computed), not 0.001.

2. **Replay (C3):**  
   Create two pending entries (same or different raffles). Pay for one, get signature S. Verify first entry with S → 200. Verify second entry with same S → 400 “Transaction signature already used.”

3. **Recipient not set (C4):**  
   Unset recipient env; call verify with valid-looking entry. Assert response is `valid: false` and error mentions recipient.

4. **select-winners auth (C5):**  
   POST/GET without wallet or with non-admin wallet → 401/403. With admin wallet (and later SIWS session) → 200.

5. **saveTransactionSignature (H1):**  
   After patch, with RLS enabled, verify flow still saves signature and confirms entry (no RLS permission error).

6. **Admin bypass (C1):**  
   From a non-admin client, set `x-wallet-address: <admin_wallet>`. Before SIWS: currently can perform admin actions (documented risk). After SIWS: without valid session/signature, all admin actions return 401/403.

7. **Image upload (H3):**  
   POST without admin wallet or as non-admin → 403. As admin → 200 and file in bucket.

8. **DB unique signature:**  
   After migration, attempt to update a second entry with the same non-null `transaction_signature` → constraint violation or application-level check prevents it.
