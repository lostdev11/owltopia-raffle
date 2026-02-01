import { ReactNode } from 'react'

// Prevent static prerender of /admin — wallet adapter hooks (useMemo, etc.) require
// client/browser context and fail during build when React is not fully available.
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
