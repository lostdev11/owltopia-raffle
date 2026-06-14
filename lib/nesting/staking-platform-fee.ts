import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import {
  getPlatformFeeTreasuryWalletAddress,
  getPlatformFeeTreasuryWalletAddressClient,
} from '@/lib/solana/platform-fee-treasury-wallet'

const DEFAULT_FEE_SOL = 0.001

export type StakingPlatformFeeAction = 'stake' | 'unstake' | 'claim'

function readFeeSolFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function readBoolean(raw: string | undefined): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/** Per-nest platform fee in SOL (default 0.001). Server env: `NESTING_PLATFORM_FEE_SOL`. */
export function getStakingPlatformFeeSol(): number {
  const raw =
    typeof process !== 'undefined'
      ? process.env.NESTING_PLATFORM_FEE_SOL?.trim() ||
        process.env.NEXT_PUBLIC_NESTING_PLATFORM_FEE_SOL?.trim()
      : undefined
  return readFeeSolFromEnv(raw, DEFAULT_FEE_SOL)
}

export function getStakingPlatformFeeLamports(): number {
  const sol = getStakingPlatformFeeSol()
  if (sol <= 0) return 0
  return Math.round(sol * LAMPORTS_PER_SOL)
}

export function isStakingPlatformFeeEnvDisabled(): boolean {
  if (typeof process === 'undefined') return false
  return readBoolean(process.env.NESTING_PLATFORM_FEE_DISABLED)
}

export function isStakingPlatformFeeEnabled(): boolean {
  if (isStakingPlatformFeeEnvDisabled()) return false
  const lamports = getStakingPlatformFeeLamports()
  return lamports > 0 && !!getPlatformFeeTreasuryWalletAddress()
}

export function isStakingPlatformFeeEnabledClient(): boolean {
  if (typeof process !== 'undefined' && readBoolean(process.env.NEXT_PUBLIC_NESTING_PLATFORM_FEE_DISABLED)) {
    return false
  }
  const lamports = getStakingPlatformFeeLamports()
  return lamports > 0 && !!getPlatformFeeTreasuryWalletAddressClient()
}

export function formatStakingPlatformFeePerNestLabel(): string {
  const sol = getStakingPlatformFeeSol()
  if (sol <= 0) return 'No platform fee'
  const str = sol >= 0.01 ? sol.toFixed(3) : sol.toFixed(4)
  return `${str} SOL per nested NFT`
}

export function formatStakingPlatformFeeTotalLabel(units: number): string {
  if (units <= 0) return ''
  const unitSol = getStakingPlatformFeeSol()
  if (unitSol <= 0) return ''
  const total = unitSol * units
  const totalStr = total >= 0.01 ? total.toFixed(3) : total.toFixed(4)
  const unitStr = unitSol >= 0.01 ? unitSol.toFixed(3) : unitSol.toFixed(4)
  return `${totalStr} SOL platform fee (${units} NFT${units === 1 ? '' : 's'} × ${unitStr} SOL)`
}
