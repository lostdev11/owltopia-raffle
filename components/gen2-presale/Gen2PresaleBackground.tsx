'use client'

export function Gen2PresaleBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[#0B0F12]" />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,229,139,0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,229,139,0.15) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />
      <div className="absolute top-1/2 left-1/2 h-[120vmin] w-[120vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,255,156,0.08)_0%,transparent_55%)]" />
      <div
        className="absolute top-1/2 left-1/2 h-[min(100vw,900px)] w-[min(100vw,900px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.06] animate-gen2-radar"
        style={{
          background:
            'conic-gradient(from 0deg, transparent 0deg, rgba(0,229,139,0.35) 36deg, transparent 72deg)',
        }}
      />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2248%22%20height=%2248%22%3E%3Cpath%20d=%22M8%2024c8-6%2016-6%2024%200%203%202%204%204%202%208-4%2016-4%2024%200%22%20fill=%22none%22%20stroke=%22%2300E58B%22%20stroke-opacity=%22.06%22/%3E%3C/svg%3E')] opacity-40" />
    </div>
  )
}
