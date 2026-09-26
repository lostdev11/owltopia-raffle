import type { AdminOpsLogAsset, AdminOpsLogStatus, AdminOpsLogType } from '@/lib/admin-ops-log/constants'

export type AdminOpsLogRow = {
  id: string
  occurred_at: string
  type: AdminOpsLogType
  title: string
  who: string | null
  wallet: string | null
  amount: number | null
  asset: AdminOpsLogAsset | null
  from_wallet: string | null
  tx_signature: string | null
  related: string | null
  status: AdminOpsLogStatus
  notes: string | null
  created_by_wallet: string
  created_at: string
  updated_at: string
  updated_by_wallet: string | null
}

export type ListAdminOpsLogParams = {
  type?: AdminOpsLogType
  status?: AdminOpsLogStatus
  search?: string
  limit?: number
  offset?: number
}

export type CreateAdminOpsLogParams = {
  occurredAt?: string | null
  type: AdminOpsLogType
  title: string
  who?: string | null
  wallet?: string | null
  amount?: number | null
  asset?: AdminOpsLogAsset | null
  fromWallet?: string | null
  txSignature?: string | null
  related?: string | null
  status?: AdminOpsLogStatus
  notes?: string | null
  createdByWallet: string
}

export type UpdateAdminOpsLogParams = {
  occurredAt?: string | null
  type?: AdminOpsLogType
  title?: string
  who?: string | null
  wallet?: string | null
  amount?: number | null
  asset?: AdminOpsLogAsset | null
  fromWallet?: string | null
  txSignature?: string | null
  related?: string | null
  status?: AdminOpsLogStatus
  notes?: string | null
  updatedByWallet: string
}
