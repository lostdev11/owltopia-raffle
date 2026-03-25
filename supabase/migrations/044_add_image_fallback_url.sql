-- Optional image URL set by full admins when primary NFT listing art fails to load (broken IPFS, etc.)
ALTER TABLE raffles ADD COLUMN IF NOT EXISTS image_fallback_url TEXT;

COMMENT ON COLUMN raffles.image_fallback_url IS 'Admin-only fallback artwork URL when image_url fails or is empty.';
