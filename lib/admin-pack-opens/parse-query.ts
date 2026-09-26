import {
  ADMIN_PACK_OPEN_STATUSES,
  ADMIN_PACK_OPEN_STUCK_MINUTES_DEFAULT,
  ADMIN_PACK_OPEN_STUCK_PIPELINE_STATUSES,
} from '@/lib/admin-pack-opens/constants'
import type { ListAdminPackOpensParams, PackOpensListFilterPlan } from '@/lib/admin-pack-opens/types'
import type { PackOpenStatus } from '@/lib/packs/types'

function pickStatuses(raw: string | null): PackOpenStatus[] | undefined {
  if (!raw?.trim()) return undefined
  const parts = raw.split(',').map((s) => s.trim())
  const picked = parts.filter((s): s is PackOpenStatus =>
    (ADMIN_PACK_OPEN_STATUSES as readonly string[]).includes(s)
  )
  return picked.length ? picked : undefined
}

function parseIsoParam(raw: string | null): string | undefined {
  const t = raw?.trim()
  if (!t) return undefined
  const ms = Date.parse(t)
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms).toISOString()
}

export function packOpensStuckCutoffIso(nowMs: number, minutes: number): string {
  const m = Number.isFinite(minutes) && minutes > 0 ? minutes : ADMIN_PACK_OPEN_STUCK_MINUTES_DEFAULT
  return new Date(nowMs - m * 60_000).toISOString()
}

export function buildPackOpensListFilterPlan(
  params: ListAdminPackOpensParams,
  nowMs: number
): PackOpensListFilterPlan {
  const plan: PackOpensListFilterPlan = {}

  const wallet = params.wallet?.trim()
  if (wallet) {
    plan.wallet = { mode: params.walletMode, value: wallet }
  }
  if (params.statuses?.length) plan.statuses = params.statuses
  if (params.productId) plan.productId = params.productId
  if (params.createdFrom) plan.createdFrom = params.createdFrom
  if (params.createdTo) plan.createdTo = params.createdTo

  if (params.stuckAttention) {
    plan.stuckAttention = {
      cutoffIso: packOpensStuckCutoffIso(nowMs, params.stuckMinutes ?? ADMIN_PACK_OPEN_STUCK_MINUTES_DEFAULT),
      pipelineStatuses: [...ADMIN_PACK_OPEN_STUCK_PIPELINE_STATUSES],
    }
  }

  return plan
}

export function parseListAdminPackOpensQuery(searchParams: URLSearchParams): ListAdminPackOpensParams {
  const wallet = searchParams.get('wallet')?.trim() || undefined
  const walletMode = searchParams.get('wallet_mode') === 'prefix' ? 'prefix' : 'exact'

  const statusParam = searchParams.get('status') ?? searchParams.get('statuses')
  const statuses = pickStatuses(statusParam)

  const productId = searchParams.get('product_id')?.trim() || searchParams.get('product')?.trim() || undefined

  const createdFrom =
    parseIsoParam(searchParams.get('created_from')) ??
    parseIsoParam(searchParams.get('from')) ??
    undefined
  const createdTo =
    parseIsoParam(searchParams.get('created_to')) ?? parseIsoParam(searchParams.get('to')) ?? undefined

  const stuckAttention =
    searchParams.get('stuck') === '1' ||
    searchParams.get('stuck_attention') === '1' ||
    searchParams.get('needs_attention') === '1'

  const stuckMinutesRaw = Number(searchParams.get('stuck_minutes'))
  const stuckMinutes = Number.isFinite(stuckMinutesRaw) ? stuckMinutesRaw : undefined

  const limitRaw = Number(searchParams.get('limit'))
  const offsetRaw = Number(searchParams.get('offset'))
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50
  const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0

  return {
    wallet,
    walletMode,
    statuses,
    productId,
    createdFrom,
    createdTo,
    stuckAttention: stuckAttention || undefined,
    stuckMinutes,
    limit,
    offset,
  }
}
