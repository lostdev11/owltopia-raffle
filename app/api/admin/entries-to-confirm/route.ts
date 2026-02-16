import { NextRequest, NextResponse } from 'next/server'
import { getPendingEntries } from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { requireAdminSession } from '@/lib/auth-server'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { safeErrorMessage, safeErrorDetails } from '@/lib/safe-error'
import type { Entry, Raffle } from '@/lib/types'

export const dynamic = 'force-dynamic'

export interface EntryToConfirm {
  entry: Entry
  raffle: { id: string; slug: string; title: string } | null
  hasTransactionSignature: boolean
}

export interface RafflePendingSummary {
  raffleId: string
  raffle: { id: string; slug: string; title: string }
  pendingEntries: Entry[]
  withTx: Entry[]
  withoutTx: Entry[]
  currentScore: number
  potentialScore: number
  scoreImprovement: number
}

/**
 * GET entries to confirm - pending entries that would improve Owl Vision score
 * Groups by raffle and includes Owl Vision impact metrics
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const pendingEntries = await getPendingEntries()
    if (pendingEntries.length === 0) {
      return NextResponse.json({
        entriesToConfirm: [],
        byRaffle: [],
        summary: {
          totalPending: 0,
          withTx: 0,
          withoutTx: 0,
          raffleCount: 0,
        },
      })
    }

    // Group by raffle
    const byRaffleId = new Map<string, Entry[]>()
    for (const entry of pendingEntries) {
      const list = byRaffleId.get(entry.raffle_id) || []
      list.push(entry)
      byRaffleId.set(entry.raffle_id, list)
    }

    const byRaffle: RafflePendingSummary[] = []

    for (const [raffleId, entries] of byRaffleId) {
      const raffle = await getRaffleById(raffleId)
      if (!raffle) continue
      // Only show entries to confirm for raffles that are still active (not over)
      if (raffle.status === 'completed' || raffle.status === 'draft') continue

      const allEntries = await getEntriesByRaffleId(raffleId)
      const currentScore = calculateOwlVisionScore(raffle, allEntries)
      const withTx = entries.filter((e) => !!e.transaction_signature)
      const withoutTx = entries.filter((e) => !e.transaction_signature)

      // Simulate "all pending confirmed" to get potential score
      const simulatedEntries = allEntries.map((e) =>
        e.status === 'pending'
          ? { ...e, status: 'confirmed' as const }
          : e
      )
      const potentialScore = calculateOwlVisionScore(raffle, simulatedEntries)
      const scoreImprovement = potentialScore.score - currentScore.score

      byRaffle.push({
        raffleId,
        raffle: { id: raffle.id, slug: raffle.slug, title: raffle.title },
        pendingEntries: entries,
        withTx,
        withoutTx,
        currentScore: currentScore.score,
        potentialScore: potentialScore.score,
        scoreImprovement,
      })
    }

    // Sort by score improvement (highest impact first)
    byRaffle.sort((a, b) => b.scoreImprovement - a.scoreImprovement)

    // Only include entries whose raffle is still active (in byRaffle)
    const activeRaffleIds = new Set(byRaffle.map((r) => r.raffleId))
    const activePendingEntries = pendingEntries.filter((e) => activeRaffleIds.has(e.raffle_id))

    const entriesToConfirm: EntryToConfirm[] = activePendingEntries.map((entry) => {
      const raffle = byRaffle.find((r) => r.raffleId === entry.raffle_id)
      return {
        entry,
        raffle: raffle?.raffle ?? null,
        hasTransactionSignature: !!entry.transaction_signature,
      }
    })

    return NextResponse.json({
      entriesToConfirm,
      byRaffle,
      summary: {
        totalPending: activePendingEntries.length,
        withTx: activePendingEntries.filter((e) => !!e.transaction_signature).length,
        withoutTx: activePendingEntries.filter((e) => !e.transaction_signature).length,
        raffleCount: byRaffle.length,
      },
    })
  } catch (error) {
    console.error('Error fetching entries to confirm:', error)
    return NextResponse.json(
      {
        error: safeErrorMessage(error),
        ...(safeErrorDetails(error) && { details: safeErrorDetails(error) }),
      },
      { status: 500 }
    )
  }
}
