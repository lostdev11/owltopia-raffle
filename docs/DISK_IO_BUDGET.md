# Disk IO budget (Owl Raffle / Supabase)

Supabase emails about **Disk IO Budget** mean the project is bursting past its compute tier’s baseline disk performance. Once the budget is gone, latency rises and the instance can feel unresponsive.

Dashboard: [Database Health](https://supabase.com/dashboard/project/mijcrutmzpzjylezanlk/observability/database)  
Guide: [High Disk I/O](https://supabase.com/docs/guides/troubleshooting/exhaust-disk-io)

## What was burning IO in this app

1. **Raffle list / partner carousel** polled `GET /api/entries?raffleId=…` for **every active raffle** (~every 10s), each loading **all** entry rows (`select *`, paginated) and often triggering **background verify writes**.
2. **Admin client health check** ran an exact `COUNT(*)` on `raffles` every 60s.
3. **Live activity** fallback polled recent confirmed entries with no shared cache; global raffles refetch also did heavy holder enrichment.
4. Missing indexes for common `ORDER BY created_at` / `verified_at` patterns.

## Fixes in code (migration 210+)

| Change | Effect |
|--------|--------|
| `GET /api/entries/summaries` + SQL RPC `summarize_entries_for_raffle_ids` | One aggregate query for list/carousel polls |
| Auto-verify on `GET /api/entries` opt-in only (`verifyPending=1`) | Polls no longer amplify writes |
| Admin health check → `select id limit 1` | Stops table-count Disk IO |
| Slower list/detail/live-activity poll intervals | Fewer reads per open tab |
| Live activity `Cache-Control` + `/api/raffles?lite=true` | Less repeated work |
| Indexes on entries / staking_positions | Cheaper hot reads |

## Apply migration 210 (required)

Run in the Supabase SQL editor for project `mijcrutmzpzjylezanlk`, or via CLI against production:

```bash
# contents of:
# supabase/migrations/210_disk_io_entry_summaries_and_indexes.sql
```

Until the RPC exists, the summaries API uses a **narrow-select fallback** (still better than N× full dumps). Apply 210 for the real aggregate path + indexes.

## After deploy — still high?

1. Check [Disk IO consumption](https://supabase.com/dashboard/project/mijcrutmzpzjylezanlk/observability/database) (hourly/daily).
2. In SQL, inspect slow queries (`pg_stat_statements`) — see Supabase “examining query performance”.
3. If traffic is high and cache hit rate is low, **upgrade compute** (larger tiers have higher baseline Disk IO; 4XL+ is more consistent).
4. Avoid leaving Owl Vision admin open with auto-refresh — those panels still scan large entry samples.
