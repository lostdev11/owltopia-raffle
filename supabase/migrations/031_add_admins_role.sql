-- Add role to admins: 'full' (default) or 'raffle_creator'
-- raffle_creator can only create raffles; full can access Owl Vision and all admin actions
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'full'
    CHECK (role IN ('full', 'raffle_creator'));

COMMENT ON COLUMN admins.role IS 'full: full Owl Vision access; raffle_creator: create raffles only';
