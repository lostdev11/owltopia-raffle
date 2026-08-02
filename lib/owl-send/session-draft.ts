import type { OwlSendMode } from '@/lib/owl-send/constants'
import type { OwlSendLine } from '@/lib/owl-send/batch'
import type { OwlSendBatchProgressSnapshot } from '@/lib/owl-send/resume'

const STORAGE_KEY = 'owl-send-nft-draft-v1'

export type OwlSendNftSessionDraft = {
  version: 1
  fromWallet: string
  mode: OwlSendMode
  preparedLines: OwlSendLine[]
  batches: OwlSendLine[][]
  batchProgress: OwlSendBatchProgressSnapshot[]
  activeBatch: number
  updatedAt: number
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function saveOwlSendNftDraft(draft: OwlSendNftSessionDraft): void {
  if (!canUseStorage()) return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    /* quota / private mode */
  }
}

export function loadOwlSendNftDraft(wallet: string): OwlSendNftSessionDraft | null {
  if (!canUseStorage()) return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OwlSendNftSessionDraft
    if (parsed?.version !== 1 || parsed.fromWallet !== wallet) return null
    if (!Array.isArray(parsed.preparedLines) || !Array.isArray(parsed.batches)) return null
    if (!Array.isArray(parsed.batchProgress) || parsed.batchProgress.length < 1) return null
    const incomplete = parsed.batchProgress.some((b) => b.status !== 'done')
    if (!incomplete) {
      clearOwlSendNftDraft()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearOwlSendNftDraft(): void {
  if (!canUseStorage()) return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function owlSendNftDraftIsIncomplete(draft: OwlSendNftSessionDraft): boolean {
  return draft.batchProgress.some((b) => b.status !== 'done')
}
