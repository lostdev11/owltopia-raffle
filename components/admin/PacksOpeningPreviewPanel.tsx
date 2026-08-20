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
import { mockPackOpenReward } from '@/lib/packs/preview-reward'

type PreviewMode = 'hovering' | 'opening' | 'full' | 'reveal'

export function PacksOpeningPreviewPanel() {
  const [category, setCategory] = useState<'owl' | 'sol' | 'nft'>('nft')
  const [mode, setMode] = useState<PreviewMode | null>(null)
  const [runKey, setRunKey] = useState(0)

  const reward = useMemo(() => mockPackOpenReward(category), [category])

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
          Uses mock prizes only; no SOL is spent.
        </p>

        <div className="mt-4">
          <Label htmlFor="packs-preview-category">Mock prize type</Label>
          <select
            id="packs-preview-category"
            className="mt-1 flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as 'owl' | 'sol' | 'nft')}
          >
            <option value="nft">NFT win</option>
            <option value="sol">SOL win</option>
            <option value="owl">$OWL win</option>
          </select>
        </div>

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
