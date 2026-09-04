'use client'

import type { RefObject } from 'react'
import { cn } from '@/lib/utils'
import type { VaultPack } from '@/lib/packs/vault-wheel'
import { slotAngle } from '@/lib/packs/vault-wheel'

/** Transparent Owltopia sealed-pack still (mini) for vault wheel slots. */
const MINI_PACK_SRC = '/images/owltopia-pack-mini.png'

type SlotProps = {
  pack: VaultPack
  packCount: number
  selected: boolean
  locked: boolean
  onSelect: (index: number) => void
}

function PackSlot({ pack, packCount, selected, locked, onSelect }: SlotProps) {
  const angle = slotAngle(pack.index, packCount)
  return (
    <button
      type="button"
      data-vault-slot={pack.index}
      aria-label={`Select pack ${pack.idLabel}`}
      aria-pressed={selected}
      disabled={locked}
      onClick={() => onSelect(pack.index)}
      className={cn(
        'pack-vault-slot',
        selected ? 'pack-vault-slot--selected' : '',
        locked ? 'cursor-default' : 'cursor-pointer'
      )}
      style={{ ['--slot-angle' as string]: `${angle}deg` }}
    >
      <span className="pack-vault-slot-face">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny repeating static asset; avoids next/image layout quirks in transformed slots */}
        <img
          src={MINI_PACK_SRC}
          alt=""
          draggable={false}
          decoding="async"
          className="pack-vault-slot-art"
        />
        <span className="pack-vault-slot-id">{pack.idLabel}</span>
      </span>
    </button>
  )
}

type WheelProps = {
  packs: VaultPack[]
  packCount: number
  selectedIndex: number
  locked: boolean
  isDragging: boolean
  wheelRef: RefObject<HTMLDivElement | null>
  onSlotSelect: (index: number) => void
}

export function PackWheel({
  packs,
  packCount,
  selectedIndex,
  locked,
  isDragging,
  wheelRef,
  onSlotSelect,
}: WheelProps) {
  return (
    <div
      ref={wheelRef}
      className={cn(
        'absolute inset-0 z-[4] origin-center',
        isDragging ? 'cursor-grabbing will-change-transform' : ''
      )}
      style={{ transform: 'rotate(180deg)', ['--wheel-rotation' as string]: '180deg' }}
    >
      {packs.map((pack) => (
        <PackSlot
          key={pack.index}
          pack={pack}
          packCount={packCount}
          selected={pack.index === selectedIndex}
          locked={locked}
          onSelect={onSlotSelect}
        />
      ))}
    </div>
  )
}
