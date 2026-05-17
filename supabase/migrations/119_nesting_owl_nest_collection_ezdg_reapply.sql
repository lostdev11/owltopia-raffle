-- Re-apply canonical Owltopia coin collection on owl-nest-365 (idempotent if 106 already ran).
UPDATE public.staking_pools
SET
  collection_key = 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB',
  updated_at = NOW()
WHERE slug = 'owl-nest-365'
  AND (
    collection_key IS NULL
    OR collection_key = '9KLamQmRoZsB9ymyLAvSDGYvd6yku7oCaUyxCYXFfwsx'
  );
