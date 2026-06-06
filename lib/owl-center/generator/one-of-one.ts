import type {
  GeneratedNft,
  GeneratorProject,
  OneOfOneEntry,
  OneOfOnePlacement,
} from '@/lib/owl-center/generator/types'

export const DEFAULT_ONE_OF_ONE_TRAIT_TYPE = 'Special'

export function normalizeOneOfOnePlacement(
  placement: OneOfOnePlacement | undefined
): OneOfOnePlacement {
  return placement === 'start' || placement === 'end' || placement === 'random' ? placement : 'random'
}

export function oneOfOnesForProject(project: GeneratorProject): OneOfOneEntry[] {
  return project.oneOfOnes ?? []
}

/** Title-case a filename stem for default trait values (e.g. the-widow-king → The Widow King). */
export function defaultTraitValueFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  if (!base) return ''
  return base.replace(/\b\w/g, (c) => c.toUpperCase())
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function shuffleIndices(length: number, seedKey: string): number[] {
  const indices = Array.from({ length }, (_, i) => i)
  const rand = mulberry32(hashSeed(seedKey))
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  return indices
}

export function oneOfOneToGenerated(entry: OneOfOneEntry): GeneratedNft {
  return {
    index: -1,
    dna: `1of1-${entry.id}`,
    traits: [],
    attributes: [{ trait_type: entry.traitType.trim() || DEFAULT_ONE_OF_ONE_TRAIT_TYPE, value: entry.traitValue.trim() }],
    oneOfOneImageSrc: entry.imageSrc,
  }
}

/**
 * Merge generative combos with 1/1 slots. Total length = generative.length + oneOfOnes.length.
 * Re-indexes from 0..n-1 for Sugar export.
 */
export function mergeOneOfOnesIntoCollection(
  generative: GeneratedNft[],
  oneOfOnes: OneOfOneEntry[],
  placement: OneOfOnePlacement | undefined,
  seedKey: string
): GeneratedNft[] {
  if (!oneOfOnes.length) {
    return generative.map((g, i) => ({ ...g, index: i }))
  }

  const mode = normalizeOneOfOnePlacement(placement)
  const total = generative.length + oneOfOnes.length
  const slots: (GeneratedNft | null)[] = Array.from({ length: total }, () => null)
  const oneOfOneNfts = oneOfOnes.map(oneOfOneToGenerated)

  let oneOfOneIndices: number[]
  if (mode === 'start') {
    oneOfOneIndices = Array.from({ length: oneOfOnes.length }, (_, i) => i)
  } else if (mode === 'end') {
    oneOfOneIndices = Array.from({ length: oneOfOnes.length }, (_, i) => total - oneOfOnes.length + i)
  } else {
    oneOfOneIndices = shuffleIndices(total, `${seedKey}:1of1`).slice(0, oneOfOnes.length)
  }

  for (let o = 0; o < oneOfOneIndices.length; o++) {
    slots[oneOfOneIndices[o]!] = oneOfOneNfts[o]!
  }

  let genCursor = 0
  for (let i = 0; i < total; i++) {
    if (slots[i]) continue
    slots[i] = generative[genCursor] ?? null
    genCursor++
  }

  return slots
    .filter((s): s is GeneratedNft => Boolean(s))
    .map((nft, index) => ({ ...nft, index }))
}

/** Generative count that fits target supply once 1/1 slots are reserved. */
export function generativeCountForSupply(totalSupply: number, oneOfOneCount: number): number {
  return Math.max(0, totalSupply - oneOfOneCount)
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  if (!res.ok) throw new Error('Failed to read 1/1 image')
  return res.blob()
}
