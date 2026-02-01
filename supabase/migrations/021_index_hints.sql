-- Migration 021: Index hints for server-side query optimization
-- DO NOT AUTO-RUN. Review and apply manually if needed.
--
-- These indexes support the refactored DB access patterns:
-- - isAdmin: wallet_address lookup
-- - getRaffles: status filter, created_at order, pagination
-- - generateUniqueSlug: slug lookup and LIKE prefix
--
-- Some indexes may already exist from prior migrations (001, 003, 004, 012).
-- Run: SELECT indexname FROM pg_indexes WHERE tablename = 'admins' OR tablename = 'raffles';
-- to verify before applying.

-- Supports: isAdmin() - SELECT id FROM admins WHERE wallet_address = ?
-- (Already in 003_add_admins_table.sql, 004_add_initial_admin.sql)
-- CREATE INDEX IF NOT EXISTS idx_admins_wallet ON admins(wallet_address);

-- Supports: getRaffleBySlug(), generateUniqueSlug() - slug lookup
-- (Already in 001_initial_schema.sql)
-- CREATE INDEX IF NOT EXISTS idx_raffles_slug ON raffles(slug);

-- Supports: getRaffles() - WHERE is_active = true (if used)
-- (Already in 001_initial_schema.sql)
-- CREATE INDEX IF NOT EXISTS idx_raffles_is_active ON raffles(is_active);

-- Supports: getRaffles() - WHERE status IN (...)
-- (Already in 012_add_min_tickets_and_status.sql)
-- CREATE INDEX IF NOT EXISTS idx_raffles_status ON raffles(status);

-- Supports: getRaffles() - ORDER BY end_time DESC (for "ending soon" style sorts)
-- CREATE INDEX IF NOT EXISTS idx_raffles_end_time_desc ON raffles(end_time DESC);

-- Supports: getRaffles() - ORDER BY created_at DESC (primary list order)
-- CREATE INDEX IF NOT EXISTS idx_raffles_created_at_desc ON raffles(created_at DESC);
