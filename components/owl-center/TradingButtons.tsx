const btnPrimary =
  'inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-6 font-bold uppercase tracking-wide text-[#E8FDF4] shadow-[0_0_24px_rgba(0,255,156,0.18)] hover:bg-[#00FF9C]/18'
const btnGhost =
  'inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#1A222B] px-6 font-semibold uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#E8EEF2]'

export function TradingButtons({
  orbisUrl,
  magicEdenUrl,
  tensorUrl,
}: {
  orbisUrl?: string | null
  magicEdenUrl: string | null
  tensorUrl: string | null
}) {
  if (!orbisUrl && !magicEdenUrl && !tensorUrl) {
    return (
      <p className="font-mono text-xs text-[#FFD769]">
        // Marketplace links coming soon — Orbis, Magic Eden & Tensor URLs are set in Owl Center at mint-out.
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-3">
      {orbisUrl ? (
        <a href={orbisUrl} target="_blank" rel="noreferrer" className={`${btnPrimary} min-w-[140px]`}>
          Orbis
        </a>
      ) : null}
      {magicEdenUrl ? (
        <a
          href={magicEdenUrl}
          target="_blank"
          rel="noreferrer"
          className={`${orbisUrl ? btnGhost : btnPrimary} min-w-[140px]`}
        >
          Magic Eden
        </a>
      ) : null}
      {tensorUrl ? (
        <a href={tensorUrl} target="_blank" rel="noreferrer" className={`${btnGhost} min-w-[140px]`}>
          Tensor
        </a>
      ) : null}
    </div>
  )
}
