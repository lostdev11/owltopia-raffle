/**
 * Shown while the raffle detail page loads. Parent /raffles/loading.tsx is list-oriented;
 * detail URLs need their own loading UI so users don't see "Loading raffles..." on a single raffle.
 */
export default function RaffleDetailLoading() {
  return (
    <div className="container mx-auto py-4 sm:py-6 md:py-8 px-3 sm:px-4">
      <div className="mb-6 sm:mb-8">
        <div className="h-9 sm:h-10 md:h-12 w-64 sm:w-80 bg-muted/50 rounded animate-pulse mb-2" />
        <div className="h-5 sm:h-6 w-48 sm:w-56 bg-muted/40 rounded animate-pulse" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="aspect-square max-h-[480px] w-full bg-muted/30 rounded-xl animate-pulse" />
        <div className="space-y-4">
          <div className="h-10 w-32 bg-muted/50 rounded animate-pulse" />
          <div className="h-24 bg-muted/30 rounded-lg animate-pulse" />
          <div className="h-12 bg-muted/40 rounded-lg animate-pulse" />
          <p className="text-muted-foreground">Loading raffle…</p>
        </div>
      </div>
    </div>
  )
}
