/**
 * Structured VRF phase timing for production dashboards / log search.
 * Example: `{ "tag":"vrf_timing","scope":"pack","phase":"vrf.reveal",... }`
 */
export type VrfTimingScope = 'pack' | 'raffle'

export function logVrfPhase(
  scope: VrfTimingScope,
  phase: string,
  durationMs: number,
  meta?: Record<string, unknown>
): void {
  const ms = Math.max(0, Math.floor(durationMs))
  console.log(
    JSON.stringify({
      tag: 'vrf_timing',
      scope,
      phase,
      durationMs: ms,
      ...(meta ?? {}),
      at: new Date().toISOString(),
    })
  )
}

export function vrfPhaseTimer(): { elapsed: () => number } {
  const started = Date.now()
  return { elapsed: () => Date.now() - started }
}
