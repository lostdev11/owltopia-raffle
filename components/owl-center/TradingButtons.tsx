const btnPrimary =
  'inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-6 font-bold uppercase tracking-wide text-[#E8FDF4] shadow-[0_0_24px_rgba(0,255,156,0.18)] hover:bg-[#00FF9C]/18'
const btnGhost =
  'inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#1A222B] px-6 font-semibold uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#E8EEF2]'

export function TradingButtons({
  magicEdenUrl,
  tensorUrl,
}: {
  magicEdenUrl: string | null
  tensorUrl: string | null
}) {
  if (!magicEdenUrl && !tensorUrl) {
    return (
      <p className="font-mono text-xs text-[#FFD769]">
        // Marketplace links coming soon — Magic Eden & Tensor URLs are set in Owl Center admin at mint-out.
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-3">
      {magicEdenUrl ? (
        <a href={magicEdenUrl} target="_blank" rel="noreferrer" className={`${btnPrimary} min-w-[140px]`}>
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
