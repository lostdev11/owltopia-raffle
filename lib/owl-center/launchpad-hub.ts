import { listOwlCenterLaunchesAdmin } from '@/lib/db/owl-center-launch'
import { listOwlCenterPresaleTenantsAdmin } from '@/lib/db/owl-center-presale-tenants'
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { previewGen2PhaseAdvance } from '@/lib/owl-center/gen2-phase-advance'
import { isOwlCenterMintEnvKillSwitchEnabled } from '@/lib/owl-center/mint-policy'
import { getMintCountdownInfo } from '@/lib/owl-center/phase-schedule'
import { owlCenterPhaseLabel } from '@/lib/owl-center/phase-display'
import type { MintTerminalLine, OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isDevnetMintEnabled } from '@/lib/solana/network'

export type LaunchpadHubLaunchRow = {
  id: string
  slug: string
  name: string
  mint_mode: OwlCenterLaunchPublic['mint_mode']
  status: OwlCenterLaunchPublic['status']
  active_phase: OwlCenterLaunchPublic['active_phase']
  minted_count: number
  total_supply: number
  is_paused: boolean
  is_featured: boolean
  creator_wallet: string | null
  launch_deadline_at: string | null
  public_mint_href: string | null
  admin_href: string
}

export type LaunchpadHubPayload = {
  launches: LaunchpadHubLaunchRow[]
  pending_review: LaunchpadHubLaunchRow[]
  gen2: {
    launch: OwlCenterLaunchPublic
    supply: { minted: number; total: number; remaining: number }
    phase_advance: ReturnType<typeof previewGen2PhaseAdvance>
    countdown: ReturnType<typeof getMintCountdownInfo>
  } | null
  presale_tenant_count: number
  system: {
    mint_kill_switch: boolean
    devnet_mint_mode: boolean
    auto_phase_advance_cron: string
  }
  recent_activity: MintTerminalLine[]
}

function adminHrefForLaunch(launch: OwlCenterLaunchPublic): string {
  if (launch.slug === 'gen2') return '/admin/owl-center/gen2'
  return `/admin/owl-center/collections/${launch.id}/assets`
}

function publicMintHref(launch: OwlCenterLaunchPublic): string | null {
  if (launch.status === 'DRAFT' || launch.status === 'PENDING_REVIEW') return null
  if (launch.slug === 'gen2') return '/owl-center/collection/gen2'
  return `/owl-center/collection/${launch.slug}`
}

function toHubRow(launch: OwlCenterLaunchPublic): LaunchpadHubLaunchRow {
  return {
    id: launch.id,
    slug: launch.slug,
    name: launch.name,
    mint_mode: launch.mint_mode,
    status: launch.status,
    active_phase: launch.active_phase,
    minted_count: launch.minted_count,
    total_supply: launch.total_supply,
    is_paused: launch.is_paused,
    is_featured: launch.is_featured,
    creator_wallet: launch.creator_wallet,
    launch_deadline_at: launch.launch_deadline_at,
    public_mint_href: publicMintHref(launch),
    admin_href: adminHrefForLaunch(launch),
  }
}

export async function buildLaunchpadHubPayload(): Promise<LaunchpadHubPayload> {
  const db = getSupabaseAdmin()
  const [launches, tenants, gen2, activityRows] = await Promise.all([
    listOwlCenterLaunchesAdmin(),
    listOwlCenterPresaleTenantsAdmin().catch(() => []),
    getOwlCenterLaunchBySlugAdmin('gen2'),
    db
      .from('owl_center_activity_logs')
      .select('id,message,event_type,created_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const hubLaunches = launches.map(toHubRow)
  const pending_review = hubLaunches.filter((l) => l.status === 'PENDING_REVIEW')
  const live = hubLaunches.filter((l) => l.status !== 'PENDING_REVIEW')

  const gen2Block =
    gen2 != null
      ? {
          launch: gen2,
          supply: {
            minted: gen2.minted_count,
            total: gen2.total_supply,
            remaining: Math.max(0, gen2.total_supply - gen2.minted_count),
          },
          phase_advance: previewGen2PhaseAdvance(gen2),
          countdown: getMintCountdownInfo(gen2),
        }
      : null

  const recent_activity: MintTerminalLine[] = (activityRows.data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      kind: 'system' as const,
      message: String(row.message ?? ''),
      created_at: String(row.created_at ?? ''),
    }
  })

  return {
    launches: live,
    pending_review,
    gen2: gen2Block,
    presale_tenant_count: tenants.length,
    system: {
      mint_kill_switch: isOwlCenterMintEnvKillSwitchEnabled(),
      devnet_mint_mode: isDevnetMintEnabled(),
      auto_phase_advance_cron: '*/5 * * * * (Gen2 only)',
    },
    recent_activity,
  }
}

export function launchPhaseLabel(phase: string): string {
  return owlCenterPhaseLabel(phase as OwlCenterLaunchPublic['active_phase'])
}
