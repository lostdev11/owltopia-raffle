-- Set Owl Nest collection / grouping pubkey on canonical perch (Helius DAS wallet picker).
UPDATE public.staking_pools
SET
  collection_key = '9KLamQmRoZsB9ymyLAvSDGYvd6yku7oCaUyxCYXFfwsx',
  updated_at = NOW()
WHERE slug = 'owl-nest-365';
