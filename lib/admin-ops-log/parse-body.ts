import {
  ADMIN_OPS_LOG_ASSETS,
  ADMIN_OPS_LOG_STATUSES,
  ADMIN_OPS_LOG_TYPES,
  type AdminOpsLogAsset,
  type AdminOpsLogStatus,
  type AdminOpsLogType,
} from '@/lib/admin-ops-log/constants'
import type { CreateAdminOpsLogParams, UpdateAdminOpsLogParams } from '@/lib/admin-ops-log/types'

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return typeof value === 'string' ? value : undefined
}

function parseAmountField(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function parseCreateAdminOpsLogBody(
  body: Record<string, unknown>,
  actorWallet: string
): { ok: true; params: CreateAdminOpsLogParams } | { ok: false; error: string } {
  const type = pickEnum(body.type, ADMIN_OPS_LOG_TYPES)
  if (!type) return { ok: false, error: 'Invalid or missing type' }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return { ok: false, error: 'Title is required' }

  const assetRaw = body.asset
  let asset: AdminOpsLogAsset | null | undefined
  if (assetRaw === undefined) asset = undefined
  else if (assetRaw === null || assetRaw === '') asset = null
  else {
    const a = pickEnum(assetRaw, ADMIN_OPS_LOG_ASSETS)
    if (!a) return { ok: false, error: 'Invalid asset' }
    asset = a
  }

  const status = body.status !== undefined ? pickEnum(body.status, ADMIN_OPS_LOG_STATUSES) : undefined
  if (body.status !== undefined && !status) return { ok: false, error: 'Invalid status' }

  const amount = parseAmountField(body.amount)
  if (body.amount !== undefined && amount === undefined) {
    return { ok: false, error: 'Invalid amount' }
  }

  return {
    ok: true,
    params: {
      occurredAt: optionalText(body.occurred_at) ?? optionalText(body.occurredAt) ?? undefined,
      type,
      title,
      who: optionalText(body.who) ?? undefined,
      wallet: optionalText(body.wallet) ?? undefined,
      amount: amount ?? undefined,
      asset: asset ?? undefined,
      fromWallet: optionalText(body.from_wallet) ?? optionalText(body.fromWallet) ?? undefined,
      txSignature: optionalText(body.tx_signature) ?? optionalText(body.txSignature) ?? undefined,
      related: optionalText(body.related) ?? undefined,
      status: status ?? undefined,
      notes: optionalText(body.notes) ?? undefined,
      createdByWallet: actorWallet,
    },
  }
}

export function parseUpdateAdminOpsLogBody(
  body: Record<string, unknown>,
  actorWallet: string
): { ok: true; params: UpdateAdminOpsLogParams } | { ok: false; error: string } {
  const params: UpdateAdminOpsLogParams = { updatedByWallet: actorWallet }

  if (body.type !== undefined) {
    const type = pickEnum(body.type, ADMIN_OPS_LOG_TYPES)
    if (!type) return { ok: false, error: 'Invalid type' }
    params.type = type
  }
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return { ok: false, error: 'Title cannot be empty' }
    }
    params.title = body.title.trim()
  }
  if (body.status !== undefined) {
    const status = pickEnum(body.status, ADMIN_OPS_LOG_STATUSES)
    if (!status) return { ok: false, error: 'Invalid status' }
    params.status = status
  }
  if (body.asset !== undefined) {
    if (body.asset === null || body.asset === '') params.asset = null
    else {
      const asset = pickEnum(body.asset, ADMIN_OPS_LOG_ASSETS)
      if (!asset) return { ok: false, error: 'Invalid asset' }
      params.asset = asset
    }
  }

  const amount = parseAmountField(body.amount)
  if (body.amount !== undefined && amount === undefined) {
    return { ok: false, error: 'Invalid amount' }
  }
  if (amount !== undefined) params.amount = amount

  const occurred =
    body.occurred_at !== undefined
      ? optionalText(body.occurred_at)
      : body.occurredAt !== undefined
        ? optionalText(body.occurredAt)
        : undefined
  if (occurred !== undefined) params.occurredAt = occurred

  const who = optionalText(body.who)
  if (who !== undefined) params.who = who
  const wallet = optionalText(body.wallet)
  if (wallet !== undefined) params.wallet = wallet
  const fromWallet =
    body.from_wallet !== undefined
      ? optionalText(body.from_wallet)
      : body.fromWallet !== undefined
        ? optionalText(body.fromWallet)
        : undefined
  if (fromWallet !== undefined) params.fromWallet = fromWallet
  const txSignature =
    body.tx_signature !== undefined
      ? optionalText(body.tx_signature)
      : body.txSignature !== undefined
        ? optionalText(body.txSignature)
        : undefined
  if (txSignature !== undefined) params.txSignature = txSignature
  const related = optionalText(body.related)
  if (related !== undefined) params.related = related
  const notes = optionalText(body.notes)
  if (notes !== undefined) params.notes = notes

  return { ok: true, params }
}

export function parseListAdminOpsLogQuery(searchParams: URLSearchParams): {
  type?: AdminOpsLogType
  status?: AdminOpsLogStatus
  search?: string
  limit: number
  offset: number
} {
  const type = pickEnum(searchParams.get('type'), ADMIN_OPS_LOG_TYPES) ?? undefined
  const status = pickEnum(searchParams.get('status'), ADMIN_OPS_LOG_STATUSES) ?? undefined
  const search = searchParams.get('search')?.trim() || undefined
  const limitRaw = Number(searchParams.get('limit'))
  const offsetRaw = Number(searchParams.get('offset'))
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50
  const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0
  return { type, status, search, limit, offset }
}
