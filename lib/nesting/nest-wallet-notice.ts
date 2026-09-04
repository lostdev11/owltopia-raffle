/** Quiet pre-sign copy — matter-of-fact, not alarming (wallets often word freeze locks harshly). */

export const NEST_WALLET_NOTICE_HEADLINE = 'What you are approving'

export const NEST_WALLET_NOTICE_SUMMARY =
  'Your wallet will ask you to approve a freeze on each selected owl. The NFTs stay in your wallet — they are only frozen for the nest period. Owltopia never takes custody.'

/** Always-visible one-liner for Jupiter / Phantom Mobile “spend tokens” banners. */
export const NEST_WALLET_NOTICE_TEASER =
  'Jupiter or Phantom may say a wallet “can spend tokens from your wallet.” That is their label for the nest freeze Approve on the owl you selected — not a blank check on your SOL or other tokens, and not spending after you disconnect the site.'

export const NEST_WALLET_NOTICE_BULLETS = [
  'What actually happens: each owl is frozen for the nest — not transferred, not sold, not moved to another wallet.',
  'Jupiter often shows “can spend tokens from your wallet.” That wording means the nest freeze key can lock that one NFT (amount 1). It cannot drain your wallet or other tokens.',
  'Phantom often still shows “Approve to transfer” for that freeze step. That label is Phantom’s; cancel if the site is not owltopia.xyz.',
  'Phantom can also show a red “This dApp could be malicious” banner. That is its automatic scanner reacting to the approve/freeze step, not a report about Owltopia.',
  'Disconnecting the site ends the browser connection. The nest freeze stays on that owl until you leave the nest (by design). After you leave, we ask you to clear the leftover Approve so wallets stop warning.',
  'Before you approve: check the site is owltopia.xyz, the owl list matches what you selected, and the SOL leaving matches the nest fee above.',
] as const

/** Helps users recognize the address their wallet shows for the nest lock. */
export function nestWalletNoticeDelegateLine(delegateAddress: string): string {
  return `Nest freeze address: ${delegateAddress}`
}
