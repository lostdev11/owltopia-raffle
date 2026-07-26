/** Quiet pre-sign copy — matter-of-fact, not alarming (wallets often word freeze locks harshly). */

export const NEST_WALLET_NOTICE_HEADLINE = 'What you are approving'

export const NEST_WALLET_NOTICE_SUMMARY =
  'Your wallet will ask you to approve a lock on each selected owl. The NFTs stay in your wallet — they are only frozen for the nest period. Owltopia never takes custody.'

export const NEST_WALLET_NOTICE_BULLETS = [
  'Phantom may list each owl as “Approve to transfer” — that is the freeze lock, not sending the NFT away.',
  'Jupiter can show a much scarier warning for the same step. That is still the nest freeze on owltopia.xyz — cancel if you are not on this site.',
  'Phantom and Solflare usually word this more clearly; a small SOL platform fee may show when fees are enabled.',
] as const

/** Helps users recognize the address their wallet shows for the nest lock. */
export function nestWalletNoticeDelegateLine(delegateAddress: string): string {
  return `Nest lock address: ${delegateAddress}`
}
