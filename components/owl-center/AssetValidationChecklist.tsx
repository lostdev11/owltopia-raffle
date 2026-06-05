'use client'

import type { OwlCenterAssetValidationChecklist } from '@/lib/owl-center/asset-types'
import { calculateReadinessScore } from '@/lib/owl-center/asset-validation'
import { ReadinessChecklist, type ReadinessChecklistItem } from '@/components/owl-center/ReadinessChecklist'

const LABELS: { key: keyof OwlCenterAssetValidationChecklist; label: string }[] = [
  { key: 'image_count_matches_metadata_count', label: 'Image count matches metadata count' },
  { key: 'metadata_count_matches_supply', label: 'Metadata count matches collection supply' },
  { key: 'numeric_file_naming', label: 'Numeric file naming exists (e.g. 0.png / 0.json)' },
  { key: 'matching_image_json_pairs', label: 'Each NFT has matching image + JSON' },
  { key: 'json_has_name', label: 'Every JSON includes name' },
  { key: 'json_has_symbol', label: 'Every JSON includes symbol' },
  { key: 'json_has_description', label: 'Every JSON includes description' },
  { key: 'json_has_image', label: 'Every JSON includes image' },
  { key: 'json_has_attributes', label: 'Every JSON includes attributes' },
  { key: 'no_duplicate_names', label: 'No duplicate metadata names' },
  { key: 'no_missing_indices', label: 'No missing indices in sequence' },
  { key: 'image_references_match', label: 'Image references match uploaded image files' },
]

export function AssetValidationChecklist({
  checklist,
  onChange,
  disabled,
}: {
  checklist: OwlCenterAssetValidationChecklist
  onChange: (next: OwlCenterAssetValidationChecklist) => void
  disabled?: boolean
}) {
  const items: ReadinessChecklistItem[] = LABELS.map(({ key, label }) => ({
    id: key,
    label,
    checked: checklist[key],
  }))

  const score = calculateReadinessScore(checklist)

  const onToggle = (id: string, next: boolean) => {
    const key = id as keyof OwlCenterAssetValidationChecklist
    onChange({ ...checklist, [key]: next })
  }

  return (
    <div className="space-y-4">
      <ReadinessChecklist title="VALIDATION_CHECKLIST.sys" items={items} onToggle={onToggle} disabled={disabled} />
      <p className="font-mono text-[10px] text-[#5C6773]">
        Completion {score}% — when all items pass, you can mark VALID or Ready for Candy Machine.
      </p>
    </div>
  )
}
