import {
  ADMIN_OPS_LOG_ASSETS,
  type AdminOpsLogAsset,
} from '@/lib/admin-ops-log/constants'
import type {
  CreateAdminOpsLogPaymentParams,
  UpdateAdminOpsLogPaymentParams,
} from '@/lib/admin-ops-log/payment-types'
import { validateOptionalSolanaTxSignature } from '@/lib/admin-ops-log/validate-tx-signature'

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

export function parseCreateAdminOpsLogPaymentBody(
  body: Record<string, unknown>,
  entryId: string,
  actorWallet: string
): { ok: true; params: CreateAdminOpsLogPaymentParams } | { ok: false; error: string } {
  const assetRaw = body.asset
  let asset: AdminOpsLogAsset | null | undefined
  if (assetRaw === undefined) asset = undefined
  else if (assetRaw === null || assetRaw === '') asset = null
  else {
    const a = pickEnum(assetRaw, ADMIN_OPS_LOG_ASSETS)
    if (!a) return { ok: false, error: 'Invalid asset' }
    asset = a
  }

  const amount = parseAmountField(body.amount)
  if (body.amount !== undefined && amount === undefined) {
    return { ok: false, error: 'Invalid amount' }
  }

  const txRaw =
    body.tx_signature !== undefined
      ? body.tx_signature
      : body.txSignature !== undefined
        ? body.txSignature
        : undefined
  let txSignature: string | null | undefined
  if (txRaw === undefined) txSignature = undefined
  else {
    const v = validateOptionalSolanaTxSignature(txRaw)
    if (!v.ok) return { ok: false, error: v.error }
    txSignature = v.normalized
  }

  return {
    ok: true,
    params: {
      entryId: entryId.trim(),
      amount: amount ?? undefined,
      asset: asset ?? undefined,
      fromWallet:
        optionalText(body.from_wallet) ?? optionalText(body.fromWallet) ?? undefined,
      toWallet: optionalText(body.to_wallet) ?? optionalText(body.toWallet) ?? undefined,
      txSignature: txSignature ?? undefined,
      relatedPackOpenId:
        optionalText(body.related_pack_open_id) ??
        optionalText(body.relatedPackOpenId) ??
        undefined,
      note: optionalText(body.note) ?? undefined,
      createdByWallet: actorWallet,
    },
  }
}

export function parseUpdateAdminOpsLogPaymentBody(
  body: Record<string, unknown>
): { ok: true; params: UpdateAdminOpsLogPaymentParams } | { ok: false; error: string } {
  const params: UpdateAdminOpsLogPaymentParams = {}

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

  const fromWallet =
    body.from_wallet !== undefined
      ? optionalText(body.from_wallet)
      : body.fromWallet !== undefined
        ? optionalText(body.fromWallet)
        : undefined
  if (fromWallet !== undefined) params.fromWallet = fromWallet

  const toWallet =
    body.to_wallet !== undefined
      ? optionalText(body.to_wallet)
      : body.toWallet !== undefined
        ? optionalText(body.toWallet)
        : undefined
  if (toWallet !== undefined) params.toWallet = toWallet

  const txRaw =
    body.tx_signature !== undefined
      ? body.tx_signature
      : body.txSignature !== undefined
        ? body.txSignature
        : undefined
  if (txRaw !== undefined) {
    const v = validateOptionalSolanaTxSignature(txRaw)
    if (!v.ok) return { ok: false, error: v.error }
    params.txSignature = v.normalized
  }

  const relatedPackOpenId =
    body.related_pack_open_id !== undefined
      ? optionalText(body.related_pack_open_id)
      : body.relatedPackOpenId !== undefined
        ? optionalText(body.relatedPackOpenId)
        : undefined
  if (relatedPackOpenId !== undefined) params.relatedPackOpenId = relatedPackOpenId

  const note = optionalText(body.note)
  if (note !== undefined) params.note = note

  return { ok: true, params }
}
