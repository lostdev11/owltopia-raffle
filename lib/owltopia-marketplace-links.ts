/**
 * Official Owltopia collection marketplace URLs (footer / social glass pickers).
 * GEN2 Magic Eden uses the on-chain collection mint (ME resolves it as Owltopia G2).
 */
export const OWLTOPIA_GEN2_COLLECTION_MINT = 'GkLgT4KuwAPKeMSzfcPPmzuGimRNPvK1FWNPks4kzFVA'

export type OwltopiaMarketplaceCollection = {
  label: string
  magicEdenUrl: string
  orbisUrl: string
}

export const OWLTOPIA_MARKETPLACE_COLLECTIONS: OwltopiaMarketplaceCollection[] = [
  {
    label: 'GEN1',
    magicEdenUrl: 'https://magiceden.io/marketplace/owltopia',
    orbisUrl: 'https://www.orbisonsol.io/marketplace/owltopia',
  },
  {
    label: 'GEN2',
    magicEdenUrl: `https://magiceden.io/marketplace/${OWLTOPIA_GEN2_COLLECTION_MINT}`,
    orbisUrl: 'https://www.orbisonsol.io/marketplace/owltopia-g2',
  },
  {
    label: 'Owltopia Coins',
    magicEdenUrl: 'https://magiceden.io/marketplace/owltopia_coins',
    orbisUrl: 'https://www.orbisonsol.io/marketplace/owltopia-coins',
  },
]

export const OWLTOPIA_MAGIC_EDEN_COLLECTION_LINKS = OWLTOPIA_MARKETPLACE_COLLECTIONS.map((c) => ({
  label: c.label,
  href: c.magicEdenUrl,
}))

export const OWLTOPIA_ORBIS_COLLECTION_LINKS = OWLTOPIA_MARKETPLACE_COLLECTIONS.map((c) => ({
  label: c.label,
  href: c.orbisUrl,
}))
