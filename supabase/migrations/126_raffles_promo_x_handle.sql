-- Optional X @handle for official Owltopia share copy (NFT / promo line in #x-post).
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS promo_x_handle text;

COMMENT ON COLUMN raffles.promo_x_handle IS
  'Optional X handle (no @) for admin share template, e.g. THC_Labz → NFT: @THC_Labz';
