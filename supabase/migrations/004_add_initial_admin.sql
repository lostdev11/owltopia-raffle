-- Ensure admins table exists (in case migration 003 hasn't been run)
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_admins_wallet ON admins(wallet_address);

-- Enable Row Level Security if not already enabled
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- Create RLS policies if they don't exist
DO $$
BEGIN
  -- Allow SELECT for admin checks
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'admins' 
    AND policyname = 'Allow admin status checks'
  ) THEN
    CREATE POLICY "Allow admin status checks" ON admins
      FOR SELECT USING (true);
  END IF;

  -- Block INSERT from client
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'admins' 
    AND policyname = 'No public write access to admins'
  ) THEN
    CREATE POLICY "No public write access to admins" ON admins
      FOR INSERT WITH CHECK (false);
  END IF;

  -- Block UPDATE from client
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'admins' 
    AND policyname = 'No public update access to admins'
  ) THEN
    CREATE POLICY "No public update access to admins" ON admins
      FOR UPDATE USING (false);
  END IF;

  -- Block DELETE from client
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'admins' 
    AND policyname = 'No public delete access to admins'
  ) THEN
    CREATE POLICY "No public delete access to admins" ON admins
      FOR DELETE USING (false);
  END IF;
END $$;

-- Change created_by in raffles table from UUID to TEXT if not already changed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'raffles' 
    AND column_name = 'created_by' 
    AND data_type = 'uuid'
  ) THEN
    ALTER TABLE raffles ALTER COLUMN created_by TYPE TEXT;
  END IF;
END $$;

-- Add initial admin wallet addresses
INSERT INTO admins (wallet_address, created_at)
VALUES 
  ('FuknitCEim3gKsYAMnnqGD3MxnhrMecAWFPLjkZRaTHn', NOW()),
  ('qg7pNNZq7qDQuc6Xkd1x4NvS2VM3aHtCqHEzucZxRGA', NOW())
ON CONFLICT (wallet_address) DO NOTHING;
