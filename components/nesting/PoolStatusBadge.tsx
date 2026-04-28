import { Badge } from '@/components/ui/badge'

export function PoolStatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="bg-emerald-600/90 hover:bg-emerald-600 text-white border-0">Active</Badge>
  ) : (
    <Badge variant="secondary">Inactive</Badge>
  )
}
