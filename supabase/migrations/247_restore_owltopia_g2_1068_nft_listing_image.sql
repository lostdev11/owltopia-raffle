-- Restore listing art for Owltopia G2 #1068 from Helius/DAS (mint FDesST98…).
-- Scoped by mint so we do not hardcode the raffle row UUID.
UPDATE public.raffles
SET image_url = 'https://arweave.net/uS-jYo7CF-du8BVru0g4Csrpd-OauzyI08NyUu7b7TA',
    updated_at = now()
WHERE prize_type = 'nft'
  AND nft_mint_address = 'FDesST98hCM9MuMxjNgN1jiN2QPZWKRDPF7ax2K4M6wN'
  AND (image_url IS NULL OR image_url IN ('/icon.png', '/logo.gif'));
