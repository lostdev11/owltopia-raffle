# Implementation Plan: Raffles Entered Thumbs + Host Filter

## Overview

Build plan for two Discord `#suggest` requests:

1. **NFT visibility on Raffles entered** (MikeeyGGo) — show prize art in the list so users do not click into every entry.
2. **Filter / sort by host** (Dilll05.sol) — e.g. see all raffles hosted by Devdad.

Feature 1 is mostly wiring data already returned by the API. Feature 2 needs a host identity path (display name → wallet); browse search does not resolve profile names today.

## Spec sources

- Discord suggestions channel: NFT thumbs on raffles entered
- Discord (forwarded from owls-chat): sort/filter by host

## Technical approach

### Feature 1 — NFT thumbs on “Raffles entered”

**Where:** `/raffles?tab=my-entries` → `MyEntriesList`  
**API:** `GET /api/entries/my` → `getEntriesByWallet` already selects `image_url` / `image_fallback_url`, but `RaffleInfoForEntry` and the UI ignore them.

**Approach:**

1. Add `image_url` + `image_fallback_url` to `RaffleInfoForEntry`.
2. Render existing `RaffleListThumbnail` in each entry row (same pattern as cart browse).
3. Keep lazy loading; optional mint-metadata fallback later if empty images show up in the wild.
4. Optionally mirror on dashboard “My entries” for consistency.

**Touchpoints:** `lib/db/entries.ts`, `components/MyEntriesList.tsx` (± dashboard entry list).

### Feature 2 — Filter by host

**Where:** Main browse on `/raffles` (`RafflesBrowseToolbar` + `filter-browse-raffles.ts`).  
Today `q` matches titles/wallets/mints — **not** `wallet_profiles.display_name`. Partner enrichment only covers partner hosts.

**Recommended approach (hybrid):**

1. Add URL param `?host=<wallet>` that filters on `creator_wallet || created_by`.
2. Extend search so host **display names** resolve:
   - Enrich browse list with creator display names (profiles + partner labels), **or**
   - Small lookup: name → wallet(s), then apply wallet filter.
3. Toolbar UX: host field / typeahead (known hosts from loaded list + partners), clear chip when active.
4. Sort-by-host is optional phase 2 polish; filter alone satisfies “see all raffles hosted by X.”
5. Handle ambiguous names (0 / many matches) with a short picker or “N hosts matched” state — display names are not unique.

**Touchpoints:** `filter-browse-raffles.ts`, `RafflesBrowseToolbar.tsx`, `RafflesPageClient.tsx`, profile enrichment (`/api/profiles` or list-time join), possibly `getRafflesByCreator` for deep links.

## Phases

### Phase 1 — Raffles entered thumbnails (ship first)

- [ ] Extend `RaffleInfoForEntry` with image fields
- [ ] Add `RaffleListThumbnail` to `MyEntriesList` (title + status stay primary)
- [ ] Verify crypto prizes still show currency art / placeholders
- [ ] Smoke-test long entry lists (lazy load, layout on mobile)
- [ ] (Optional) Same thumb on dashboard my-entries

**Acceptance:** On Raffles entered, each row shows prize art without opening the raffle.

### Phase 2 — Host filter (wallet + name)

- [ ] Add `host` search param + client/server filter on creator wallets
- [ ] Enrich browse raffles with creator display names (profiles / partners)
- [ ] Include display name in browse search **or** dedicated host typeahead
- [ ] Toolbar: host control + clear; deep link `?host=<wallet>` works
- [ ] Ambiguous name UX (picker / match count)
- [ ] Tests for filter helpers + name→wallet matching

**Acceptance:** User can open all raffles for a host by display name (e.g. Devdad) or wallet; filter is shareable via URL.

### Phase 3 — Polish (if needed)

- [ ] Sort by host name
- [ ] Host filter on My Entries (needs `creator_wallet` / `created_by` on entry raffle select)
- [ ] Mint-metadata image fallback on entry thumbs when DB image is missing

## Dependencies

- Existing `RaffleListThumbnail` + image URL helpers (Feature 1)
- `wallet_profiles.display_name` + `/api/profiles` (Feature 2)
- SIWS session for My Entries (unchanged)
- No schema migration required for either feature if we enrich at query/API time

## Risks and mitigations

### Display names are not unique

Treat the display name as a **lookup key**, not the filter itself.

- Resolve `"Devdad"` → one or more wallets via `wallet_profiles.display_name` (and partner `display_label` as a secondary source).
- Apply the real filter on `creator_wallet || created_by` (same as `getRafflesByCreator`).
- If **0 matches**: empty state + “no host found.”
- If **1 match**: apply `?host=<wallet>` immediately.
- If **N matches**: show a short picker (“Which Devdad?”) with truncated wallet / partner badge, then set `host` to the chosen wallet.

Shareable links always use the wallet (`?host=`), so names never become the source of truth in URLs.

### Partner-only labels today

Do not rely on `enrichRafflesWithCreatorHolder` alone — that only fills partner/admin display fields.

- For browse filtering, enrich **all** creators on the loaded list with `/api/profiles?wallets=…` (already used on raffle detail “Created By”).
- Search/typeahead should match: profile `display_name` → partner `display_label` → wallet substring.
- Keep partner logo/badge as presentation only; filtering stays wallet-based.

### Overloading `q` with host semantics

Keep responsibilities split:

- **`q`**: title, mint, collection, description, etc. (existing behavior). Optionally *also* match enriched display names so typing “Devdad” in search still works — but do not make that the only path.
- **`host`**: explicit wallet filter from typeahead, profile click, or deep link.
- Toolbar: when a host filter is active, show a clear chip (“Host: Devdad ✕”) so it is obvious it is not a free-text title search.

That avoids breaking existing search while giving hosts a first-class control.

### Image load on long entry histories

Reuse what is already built for list density:

- Use `RaffleListThumbnail` with `loading="lazy"` (already supported).
- Phase 1: **DB images only** (`image_url` / `image_fallback_url` already returned by `getEntriesByWallet`) — no per-row mint RPC.
- Fixed thumb size (`sm`/`md`) so layout does not reflow.
- If a later audit shows many missing images, add **batched** mint-metadata fallback (`/api/nft/metadata-image/batch`), not one request per row.

### Name-search performance

Stay on the current browse model first:

- Browse is already a **client-side filter over the loaded list** (`filter-browse-raffles.ts`). Enrich that payload once with display names, then filter in memory — same cost class as today’s `q` / currency / prize filters.
- Only add a server `wallet_profiles` ILIKE lookup if lists get large or you need hosts who are not in the current result set (e.g. ended raffles not loaded).
- Cap typeahead suggestions (e.g. top 8) and debounce input so profile lookups do not fire on every keystroke.

### Additional mitigations

| Concern | Mitigation |
|--------|------------|
| Stale/empty NFT art | Fall back through existing `buildRaffleImageAttemptChain`; crypto prizes already get SOL/USDC art in `RaffleListThumbnail`. |
| Host filter on My Entries later | Add `creator_wallet` / `created_by` to the entry raffle select when doing Phase 3 — do not invent a second host model. |
| Case / whitespace in names | Normalize with trim + case-insensitive match (same as `raffleMatchesBrowseSearch`). |
| Privacy / spoofed names | Filtering by wallet is fine publicly; do not imply display names are verified identities unless partner badges are already shown. |

### Mitigation summary

- **Feature 1:** Prefer DB images + lazy list thumbs in v1; defer mint-metadata batch fallback to Phase 3.
- **Feature 2:** Wallet is the filter primitive; display name is UX only; enrich all creators (not partners only); keep `q` and `host` responsibilities split.

## Suggested ship order

1. **Phase 1** — quick win for Raffles entered thumbs.
2. **Phase 2** — host filter with wallet param + display-name resolution.
3. **Phase 3** — sort / entries-tab host filter / mint image fallback only if still needed.
