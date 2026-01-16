-- Create admins table to track admin wallet addresses
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_admins_wallet ON admins(wallet_address);

-- Enable Row Level Security
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- RLS policies for admins table
-- Allow SELECT for admin checks (needed for API to verify admin status)
-- Block INSERT/UPDATE/DELETE from client (must use service role)
CREATE POLICY "Allow admin status checks" ON admins
  FOR SELECT USING (true);

CREATE POLICY "No public write access to admins" ON admins
  FOR INSERT WITH CHECK (false);

CREATE POLICY "No public update access to admins" ON admins
  FOR UPDATE USING (false);

CREATE POLICY "No public delete access to admins" ON admins
  FOR DELETE USING (false);

-- Change created_by in raffles table from UUID to TEXT to store wallet addresses
ALTER TABLE raffles ALTER COLUMN created_by TYPE TEXT;

-- Note: Admin checks for raffle creation/updates are handled at the API level
-- The existing RLS policies in 001_initial_schema.sql allow reads for everyone
-- Write operations (INSERT/UPDATE) are protected by API-level admin checks
