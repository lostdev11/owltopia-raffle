# Owltopia Flight League MVP

## Route

- Public URL: `/race`
- Development branch: `feat/owl-race-mvp-phase-0`

## Feature access

Set `NEXT_PUBLIC_RACE_ACCESS_MODE` to one of:

- `off`: staged route only; no playable access.
- `admin`: Owltopia admin SIWS sessions can preview the route.
- `public`: the route and navigation item are public.

Development defaults to `public`. Production defaults to `off` when the
variable is omitted.

## Identifier conventions

- Course IDs: lowercase kebab case with a two-digit revision suffix.
  - Example: `forest-run-01`
- Season IDs: lowercase kebab case with a two-digit sequence suffix.
  - Example: `preseason-01`
- Course revisions must change when geometry or checkpoint placement affects
  leaderboard fairness.

## Public configuration

- `NEXT_PUBLIC_RACE_ELIGIBLE_COLLECTIONS`: comma-separated collection
  addresses used by the holder gate.
  - Gen 2: `GkLgT4KuwAPKeMSzfcPPmzuGimRNPvK1FWNPks4kzFVA`
  - Additional eligible Owltopia collection:
    `CLbUSk7m4wjwzom7xD9HRwtfkAoUB1BfwAXRnaY8ANmg`
- `NEXT_PUBLIC_RACE_DEFAULT_COURSE_ID`: current course identifier.
- `NEXT_PUBLIC_RACE_DEFAULT_SEASON_ID`: current season identifier.
- `NEXT_PUBLIC_OWL_MINT_ADDRESS`: existing OWL utility token mint.

Collection and mint addresses are public on-chain identifiers. Treasury
secrets, signers, and RPC API keys must remain server-only.

## Phase boundaries

Phase 0 establishes the route, navigation, access modes, configuration, and
Three.js dependencies. It does not accept USDC, distribute rewards, or submit
race results.
