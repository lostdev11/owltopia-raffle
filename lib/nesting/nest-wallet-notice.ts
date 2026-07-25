/** Quiet pre-sign copy — matches how Phantom labels nest Approve (matter-of-fact, not alarming). */

export const NEST_WALLET_NOTICE_HEADLINE = 'What you are approving'

export const NEST_WALLET_NOTICE_SUMMARY =
  'Your wallet will ask you to approve a lock on each selected owl. The NFTs stay in your wallet — they are only frozen for the nest period. Owltopia never takes custody.'

export const NEST_WALLET_NOTICE_BULLETS = [
  'Phantom may list each owl as “Approve to transfer” — that is the freeze lock, not sending the NFT away.',
  'A small SOL platform fee may show in the same confirmation when fees are enabled.',
  'Other wallets may word the same step differently; the action is still the nest lock on owltopia.xyz.',
] as const

/** Helps users recognize the address their wallet shows for the nest lock. */
export function nestWalletNoticeDelegateLine(delegateAddress: string): string {
  return `Nest lock address: ${delegateAddress}`
}
