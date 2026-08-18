# Partner Discord whitelist collection

## Verdict

Build this. Partners already configure **Team / OG / WL / WL2** phases and paste wallets in Owl Center. The missing piece is Discord-native collection: open a spot in their server, take wallets from members, close the list, export (or push) into Owl Center.

Do **not** collect wallets as public chat messages. Use a channel embed + button + ephemeral modal (or the existing linked-wallet flow). Public paste is phishing bait, leaks addresses, and is full of typos.

This is a Partner Pro feature on the existing Owltopia Discord bot (`/owltopia-partner` access), not the Railway mention-reply worker.

## What already exists

| Capability | Where |
|---|---|
| Partner Pro guild access | `assertDiscordPartnerCommandAccess` + `/owltopia-partner` |
| Discord → Solana wallet link | `wallet_profiles.discord_user_id`, `/owltopia-shop connect-wallet` |
| Multi-phase allowlists (Team / OG / WL / WL2 / WL3) | `partner_allowlist_phases` on `owl_center_launches` |
| Per-launch, per-phase wallet list + mint spots | `owl_center_launch_wl_wallets` |
| Creator paste / remove wallets | `CreatorWlWalletsPanel` + `GET/POST/DELETE /api/owl-center/launches/[id]/wl-wallets` |
| Partner raffle CSV export pattern | `/partners/dashboard` entrant CSV |

Collection today is **paste-only**. There is no Discord campaign, no close/open, and no wallet export from the allowlist panel.

## Product model: a “spot” is a campaign

A **campaign** is one collectible list in one Discord channel, mapped to one allowlist **phase**.

Examples in the same partner server:

- `#og-wl` campaign, phase `og`, cap 100, required role `@OG`
- `#public-wl` campaign, phase `wl`, cap 500, no role gate
- `#team` campaign, phase `team`, cap 20, required role `@Team`

Partners can run several campaigns at once. Closing one does not close the others.

```text
Partner (Partner Pro, linked Discord)
  → /owltopia-wl create  (or /owltopia-partner wl-create)
  → bot posts embed + “Submit wallet” in the chosen channel
Member
  → clicks button (ephemeral)
  → linked wallet one-click, or modal with a Solana address
  → unique (campaign, discord user) and (campaign, wallet)
Partner
  → close (freeze + update embed)
  → export CSV / copy wallets
  → optional: push into Owl Center launch phase
```

**Owl Center remains the mint source of truth.** Discord campaigns are an intake pipe. Mint eligibility still reads `owl_center_launch_wl_wallets` during the allowlist window.

Campaigns may be:

1. **Unlinked** — collect now, export later (CSV or paste into Manage collection).
2. **Linked** — `launch_id` + `phase_key` set at create (or later). Close or “Push” upserts into `owl_center_launch_wl_wallets`.

## Member submit UX (security first)

**Preferred (hybrid):**

1. Button on the campaign embed (not a slash the member has to discover).
2. If `wallet_profiles` already has a Discord-linked wallet → ephemeral confirm: “Register `7xK4…AbCd` for OG?”
3. Else open a Discord **modal** (`Solana wallet address`) and validate with `normalizeSolanaWalletAddress`.
4. Optional secondary: “Link wallet on Owltopia” using the existing HMAC connect-wallet link, then they can resubmit.

**Reject:**

- “Drop your wallet in chat”
- Collecting private keys / seed phrases (never)
- Trusting an unvalidated string
- Showing the full wallet in the public embed (count + “you’re in” ephemeral only)

## Partner commands

Keep `/owltopia-partner` for billing/webhooks. Add a dedicated group so the partner command does not grow further:

`/owltopia-wl` — same Partner Pro + guild-match gate as `/owltopia-partner`.

| Subcommand | Who | What |
|---|---|---|
| `create` | partner | name, phase (`og` / `wl` / …), max entries, spots per wallet, optional Discord role, optional launch slug, channel |
| `open` | partner | post or re-enable the embed + button |
| `close` | partner | freeze submissions, update embed to Closed |
| `status` | partner | count / cap / phase / linked launch / open-closed |
| `list` | partner | campaigns in this guild |
| `export` | partner | CSV (wallet, discord user, phase, submitted_at) + copy-paste wallet block |
| `push` | partner | upsert closed (or current) list into linked Owl Center phase |
| `remove` | partner | remove one wallet or one Discord user from an open/closed campaign |

Members never need a slash command for v1.

### Create options (v1)

- `name` — shown on the embed
- `phase` — `team` \| `og` \| `wl` \| `wl2` \| `wl3` (same keys as `PARTNER_ALLOWLIST_PRESETS`)
- `channel` — where the embed lives
- `max` — optional cap (close auto when full, or reject new submits)
- `spots` — `allowed_mints` when pushed to Owl Center (default 1)
- `role` — optional Discord role required to submit
- `launch` — optional Owl Center launch slug/id

### Close semantics

- Status `closed`; button disabled or replaced with “Whitelist closed”
- Submissions frozen; export and push still work
- Re-open is allowed until `push` (or until mint WL window starts, if linked) — call this out in the embed so partners do not treat close as irreversible unless they want that

**Recommendation:** `close` is reversible (`open` again). `push` is additive upsert into Owl Center (does not delete wallets already on the launch list). Document that mint-time list = Owl Center, not the Discord campaign.

## Data model (API-only, deny-all RLS)

Two tables, service_role only — same pattern as `owl_center_launch_wl_wallets` and Discord marketplace.

### `discord_wl_campaigns`

- `id` bigint generated always as identity primary key
- `discord_guild_id` text not null
- `partner_tenant_id` text not null (FK to giveaway partner tenant)
- `channel_id` text not null
- `message_id` text (posted embed)
- `name` text not null
- `phase_key` text not null default `'wl'` (normalized like Owl Center)
- `launch_id` uuid null references `owl_center_launches(id)` on delete set null
- `status` text not null check in (`draft`, `open`, `closed`)
- `max_entries` int null check > 0
- `spots_per_wallet` int not null default 1 check >= 1
- `required_role_id` text null
- `created_by_wallet` text not null
- `created_by_discord_user_id` text not null
- `opened_at` / `closed_at` timestamptz
- `created_at` / `updated_at` timestamptz

Indexes: `(discord_guild_id, status)`, `(launch_id)` (FK), `(partner_tenant_id)` (FK).

### `discord_wl_submissions`

- `id` bigint generated always as identity primary key
- `campaign_id` bigint not null references `discord_wl_campaigns(id)` on delete cascade
- `discord_user_id` text not null
- `discord_username` text
- `wallet` text not null (canonical base58)
- `source` text not null check in (`linked_wallet`, `modal`)
- `created_at` timestamptz not null default now()
- unique `(campaign_id, discord_user_id)`
- unique `(campaign_id, wallet)`

Indexes: `(campaign_id, created_at desc)`, `(wallet)`.

**Rules:**

- One Discord user → one wallet per campaign (update-in-place while open if we allow wallet change; v1: reject second submit)
- One wallet → one Discord user per campaign (blocks two accounts parking the same address)
- Cap: `count(*)` vs `max_entries` in the insert path (unique constraint + count check; accept rare overfill of 1 under race, or use a serializable/advisory lock later)

Do **not** write Discord submissions straight into `owl_center_launch_wl_wallets` on every click unless the campaign is linked **and** the partner opted into live-sync. Default is collect → close → push/export so partners can clean the list.

## Bot / API touchpoints

Discord interactions today only handle **application commands** (type 2). Buttons (type 3) and modal submit (type 5) currently return “Unsupported interaction type.” That must change.

1. `lib/discord-slash-command-definitions.ts` — `OWLTOPIA_WL_SLASH_COMMAND`
2. `app/api/discord/interactions/route.ts` — route MESSAGE_COMPONENT + MODAL_SUBMIT (can defer like commands)
3. New `lib/discord-wl-handle-interaction.ts` — create/open/close/status/list/export/push + button/modal
4. New `lib/db/discord-wl-campaigns.ts` — CRUD, submit, list for export
5. `lib/discord-partner-command-access.ts` — reuse as-is
6. Owl Center: `POST` existing `wl-wallets` from push (same `bulkUpsertLaunchWlWallets`)
7. Optional dashboard: Partners dashboard card + Owl Center “Import from Discord” on `CreatorWlWalletsPanel`
8. Export CSV on the web (more reliable than Discord’s 8 MB follow-up attachment); Discord `export` can send a dashboard link + first N wallets in an ephemeral message

Register the new command the same way `/owltopia-partner` / `/owltopia-shop` are published globally.

The Railway **reply bot** stays out of this. It has no partner tenant context and should not parse wallets from chat.

## Owl Center export / import

Partners said they want addresses “for our center.” Two outputs:

1. **CSV** — `wallet,phase_key,discord_user_id,discord_username,submitted_at,spots`  
   Same idea as raffle entrant CSV on `/partners/dashboard`.
2. **Push** — `bulkUpsertLaunchWlWallets` with `phase_key` + `allowed_mints = spots_per_wallet`.  
   Creator panel already consumes that table for mint gating.

Nice-to-have on `CreatorWlWalletsPanel`: **Copy wallets** / **Download CSV** for the current phase (useful even without Discord). Cheap, and unblocks partners who still paste from Twitter/Sheets.

## Phases to ship

### 1 — Collect + close + export (unlinked)

- Tables + RLS deny-all
- `/owltopia-wl create | open | close | status | list`
- Channel embed + Submit button + modal / linked-wallet confirm
- Unique user + unique wallet
- Optional max + optional Discord role
- Export: dashboard CSV + ephemeral wallet dump
- Copy-wallets on Owl Center allowlist panel

**Acceptance:** Partner Pro in a linked guild opens a spot, members submit valid Solana addresses privately, partner closes, downloads a clean wallet list.

### 2 — Push into Owl Center phases

- Optional `launch` on create (must be a launch the partner wallet can edit)
- `push` upserts into `owl_center_launch_wl_wallets` for that `phase_key`
- Owl Center panel: “Imported from Discord · N wallets” + refresh
- Guard: phase must exist on the launch (`resolvePartnerAllowlistPhases`)

**Acceptance:** Closed OG campaign appears on the launch OG list and is mint-gated in the OG window.

### 3 — Polish (only if 1–2 stick)

- Live-sync while open (submit → immediate upsert)
- Partner can change a member’s wallet while open
- Auto-close at `max_entries`
- Multiple buttons on one embed (OG | WL) as an alternative to one campaign per phase
- Reply-bot FAQ: “how do I get on WL?” → “use the Submit wallet button in the WL channel”

## Risks and decisions

| Risk | Mitigation |
|---|---|
| Phishing / fake “send SOL to confirm” | Official bot embed only; never ask for seed or payment to join WL |
| Invalid / EVM addresses | `normalizeSolanaWalletAddress` before insert |
| Sybil (alts) | Unique wallet per campaign; role gate for OG/Team; this is not a KYC product |
| Discord 3s timeout | Keep defer + PATCH `@original` (already used) |
| Large exports | Web CSV, not Discord attachment as the only path |
| Duplicate source of truth | Mint reads Owl Center only; Discord is intake |
| Partner command sprawl | New `/owltopia-wl` group, same access helper |
| Button interactions unimplemented | Must extend `/api/discord/interactions` beyond type 2 |

**Spots per wallet:** Discord collection defaults to 1 mint spot. Partners who need 2+ set `spots` on create; push writes `allowed_mints`. Do not let members request extra spots in v1.

**Phase keys:** Reuse `PARTNER_ALLOWLIST_PRESETS` (`team`, `og`, `wl`, `wl2`, `wl3`). Custom labels can wait; Owl Center already maps key → label.

## Out of scope (v1)

- On-chain merkle upload from Discord (Owl Center / Candy Machine stays on the creator dashboard)
- Cross-server campaigns
- Paying USDC to join a whitelist
- Replacing the Owl Center paste panel
- Gen2 platform WL (`gen2_whitelist_wallets`) — that is Owltopia-operated, not partner collection

## Test plan (when implementing)

Automated:

- Wallet parse / reject EVM and junk (`normalizeSolanaWalletAddress`)
- Unique discord user + unique wallet per campaign
- Close rejects new submits; re-open allows them
- Role gate deny
- Cap behavior
- Push maps `phase_key` + `spots_per_wallet` into `bulkUpsertLaunchWlWallets`
- Partner access: non-Pro and wrong guild denied

Manual:

- Create + open in a Partner Pro test guild
- Submit via modal and via linked wallet
- Close updates the public embed
- Export CSV opens on dashboard
- Push shows wallets in Manage collection for that phase
