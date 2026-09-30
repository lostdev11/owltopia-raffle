/**
 * Admin "Next Rev Share (homepage)" form helpers.
 * Amounts are display-only; empty means 0 so Save is WYSIWYG (clearing a field zeros it).
 */

export type RevShareScheduleEditFields = {
  gen1_next_date: string
  gen2_next_date: string
  total_sol: string
  total_usdc: string
  gen1_total_sol: string
  gen1_total_usdc: string
  gen2_total_sol: string
  gen2_total_usdc: string
}

/** Serialize a form amount string for PATCH — empty / invalid → 0 (includes literal "0"). */
export function parseRevShareScheduleAmountField(raw: string): number {
  const t = raw.trim()
  if (t === '') return 0
  const n = Number.parseFloat(t)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export function buildRevShareSchedulePatchBody(edit: RevShareScheduleEditFields): {
  gen1_next_date: string | null
  gen2_next_date: string | null
  total_sol: number
  total_usdc: number
  gen1_total_sol: number
  gen1_total_usdc: number
  gen2_total_sol: number
  gen2_total_usdc: number
} {
  return {
    gen1_next_date: edit.gen1_next_date.trim() || null,
    gen2_next_date: edit.gen2_next_date.trim() || null,
    total_sol: parseRevShareScheduleAmountField(edit.total_sol),
    total_usdc: parseRevShareScheduleAmountField(edit.total_usdc),
    gen1_total_sol: parseRevShareScheduleAmountField(edit.gen1_total_sol),
    gen1_total_usdc: parseRevShareScheduleAmountField(edit.gen1_total_usdc),
    gen2_total_sol: parseRevShareScheduleAmountField(edit.gen2_total_sol),
    gen2_total_usdc: parseRevShareScheduleAmountField(edit.gen2_total_usdc),
  }
}

export type RevShareScheduleLike = {
  next_date?: string | null
  gen1_next_date?: string | null
  gen2_next_date?: string | null
  total_sol?: number | null
  total_usdc?: number | null
  gen1_total_sol?: number | null
  gen1_total_usdc?: number | null
  gen2_total_sol?: number | null
  gen2_total_usdc?: number | null
}

function amountToEditString(n: number | null | undefined): string {
  return n != null ? String(n) : ''
}

/** Map a schedule API row into controlled input strings. */
export function revShareScheduleToEditFields(data: RevShareScheduleLike): RevShareScheduleEditFields {
  return {
    gen1_next_date: data.gen1_next_date ?? data.next_date ?? '',
    gen2_next_date: data.gen2_next_date ?? data.next_date ?? '',
    total_sol: amountToEditString(data.total_sol),
    total_usdc: amountToEditString(data.total_usdc),
    gen1_total_sol: amountToEditString(data.gen1_total_sol),
    gen1_total_usdc: amountToEditString(data.gen1_total_usdc),
    gen2_total_sol: amountToEditString(data.gen2_total_sol),
    gen2_total_usdc: amountToEditString(data.gen2_total_usdc),
  }
}

/** True when the form differs from the last loaded server schedule (for dirty refresh guards). */
export function isRevShareScheduleEditDirty(
  edit: RevShareScheduleEditFields,
  server: RevShareScheduleLike | null | undefined
): boolean {
  if (!server) return false
  const baseline = revShareScheduleToEditFields(server)
  return (
    edit.gen1_next_date.trim() !== baseline.gen1_next_date.trim() ||
    edit.gen2_next_date.trim() !== baseline.gen2_next_date.trim() ||
    parseRevShareScheduleAmountField(edit.total_sol) !== parseRevShareScheduleAmountField(baseline.total_sol) ||
    parseRevShareScheduleAmountField(edit.total_usdc) !== parseRevShareScheduleAmountField(baseline.total_usdc) ||
    parseRevShareScheduleAmountField(edit.gen1_total_sol) !==
      parseRevShareScheduleAmountField(baseline.gen1_total_sol) ||
    parseRevShareScheduleAmountField(edit.gen1_total_usdc) !==
      parseRevShareScheduleAmountField(baseline.gen1_total_usdc) ||
    parseRevShareScheduleAmountField(edit.gen2_total_sol) !==
      parseRevShareScheduleAmountField(baseline.gen2_total_sol) ||
    parseRevShareScheduleAmountField(edit.gen2_total_usdc) !==
      parseRevShareScheduleAmountField(baseline.gen2_total_usdc)
  )
}
