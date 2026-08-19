'use client'

type Tone = 'success' | 'error'

export function OwlCenterSaveNotice({
  message,
  tone = 'success',
}: {
  message: string | null | undefined
  tone?: Tone
}) {
  if (!message) return null
  const ok = tone === 'success'
  return (
    <p
      role="status"
      aria-live="polite"
      className={
        ok
          ? 'rounded border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-3 py-3 font-mono text-sm font-semibold text-[#00FF9C]'
          : 'rounded border border-[#FF9C9C]/40 bg-[#FF9C9C]/10 px-3 py-3 font-mono text-sm font-semibold text-[#FF9C9C]'
      }
    >
      {message}
    </p>
  )
}
