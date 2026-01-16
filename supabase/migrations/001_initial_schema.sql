-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create raffles table
CREATE TABLE IF NOT EXISTS raffles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  prize_amount DECIMAL(10, 2) NOT NULL,
  prize_currency TEXT NOT NULL DEFAULT 'SOL',
  ticket_price DECIMAL(10, 6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SOL',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  theme_accent TEXT NOT NULL DEFAULT 'prime' CHECK (theme_accent IN ('prime', 'midnight', 'dawn')),
  edited_after_entries BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  winner_wallet TEXT,
  winner_selected_at TIMESTAMPTZ
);

-- Create entries table
CREATE TABLE IF NOT EXISTS entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raffle_id UUID NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  ticket_quantity INTEGER NOT NULL,
  transaction_signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  amount_paid DECIMAL(10, 6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SOL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_raffles_slug ON raffles(slug);
CREATE INDEX IF NOT EXISTS idx_raffles_is_active ON raffles(is_active);
CREATE INDEX IF NOT EXISTS idx_entries_raffle_id ON entries(raffle_id);
CREATE INDEX IF NOT EXISTS idx_entries_wallet ON entries(wallet_address);
CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
CREATE INDEX IF NOT EXISTS idx_entries_raffle_status ON entries(raffle_id, status);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for raffles
CREATE TRIGGER update_raffles_updated_at BEFORE UPDATE ON raffles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE raffles ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies for raffles (public read, admin write)
CREATE POLICY "Anyone can view active raffles" ON raffles
  FOR SELECT USING (is_active = true);

CREATE POLICY "Anyone can view all raffles" ON raffles
  FOR SELECT USING (true);

-- RLS Policies for entries (users can view their own, admins can view all)
CREATE POLICY "Users can view entries for raffles" ON entries
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own entries" ON entries
  FOR INSERT WITH CHECK (true);
