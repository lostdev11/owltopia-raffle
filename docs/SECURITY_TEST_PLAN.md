# Security Fixes — Test Plan

Use this to confirm the applied patches work as intended.

## 1. Underpayment (C2)

- **Setup:** Raffle with `ticket_price: 1` SOL, `ticketQuantity: 2`.
- **Request:** `POST /api/entries/create` with body including `amountPaid: 0.001` (attempt underpayment).
- **Expect:** Response entry has `amount_paid: 2` (server-computed from `ticket_price * ticketQuantity`), not 0.001.
- **Verify flow:** Build and send a tx for 2 SOL; verification should expect 2 SOL and succeed. A tx for 0.001 SOL should fail verification.

## 2. Replay (C3)

- **Setup:** Create two pending entries (same or different raffles): Entry A and Entry B.
- **Action:** Pay once for Entry A; obtain transaction signature `S`.
- **Step 1:** `POST /api/entries/verify` with `{ entryId: A, transactionSignature: S }` → expect 200, Entry A confirmed.
- **Step 2:** `POST /api/entries/verify` with `{ entryId: B, transactionSignature: S }` → expect 400, body error "Transaction signature already used for another entry".

## 3. Recipient not set (C4)

- **Setup:** Unset `RAFFLE_RECIPIENT_WALLET` and `NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET` (e.g. in test env).
- **Action:** Call verify with a valid-looking entry and any signature.
- **Expect:** Response `valid: false`, error message mentions "Recipient wallet not configured".

## 4. select-winners auth (C5)

- **GET without wallet:** `GET /api/raffles/select-winners` with no header → 401 "Wallet address is required".
- **GET with non-admin wallet:** `x-wallet-address: <non-admin>` → 403 "Only admins can view this".
- **GET with admin wallet:** `x-wallet-address: <admin_wallet>` → 200 and list of ended raffles.
- **POST without admin:** Same as GET; POST with admin → 200 (or 400 if no raffles to process).

## 5. saveTransactionSignature (H1)

- **Setup:** RLS enabled (migration 020 applied); no anon UPDATE on `entries`.
- **Action:** Full flow: create entry → pay → verify with signature.
- **Expect:** Entry is updated with `transaction_signature` and status `confirmed`. No RLS/permission error in logs.

## 6. Image upload (H3)

- **Without wallet:** `POST /api/upload/image` with only `file` in form → 401.
- **With non-admin wallet:** `x-wallet-address: <non-admin>` + file → 403 "Only admins can upload images".
- **With admin wallet:** Admin wallet in header + valid image → 200 and URL returned.

## 7. DB unique signature (migration 027)

- **After applying migration 027:** Attempt to insert or update a second row in `entries` with the same non-null `transaction_signature` as an existing row.
- **Expect:** Unique constraint violation (or application replay check prevents the update before DB).

## 8. Admin bypass (C1) — current state

- **Before SIWS:** From a non-admin machine, send `x-wallet-address: <admin_wallet>` to any admin endpoint. Currently the server grants access (documented risk).
- **After SIWS:** Same request without a valid session/signature → 401/403.

---

## Env / secrets checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set only on server; never in `NEXT_PUBLIC_*`.
- [ ] `RAFFLE_RECIPIENT_WALLET` used for server verification; prefer over `NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET` so treasury is not exposed to client.
- [ ] No private keys or API secrets in any `NEXT_PUBLIC_*` variable.
- [ ] Production error responses do not include stack traces or env variable names.
