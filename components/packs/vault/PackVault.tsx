'use client'

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { PackPurchasePanel } from '@/components/packs/vault/PackPurchasePanel'
import { PackWheel } from '@/components/packs/vault/PackWheel'
import { SelectedPack } from '@/components/packs/vault/SelectedPack'
import { VaultChrome } from '@/components/packs/vault/VaultChrome'
import { usePackWheel } from '@/components/packs/vault/use-pack-wheel'
import { cn } from '@/lib/utils'

type Props = {
  price: number
  interactionLocked: boolean
  paying?: boolean
  cta: ReactNode
  phaseCaption: string | null
  error: string | null
  loadError: string | null
  pauseMessage: string | null
  fundHint?: string | null
}

export function PackVault({
  price,
  interactionLocked,
  paying = false,
  cta,
  phaseCaption,
  error,
  loadError,
  pauseMessage,
  fundHint = null,
}: Props) {
  const vaultRef = useRef<HTMLDivElement | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useLayoutEffect(() => {
    const el = vaultRef.current
    if (!el) return
    const applySize = () => {
      const w = el.clientWidth
      el.style.setProperty('--vault-size', `${w}px`)
      el.style.setProperty('--vault-radius', `${Math.round(w * 0.38)}px`)
      const slot = Math.max(32, Math.min(58, w * 0.12))
      el.style.setProperty('--slot-size', `${Math.round(slot)}px`)
    }
    applySize()
    const ro = new ResizeObserver(applySize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const wheel = usePackWheel({
    locked: interactionLocked,
    reducedMotion,
  })

  const selected = wheel.packs[wheel.selectedIndex] ?? wheel.packs[0]!

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (interactionLocked) return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      wheel.rotateToIndex(wheel.selectedIndex + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      wheel.rotateToIndex(wheel.selectedIndex - 1)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[min(100%,36rem)] overflow-clip">
      <div
        ref={vaultRef}
        tabIndex={0}
        role="slider"
        aria-label="Pack vault"
        aria-valuemin={0}
        aria-valuemax={wheel.packCount - 1}
        aria-valuenow={wheel.selectedIndex}
        aria-valuetext={`Pack ${selected.idLabel} selected`}
        aria-disabled={interactionLocked}
        onKeyDown={onKeyDown}
        onPointerDown={wheel.onPointerDown}
        onPointerMove={wheel.onPointerMove}
        onPointerUp={wheel.onPointerUp}
        onPointerCancel={wheel.onPointerCancel}
        onLostPointerCapture={wheel.onLostPointerCapture}
        className={cn(
          'relative mx-auto aspect-square w-full max-w-full select-none overflow-hidden outline-none',
          'focus-visible:ring-2 focus-visible:ring-[#00FF9C]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050807]',
          interactionLocked ? 'cursor-default' : wheel.isDragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        style={{ touchAction: 'pan-y' }}
      >
        <VaultChrome selectorLit={wheel.selectorLit} />
        <PackWheel
          packs={wheel.packs}
          packCount={wheel.packCount}
          selectedIndex={wheel.selectedIndex}
          locked={interactionLocked}
          isDragging={wheel.isDragging}
          wheelRef={wheel.wheelRef}
          onSlotSelect={wheel.onSlotSelect}
        />
        <SelectedPack selectedIndex={wheel.selectedIndex} paying={paying} />
      </div>

      <PackPurchasePanel
        pack={selected}
        price={price}
        idTick={wheel.idTick}
        locked={interactionLocked}
        cta={cta}
        phaseCaption={phaseCaption}
        error={error}
        loadError={loadError}
        pauseMessage={pauseMessage}
        fundHint={fundHint}
        onPrev={() => wheel.rotateToIndex(wheel.selectedIndex - 1)}
        onNext={() => wheel.rotateToIndex(wheel.selectedIndex + 1)}
      />
    </div>
  )
}
