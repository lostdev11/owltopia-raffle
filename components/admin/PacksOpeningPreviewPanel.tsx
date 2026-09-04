'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  PackOpeningExperience,
  type PackOpeningStage,
} from '@/components/packs/PackOpeningExperience'
import { PackHoverVideo } from '@/components/packs/PackHoverVideo'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { preloadPackAnimationVideos } from '@/lib/packs/animations'
import {
  packOpenRewardFromInventory,
  type PackPreviewInventoryItem,
} from '@/lib/packs/preview-reward'

type PreviewMode = 'hovering' | 'opening' | 'full' | 'reveal'

function inventoryOptionLabel(item: PackPreviewInventoryItem): string {
  const name = item.name || `NFT ${item.mint_address.slice(0, 8)}…`
  return `${name} · ${item.fair_value_sol} SOL · ${item.status}`
}

export function PacksOpeningPreviewPanel({
  inventory = [],
}: {
  inventory?: PackPreviewInventoryItem[]
}) {
  const [category, setCategory] = useState<'owl' | 'sol' | 'nft'>('nft')
  const [inventoryId, setInventoryId] = useState('')
  const [mode, setMode] = useState<PreviewMode | null>(null)
  const [runKey, setRunKey] = useState(0)

  const selectedInventoryItem = useMemo(
    () => inventory.find((item) => item.id === inventoryId) ?? null,
    [inventory, inventoryId]
  )

  useEffect(() => {
    if (category !== 'nft') return
    if (inventory.length === 0) {
      setInventoryId('')
      return
    }
    if (!inventory.some((item) => item.id === inventoryId)) {
      const preferred =
        inventory.find((item) => item.status === 'available') ?? inventory[0]
      setInventoryId(preferred.id)
    }
  }, [category, inventory, inventoryId])

  const reward = useMemo(
    () => packOpenRewardFromInventory(category, selectedInventoryItem),
    [category, selectedInventoryItem]
  )

  useEffect(() => {
    preloadPackAnimationVideos({ opening: true })
  }, [])

  const experienceProps = useMemo(() => {
    if (!mode) return null
    if (mode === 'hovering') {
      return {
        initialStage: 'hovering' as PackOpeningStage,
        includeHoverGate: true,
        hoverOnly: true,
      }
    }
    if (mode === 'opening') {
      return {
        initialStage: 'opening' as PackOpeningStage,
        includeHoverGate: false,
        hoverOnly: false,
      }
    }
    if (mode === 'reveal') {
      return {
        initialStage: 'whiteTransition' as PackOpeningStage,
        includeHoverGate: false,
        hoverOnly: false,
      }
    }
    return {
      initialStage: 'hovering' as PackOpeningStage,
      includeHoverGate: true,
      hoverOnly: false,
    }
  }, [mode])

  function startPreview(nextMode: PreviewMode) {
    setMode(nextMode)
    setRunKey((k) => k + 1)
  }

  return (
    <>
      <div className="rounded-lg border p-4">
        <h2 className="font-medium">Preview pack opening</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          See the buyer experience after purchase — hover loop, rip animation, and prize reveal.
          NFT previews use vault inventory below; SOL and $OWL still use sample amounts. No SOL is
          spent.
        </p>

        <div className="mt-4">
          <Label htmlFor="packs-preview-category">Prize type</Label>
          <select
            id="packs-preview-category"
            className="mt-1 flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as 'owl' | 'sol' | 'nft')}
          >
            <option value="nft">NFT win</option>
            <option value="sol">SOL win (sample)</option>
            <option value="owl">$OWL win (sample)</option>
          </select>
        </div>

        {category === 'nft' ? (
          <div className="mt-4">
            <Label htmlFor="packs-preview-inventory">Vault NFT</Label>
            {inventory.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                No vault inventory yet — add NFTs below to preview a real prize reveal.
              </p>
            ) : (
              <select
                id="packs-preview-inventory"
                className="mt-1 flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={inventoryId}
                onChange={(e) => setInventoryId(e.target.value)}
              >
                {inventory.map((item) => (
                  <option key={item.id} value={item.id}>
                    {inventoryOptionLabel(item)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : null}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] touch-manipulation"
            onClick={() => startPreview('full')}
          >
            Full sequence (recommended)
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] touch-manipulation"
            onClick={() => startPreview('hovering')}
          >
            Hover only
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] touch-manipulation"
            onClick={() => startPreview('opening')}
          >
            Opening clip
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] touch-manipulation"
            onClick={() => startPreview('reveal')}
          >
            Prize reveal
          </Button>
        </div>

        <div className="mt-4 rounded-md border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Pack hero hover (on /packs)
          </p>
          <PackHoverVideo phase="idle" />
        </div>
      </div>

      {mode && experienceProps ? (
        <PackOpeningExperience
          key={`${mode}-${category}-${runKey}`}
          reward={reward}
          includeHoverGate={experienceProps.includeHoverGate}
          hoverOnly={experienceProps.hoverOnly}
          initialStage={experienceProps.initialStage}
          onComplete={() => setMode(null)}
        />
      ) : null}
    </>
  )
}
