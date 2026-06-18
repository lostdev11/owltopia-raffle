import { datetimeLocalToIso } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterMintStandard } from '@/lib/owl-center/types'

export type ParsedStandardFreeze = {
  mint_standard: OwlCenterMintStandard
  freeze_enabled: boolean
  unfreeze_date: string | null
}

export function parseMintStandard(raw: unknown): OwlCenterMintStandard {
  return raw === 'core' ? 'core' : 'token_metadata'
}

function parseUnfreezeDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const iso = datetimeLocalToIso(raw.trim())
  if (iso) return iso
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * Parse + validate metadata standard and "Freeze Collection" options.
 * Freeze requires Metaplex Core (legacy NFTs cannot do founder-controlled freeze without the ~30-day cap).
 */
export function parseStandardFreezeConfig(body: Record<string, unknown>): ParsedStandardFreeze | { error: string } {
  const mint_standard = parseMintStandard(body.mint_standard)
  const freeze_enabled = Boolean(body.freeze_enabled)

  if (freeze_enabled && mint_standard !== 'core') {
    return { error: 'Freeze Collection requires the Metaplex Core mint standard.' }
  }

  const unfreeze_date = freeze_enabled ? parseUnfreezeDate(body.unfreeze_date) : null
  if (unfreeze_date) {
    const t = new Date(unfreeze_date).getTime()
    if (!Number.isFinite(t)) return { error: 'Invalid unfreeze date.' }
  }

  return { mint_standard, freeze_enabled, unfreeze_date }
}
