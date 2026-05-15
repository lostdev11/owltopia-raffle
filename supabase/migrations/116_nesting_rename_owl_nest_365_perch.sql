-- Rename canonical Owltopia coin perch for public nesting UI.
UPDATE public.staking_pools
SET
  name = 'Owltopia Coins NFT',
  updated_at = NOW()
WHERE slug = 'owl-nest-365';
