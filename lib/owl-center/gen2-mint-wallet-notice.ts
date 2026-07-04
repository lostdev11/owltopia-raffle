/** Copy for Gen2 mint wallet preview — scanners often false-flag frozen Candy Machine mints. */

export const GEN2_MINT_WALLET_NOTICE_HEADLINE = 'What your wallet may show when you mint'

export const GEN2_MINT_WALLET_NOTICE_SUMMARY =
  'Owltopia Gen2 mints are frozen NFTs (tradeable after mint-out). Some wallets — especially Jupiter — show scary red warnings about “mint authority” or “freeze authority.” That is usually a false alarm for this mint, not a hack.'

export const GEN2_MINT_WALLET_NOTICE_BULLETS = [
  'You pay SOL (~$40 public mint + ~$1 platform fee + rent/network). You receive one Gen2 NFT.',
  'The NFT mints frozen on purpose until the team thaws the collection at mint-out.',
  'Wallets may label the freeze step as “transfer authority” or “spend permission” — they mean the new NFT’s freeze lock, not your existing tokens.',
  'You are not giving anyone unlimited mint power over tokens already in your wallet.',
] as const

export const GEN2_MINT_WALLET_NOTICE_TIPS = [
  'If the preview only shows SOL out and +1 NFT, it matches a normal mint.',
  'Phantom or Solflare often show a clearer preview than Jupiter for Candy Machine mints.',
  'Cancel if you are not on owltopia.xyz or the tx asks to approve something unrelated to minting.',
] as const
