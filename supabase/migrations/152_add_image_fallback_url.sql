-- Optional image URL when primary listing art fails (broken IPFS, etc.).
-- Numbered 045 because 044 is funds escrow on this branch.

ALTER TABLE raffles ADD COLUMN IF NOT EXISTS image_fallback_url TEXT;

COMMENT ON COLUMN raffles.image_fallback_url IS 'Admin-only fallback artwork URL when image_url fails or is empty.';
