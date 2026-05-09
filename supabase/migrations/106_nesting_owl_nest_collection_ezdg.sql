-- Point canonical Owl Nest perch DAS / wallet picker at the on-chain collection mint.
UPDATE public.staking_pools
SET
  collection_key = 'EZdgJQao3v33F723EsC1QqfwvuDRyVkCMsZTW8Z6JTpB',
  updated_at = NOW()
WHERE slug = 'owl-nest-365';
