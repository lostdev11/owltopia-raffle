import type { AdminOpsLogAsset } from '@/lib/admin-ops-log/constants'

export type AdminOpsLogPaymentRow = {
  id: string
  entry_id: string
  amount: number | null
  asset: AdminOpsLogAsset | null
  from_wallet: string | null
  to_wallet: string | null
  tx_signature: string | null
  related_pack_open_id: string | null
  note: string | null
  created_by_wallet: string
  created_at: string
}

export type CreateAdminOpsLogPaymentParams = {
  entryId: string
  amount?: number | null
  asset?: AdminOpsLogAsset | null
  fromWallet?: string | null
  toWallet?: string | null
  txSignature?: string | null
  relatedPackOpenId?: string | null
  note?: string | null
  createdByWallet: string
}

export type UpdateAdminOpsLogPaymentParams = {
  amount?: number | null
  asset?: AdminOpsLogAsset | null
  fromWallet?: string | null
  toWallet?: string | null
  txSignature?: string | null
  relatedPackOpenId?: string | null
  note?: string | null
}
