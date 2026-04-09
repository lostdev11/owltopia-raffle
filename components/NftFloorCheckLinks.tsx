'use client'

import { MagicEdenIcon } from '@/components/icons/MagicEdenIcon'
import { TensorIcon } from '@/components/icons/TensorIcon'
import { magicEdenNftUrl, tensorNftUrl, hasNftMarketplaceMint } from '@/lib/nft-marketplace-links'
import { cn } from '@/lib/utils'

type Variant = 'default' | 'compact' | 'ghost'

export function NftFloorCheckLinks({
  mintAddress,
  variant = 'default',
  className,
}: {
  mintAddress: string | null | undefined
  variant?: Variant
  className?: string
}) {
  if (!hasNftMarketplaceMint(mintAddress)) return null
  const mint = mintAddress!.trim()
  const me = magicEdenNftUrl(mint)
  const tensor = tensorNftUrl(mint)

  const iconClass =
    variant === 'ghost'
      ? 'h-5 w-5'
      : variant === 'compact'
        ? 'h-5 w-5'
        : 'h-5 w-5 sm:h-[22px] sm:w-[22px]'
  const pad =
    variant === 'compact'
      ? 'min-h-[44px] min-w-[44px] gap-1.5 px-2 py-2'
      : 'min-h-[44px] min-w-[44px] gap-2 px-2.5 py-2.5'

  /**
   * Glassy floating chip. Hover lift/shadow only when `(hover: hover) and (pointer: fine)` so touch
   * devices do not keep a “stuck” hovered state after opening marketplace links (mobile-first).
   */
  const floatingChip = cn(
    'relative z-10 rounded-xl border border-white/30 dark:border-white/15',
    'bg-background/80 dark:bg-background/55 backdrop-blur-md backdrop-saturate-150',
    'shadow-[0_4px_18px_-3px_rgba(0,0,0,0.14),0_2px_8px_-3px_rgba(0,0,0,0.1)]',
    'dark:shadow-[0_6px_22px_-4px_rgba(0,0,0,0.55),0_2px_10px_-4px_rgba(0,0,0,0.45)]',
    '-translate-y-0.5 transition-all duration-200 ease-out',
    '[-webkit-tap-highlight-color:transparent]',
    // Touch: clear press feedback without relying on hover
    'active:translate-y-0 active:scale-[0.98] active:shadow-md active:duration-100',
    // Mouse / trackpad only
    '[@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-1 [@media(hover:hover)_and_(pointer:fine)]:hover:border-white/45 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:border-white/25',
    '[@media(hover:hover)_and_(pointer:fine)]:hover:bg-background/92 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:bg-background/70',
    '[@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[0_10px_28px_-4px_rgba(0,0,0,0.18),0_4px_12px_-4px_rgba(0,0,0,0.12)]',
    'dark:[@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[0_12px_32px_-4px_rgba(0,0,0,0.65),0_4px_14px_-4px_rgba(0,0,0,0.5)]',
  )

  const ghostLink = cn(
    'touch-manipulation inline-flex items-center justify-center rounded-md border-0 bg-transparent shadow-none',
    'p-3 -m-3 text-muted-foreground hover:text-foreground active:opacity-70',
    '[-webkit-tap-highlight-color:transparent]',
    '[@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40',
  )

  return (
    <div
      className={cn(
        'flex max-w-full flex-wrap items-center',
        variant === 'ghost' ? 'gap-0' : 'gap-2',
        className,
      )}
      role="group"
      aria-label="Open prize NFT on a marketplace to verify collection floor"
    >
      <a
        href={me}
        target="_blank"
        rel="noopener noreferrer"
        title="Magic Eden — view listing and collection floor"
        aria-label="View prize NFT on Magic Eden"
        className={
          variant === 'ghost'
            ? ghostLink
            : cn(
                'touch-manipulation inline-flex items-center justify-center text-foreground',
                floatingChip,
                pad,
              )
        }
        onClick={(e) => e.stopPropagation()}
      >
        <MagicEdenIcon className={iconClass} floatingOverlay={variant !== 'ghost'} />
        {variant === 'default' && (
          <span className="ml-1.5 text-xs font-medium hidden sm:inline">Magic Eden</span>
        )}
      </a>
      <a
        href={tensor}
        target="_blank"
        rel="noopener noreferrer"
        title="Tensor — view listing and collection floor"
        aria-label="View prize NFT on Tensor"
        className={
          variant === 'ghost'
            ? ghostLink
            : cn(
                'touch-manipulation inline-flex items-center justify-center text-foreground',
                floatingChip,
                pad,
              )
        }
        onClick={(e) => e.stopPropagation()}
      >
        <TensorIcon className={iconClass} floatingOverlay={variant !== 'ghost'} />
        {variant === 'default' && (
          <span className="ml-1.5 text-xs font-medium hidden sm:inline">Tensor</span>
        )}
      </a>
    </div>
  )
}
