const REASON_LABELS: Record<string, string> = {
  wallet_required: 'Enter or connect a wallet to check',
  not_gen1_holder: 'No Owltopia Gen1 NFT detected on this wallet (check collection + Helius)',
  gen1_on_linked_wallet: 'Gen1 NFT is on a linked wallet — connect the wallet that holds your Gen1 to mint',
  gen1_collection_not_configured: 'Server missing OWLTOPIA_COLLECTION_ADDRESS — contact support',
  gen1_pool_exhausted: '343 GEN1 mint cap reached globally',
  gen1_mint_limit: 'GEN1 mint limit reached for this wallet',
  not_presale_participant: 'This wallet did not pay during presale',
  no_paid_presale_credits: 'No paid presale credits left to mint',
  no_presale_credits: 'No presale credits left to mint',
  presale_credits_in_overage_phase: 'Presale+13 credits — mint when Presale+13 phase is live',
  no_presale_allocation: 'No presale allocation',
  presale_pool_exhausted: '657 presale mint cap reached globally',
  wl_pool_exhausted: '800 WL mint cap reached globally',
  not_on_overage_list: 'Not on Presale+13 list (spots 658–670)',
  overage_pool_exhausted: 'All 13 overshoot spots minted',
  not_whitelisted: 'Not on WL mint list — admin-added wallets appear here once spots are assigned',
  wl_on_linked_wallet: 'WL spots are on a linked wallet — connect the wallet with your WL allocation',
  wl_pending_allocation: 'On Discord WL — mint slots not assigned yet (admin assigns spots before WL opens)',
  wallet_mint_limit: 'Wallet mint limit reached',
}

export function reasonLabel(reason: string | null): string {
  if (!reason) return ''
  return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ')
}
