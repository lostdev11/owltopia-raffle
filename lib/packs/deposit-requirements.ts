export type PackDepositRequirement = {
  id: 'vault' | 'wallet' | 'selection' | 'floors' | 'busy'
  label: string
  met: boolean
}

export function packDepositRequirements(input: {
  vaultAddress: string | null
  walletConnected: boolean
  pendingCount: number
  allFloorsValid: boolean
  busy: boolean
}): PackDepositRequirement[] {
  return [
    {
      id: 'vault',
      label: 'Packs vault is configured (Admin env: PACKS_VAULT_SECRET_KEY)',
      met: Boolean(input.vaultAddress),
    },
    {
      id: 'wallet',
      label: 'Wallet connected in this browser',
      met: input.walletConnected,
    },
    {
      id: 'selection',
      label: 'At least one NFT selected to deposit',
      met: input.pendingCount > 0,
    },
    {
      id: 'floors',
      label: 'Each selected NFT has a floor between 0.05 and 0.5 SOL',
      met: input.pendingCount === 0 || input.allFloorsValid,
    },
    {
      id: 'busy',
      label: 'Not already sending a deposit',
      met: !input.busy,
    },
  ]
}

export function packDepositDisabledReason(input: {
  vaultAddress: string | null
  walletConnected: boolean
  pendingCount: number
  allFloorsValid: boolean
  busy: boolean
}): string | null {
  const requirements = packDepositRequirements(input)
  const unmet = requirements.find((r) => !r.met)
  if (!unmet) return null
  if (unmet.id === 'vault') {
    return 'Deposit is unavailable until the packs vault is configured. Set PACKS_VAULT_SECRET_KEY and NEXT_PUBLIC_PACKS_VAULT_WALLET, then refresh.'
  }
  if (unmet.id === 'wallet') {
    return 'Connect the wallet that holds the prize NFTs to enable deposit.'
  }
  if (unmet.id === 'selection') {
    return 'Load your wallet NFTs, select at least one, then deposit.'
  }
  if (unmet.id === 'floors') {
    return 'Set a valid floor (0.05–0.5 SOL) on every selected NFT before depositing.'
  }
  if (unmet.id === 'busy') {
    return 'Wait for the current deposit to finish.'
  }
  return unmet.label
}

/** Map wallet / RPC errors to actionable copy for pack inventory deposit. */
export function formatPackDepositError(message: string): string {
  const m = message.toLowerCase()
  if (
    m.includes('expired') ||
    m.includes('blockhash') ||
    m.includes('signature has expired')
  ) {
    return (
      'The wallet transaction expired before it was approved. Refresh the page, confirm Phantom is on the same network as this site, and approve quickly. If it keeps failing, try Solflare or switch Wi‑Fi/mobile data.'
    )
  }
  if (
    m.includes('matching collection') ||
    m.includes('missing collection') ||
    m.includes('0x19')
  ) {
    return (
      'This NFT’s collection metadata did not match what the wallet expected for transfer. Try loading NFTs from wallet instead of pasting an address, or pick a different NFT. Core collection NFTs may need collection approval from the creator.'
    )
  }
  if (m.includes('noapprovals') || m.includes('0x1a')) {
    return (
      'This Metaplex Core NFT cannot transfer until its collection plugins approve the move. Use a different NFT or ask the collection team how to enable transfers to custody wallets.'
    )
  }
  return message
}
