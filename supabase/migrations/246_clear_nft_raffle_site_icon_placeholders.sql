-- NFT raffles that accidentally stored the site brand mark (/icon.png, /logo.gif)
-- as listing art: clear so mint-metadata fallback can resolve real artwork.
UPDATE public.raffles
SET image_url = NULL,
    updated_at = now()
WHERE prize_type = 'nft'
  AND image_url IS NOT NULL
  AND (
    image_url IN ('/icon.png', '/logo.gif')
    OR image_url ~* '/(icon\.png|logo\.gif)$'
  );
