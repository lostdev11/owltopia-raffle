import {
  isWalletExtensionUnreachableError,
  walletExtensionUnreachableHint,
} from '@/lib/solana/wallet-extension-errors'
import { isOwlSendCoreOwnerFreezeError } from '@/lib/owl-send/mpl-core-owner-freeze'

/** @deprecated Prefer isWalletExtensionUnreachableError — kept for OwlSend call sites. */
export function isOwlSendWalletExtensionError(message: string): boolean {
  return isWalletExtensionUnreachableError(message)
}

/** True when the failure is an on-chain freeze / nest lock (safe to attribute to specific mints). */
export function isOwlSendFrozenTransferError(message: string): boolean {
  const m = (message ?? '').toLowerCase()
  if (isOwlSendCoreOwnerFreezeError(message)) return true
  return (
    m.includes('account is frozen') ||
    m.includes('frozen') ||
    m.includes('0x11') ||
    m.includes('nested/frozen') ||
    m.includes('unnest') ||
    m.includes('thaw') ||
    m.includes('mint-locked') ||
    m.includes('mint lock') ||
    m.includes('freezedelegate') ||
    m.includes('freeze delegate')
  )
}

export function owlSendWalletExtensionHint(walletName?: string | null): string {
  return walletExtensionUnreachableHint(walletName)
}

export function walletAdapterLooksLikeJupiter(adapterName: string | null | undefined): boolean {
  const n = (adapterName ?? '').toLowerCase()
  return n === 'jupiter' || n.includes('jupiter')
}
