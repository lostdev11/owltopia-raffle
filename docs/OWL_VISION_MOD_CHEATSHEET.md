# Owl Vision — Junior Admin Cheat Sheet

For **mod** role wallets in Owl Vision. No coding or repo access required — everything is in the browser at `/admin`.

Wallet: connect the vanity wallet Devdad added for you, then **Sign in** (SIWS) on the dashboard.

---

## 1. User paid but ticket didn’t show up

1. Open **Owl Vision** → **Bulk re-verify stuck tickets** → click **Re-verify pending (all, up to 60)**.
2. Still stuck? Get the **transaction signature** from the user (Solscan link is fine).
3. Use **Verify & Restore Transaction** — paste the sig and verify.
4. Still failing? **Dev tasks** → add a task with wallet, raffle link, and tx sig → ping Devdad.

---

## 2. Discord / support ticket

1. **Dev tasks** → **Add task** (title + details + screenshots from your phone).
2. Mark **done** when Devdad ships a fix, or leave open for triage.

---

## 3. Council proposal needs to go live

1. Quick links → **Owl Council** (or `/admin/council`).
2. Find the draft → change status to **active**.

---

## 4. Announcements & Discord comms

- **Announcements** — site banners and “new” badges.
- **Discord broadcast** — templates and scheduled messages.
- **Daily X raid** — ending-soon raffles → X → Discord mirror.
- **Share live raffles to Discord** — post active raffle embeds.

---

## 5. Monitoring (read-only)

- **Action inbox** — triage queue; items marked **escalate** need a full admin.
- **Creator Radar** / **Hot communities** — context for support.
- **Users** — wallet lookup.
- **Requested cancellations** — view only; do not accept on the raffle page.

---

## 6. Per-raffle (from Manage raffles → open listing)

You **can**:

- Toggle **Public raffles list** visibility.
- **Download entrants CSV**.
- View the public page link.

You **cannot** (403 / hidden UI — ping Devdad):

- Refunds (any kind).
- Accept cancellation.
- Select winner / send prize.
- Return prize to creator.
- Block purchases.
- Hard delete raffle.

---

## 7. Refunds, cancellations, winners

**Do not process.** Create a dev task with:

- Buyer wallet
- Raffle URL
- Tx signature (if they have one)
- Short description of what they expect

Ping Devdad or another full admin.

---

## 8. Nesting / staking issues

Junior admins do **not** have Owl Nesting admin (heal / force unstake). Collect wallet + what they tried → dev task → escalate.

---

## Quick reference

| Task | You handle it? |
|------|----------------|
| Stuck ticket / re-verify | ✅ Yes |
| Verify by tx signature | ✅ Yes |
| Dev tasks | ✅ Yes |
| Council activation | ✅ Yes |
| Announcements / Discord | ✅ Yes |
| Partner applications (review status) | ✅ Yes |
| Refunds | ❌ Escalate |
| Cancellations (accept) | ❌ Escalate |
| Winner / prize | ❌ Escalate |
| Rev share / revenue | ❌ Hidden |
| Nesting heal | ❌ Escalate |

When unsure: **dev task + ping Devdad**. Baby steps beat breaking prod.
