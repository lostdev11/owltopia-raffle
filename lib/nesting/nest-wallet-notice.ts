/** Quiet pre-sign copy — matter-of-fact, not alarming (wallets often word freeze locks harshly). */

export const NEST_WALLET_NOTICE_HEADLINE = 'What you are approving'

export const NEST_WALLET_NOTICE_SUMMARY =
  'Your wallet will ask you to approve a freeze on each selected owl. The NFTs stay in your wallet — they are only frozen for the nest period. Owltopia never takes custody.'

export const NEST_WALLET_NOTICE_BULLETS = [
  'What actually happens: each owl is frozen for the nest — not transferred, not sold, not moved to another wallet.',
  'Jupiter often shows a red “flagged as malicious” warning and says Owltopia gets “permission to spend your tokens… even after you leave this app.” That is Jupiter’s scanner reacting to the nest freeze Approve step — the same lock every Gen 2 nest uses — not a report that Owltopia is a scam.',
  'That “permission” is only the nest freeze delegate on the owls you selected (amount 1 per NFT). It lets Owltopia freeze/thaw for the nest; it does not move SOL, USDC, or other tokens out of your wallet.',
  'Phantom often still shows “Approve to transfer” for that freeze step. That label is Phantom’s; cancel if the site is not owltopia.xyz.',
  'Phantom can also show a red “This dApp could be malicious” banner. Same idea as Jupiter: automatic scanner on approve/freeze, not a separate Owltopia report.',
  'Before you approve: check the site is owltopia.xyz, the owl list matches what you selected, the nest freeze address below matches what your wallet shows, and the SOL leaving matches the nest fee above.',
] as const

/** Helps users recognize the address their wallet shows for the nest lock. */
export function nestWalletNoticeDelegateLine(delegateAddress: string): string {
  return `Nest freeze address: ${delegateAddress}`
}
