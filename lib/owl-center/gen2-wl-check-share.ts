import { buildGen2MintCheck } from '@/lib/owl-center/gen2-mint-check'
import { PLATFORM_NAME } from '@/lib/site-config'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type Gen2WlCheckShareVariant =
  | 'eligible_active'
  | 'eligible_assigned'
  | 'pending_allocation'
  | 'used_up'
  | 'not_whitelisted'
  | 'invalid_wallet'

export type Gen2WlCheckShareSnapshot = {
  wallet: string | null
  variant: Gen2WlCheckShareVariant
  available_mints: number
  allowed_mints: number
  community: string | null
  wl_phase_active: boolean
  og: {
    title: string
    kindLabel: string
    line1: string
    line2: string
  }
  page: {
    headline: string
    subline: string
  }
  metadata: {
    title: string
    description: string
  }
}

export function gen2WlCheckSharePath(wallet: string): string {
  return `/owl-center/collection/gen2/wl-check/${encodeURIComponent(wallet)}`
}

function shortWallet(w: string): string {
  return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

function spotLabel(n: number): string {
  return `${n} WL spot${n === 1 ? '' : 's'}`
}

export async function buildGen2WlCheckShareSnapshot(walletRaw: string): Promise<Gen2WlCheckShareSnapshot> {
  const wallet = normalizeSolanaWalletAddress(walletRaw.trim())
  if (!wallet) {
    return {
      wallet: null,
      variant: 'invalid_wallet',
      available_mints: 0,
      allowed_mints: 0,
      community: null,
      wl_phase_active: false,
      og: {
        title: 'Gen2 WL check',
        kindLabel: 'Owltopia',
        line1: 'Check Gen2 whitelist status',
        line2: `Connect your wallet on ${PLATFORM_NAME}`,
      },
      page: {
        headline: 'Invalid wallet address',
        subline: 'Use a valid Solana wallet link from the Gen2 mint page.',
      },
      metadata: {
        title: `Gen2 WL check | ${PLATFORM_NAME}`,
        description: 'Check Owltopia Gen2 whitelist mint eligibility.',
      },
    }
  }

  const check = await buildGen2MintCheck(wallet)
  const wl = check?.phases.find((p) => p.phase === 'WHITELIST')
  const avail = wl?.wl?.available_mints ?? 0
  const allowed = wl?.wl?.allowed_mints ?? 0
  const community = wl?.wl?.community ?? null
  const wlActive = wl?.is_active === true
  const discordPending = wl?.wl?.discord_whitelist === true && allowed === 0
  const short = shortWallet(wallet)

  if (discordPending) {
    const headline = 'On the Gen2 Discord WL'
    return {
      wallet,
      variant: 'pending_allocation',
      available_mints: 0,
      allowed_mints: 0,
      community,
      wl_phase_active: wlActive,
      og: {
        title: 'Gen2 WL confirmed',
        kindLabel: 'Discord whitelist',
        line1: 'I’m on the Owltopia Gen2 Discord WL',
        line2: 'Mint slots assigning soon · owltopia.xyz',
      },
      page: {
        headline,
        subline: `${short} · Discord WL verified — watch for mint slot assignment in Owl Center.`,
      },
      metadata: {
        title: `${headline} | ${PLATFORM_NAME}`,
        description: 'Discord Gen2 whitelist verified; mint allocation pending on Owltopia.',
      },
    }
  }

  if (avail > 0) {
    const headline =
      wlActive && wl?.is_eligible
        ? 'Eligible to mint Gen2'
        : 'Gen2 WL mint spots assigned'
    const line1 =
      wlActive && wl?.is_eligible
        ? 'I’m eligible to mint Owltopia Gen2'
        : 'I have Owltopia Gen2 WL mint spots'
    const line2Parts = [spotLabel(avail)]
    if (allowed > avail) line2Parts.push(`${allowed - avail} already minted`)
    if (community) line2Parts.push(community)
    if (wlActive && wl?.is_eligible) line2Parts.push('WHITELIST phase live')
    else line2Parts.push('Mint when WL opens on Owltopia')

    return {
      wallet,
      variant: wlActive && wl?.is_eligible ? 'eligible_active' : 'eligible_assigned',
      available_mints: avail,
      allowed_mints: allowed,
      community,
      wl_phase_active: wlActive,
      og: {
        title: 'Owltopia Gen2',
        kindLabel: 'Whitelist mint',
        line1,
        line2: line2Parts.join(' · '),
      },
      page: {
        headline,
        subline: `${short} · ${avail} spot${avail === 1 ? '' : 's'} left to mint${community ? ` · ${community}` : ''}.`,
      },
      metadata: {
        title: `${headline} | ${PLATFORM_NAME}`,
        description: line1,
      },
    }
  }

  if (allowed > 0 && avail <= 0) {
    return {
      wallet,
      variant: 'used_up',
      available_mints: 0,
      allowed_mints: allowed,
      community,
      wl_phase_active: wlActive,
      og: {
        title: 'Gen2 WL minted',
        kindLabel: 'Owltopia Gen2',
        line1: 'I minted my Owltopia Gen2 WL allocation',
        line2: `${allowed} WL spot${allowed === 1 ? '' : 's'} used · owltopia.xyz`,
      },
      page: {
        headline: 'WL allocation used',
        subline: `${short} · All assigned WL spots have been minted.`,
      },
      metadata: {
        title: `Gen2 WL minted | ${PLATFORM_NAME}`,
        description: 'This wallet used its Owltopia Gen2 whitelist mint allocation.',
      },
    }
  }

  return {
    wallet,
    variant: 'not_whitelisted',
    available_mints: 0,
    allowed_mints: 0,
    community: null,
    wl_phase_active: wlActive,
    og: {
      title: 'Gen2 WL check',
      kindLabel: 'Owltopia',
      line1: 'Check Gen2 whitelist status',
      line2: `${short} · verify on owltopia.xyz`,
    },
    page: {
      headline: 'Not on the Gen2 WL list',
      subline: `${short} · No WL mint allocation found for this wallet.`,
    },
    metadata: {
      title: `Gen2 WL check | ${PLATFORM_NAME}`,
      description: 'Check Owltopia Gen2 whitelist mint eligibility for a Solana wallet.',
    },
  }
}

export function canShareGen2WlCheck(snapshot: Gen2WlCheckShareSnapshot): boolean {
  return (
    snapshot.wallet != null &&
    (snapshot.variant === 'eligible_active' ||
      snapshot.variant === 'eligible_assigned' ||
      snapshot.variant === 'pending_allocation' ||
      snapshot.variant === 'used_up')
  )
}
