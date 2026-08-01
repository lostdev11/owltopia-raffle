import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import { OWL_SEND_DEFAULT_FEE_SOL } from '@/lib/owl-send/constants'

function readFeeSolFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Per-transfer Owl fee in SOL (default 0.001). */
export function getOwlSendFeeSol(): number {
  const raw =
    typeof process !== 'undefined'
      ? process.env.OWL_SEND_FEE_SOL?.trim() ||
        process.env.NEXT_PUBLIC_OWL_SEND_FEE_SOL?.trim()
      : undefined
  return readFeeSolFromEnv(raw, OWL_SEND_DEFAULT_FEE_SOL)
}

export function getOwlSendFeeLamports(): number {
  const sol = getOwlSendFeeSol()
  if (sol <= 0) return 0
  return Math.round(sol * LAMPORTS_PER_SOL)
}

export function getOwlSendFeeLamportsForCount(count: number): number {
  const n = Math.max(0, Math.floor(count))
  return getOwlSendFeeLamports() * n
}

export function isOwlSendFeeEnabledClient(): boolean {
  const lamports = getOwlSendFeeLamports()
  return lamports > 0 && !!getPlatformFeeTreasuryWalletAddressClient()
}

export function formatOwlSendFeeSol(sol: number): string {
  if (sol <= 0) return '0 SOL'
  if (sol < 0.0001) return `${sol.toFixed(6)} SOL`
  if (sol >= 0.01) return `${sol.toFixed(3)} SOL`
  return `${sol.toFixed(4)} SOL`
}
