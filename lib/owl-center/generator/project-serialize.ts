import type { GeneratorProject } from '@/lib/owl-center/generator/types'

export const MAX_GENERATOR_TRAITS = 120
export const MAX_GENERATOR_PROJECT_BYTES = 6 * 1024 * 1024

export function validateGeneratorProjectPayload(raw: unknown): { ok: true; project: GeneratorProject } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid project body' }
  const p = raw as Partial<GeneratorProject>
  if (!p.id || typeof p.id !== 'string') return { ok: false, error: 'Missing project id' }
  if (!p.collectionName || typeof p.collectionName !== 'string') {
    return { ok: false, error: 'Missing collection name' }
  }
  if (!Array.isArray(p.categories) || !Array.isArray(p.traits) || !Array.isArray(p.rules)) {
    return { ok: false, error: 'Invalid project shape' }
  }
  if (p.traits.length > MAX_GENERATOR_TRAITS) {
    return { ok: false, error: `Max ${MAX_GENERATOR_TRAITS} traits per cloud project` }
  }
  const project: GeneratorProject = {
    id: p.id,
    name: typeof p.name === 'string' ? p.name.slice(0, 120) : 'My Collection',
    collectionName: p.collectionName.slice(0, 120),
    symbol: typeof p.symbol === 'string' ? p.symbol.slice(0, 10) : 'OWL',
    description: typeof p.description === 'string' ? p.description.slice(0, 4000) : '',
    categories: p.categories as GeneratorProject['categories'],
    traits: p.traits as GeneratorProject['traits'],
    rules: p.rules as GeneratorProject['rules'],
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
    targetSupply:
      typeof p.targetSupply === 'number' && Number.isInteger(p.targetSupply) && p.targetSupply > 0
        ? Math.min(p.targetSupply, 1_000_000)
        : undefined,
  }
  return { ok: true, project }
}

export function projectJsonByteSize(project: GeneratorProject): number {
  return new TextEncoder().encode(JSON.stringify(project)).length
}
