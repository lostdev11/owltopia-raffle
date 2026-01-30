/**
 * Shown while server fetches raffles (force-dynamic). Prevents blank screen on slow/blocked requests.
 */
export default function RafflesLoading() {
  return (
    <div className="container mx-auto py-4 sm:py-6 md:py-8 px-3 sm:px-4">
      <div className="mb-6 sm:mb-8">
        <div className="h-9 sm:h-10 md:h-12 w-48 sm:w-56 bg-muted/50 rounded animate-pulse mb-2" />
        <div className="h-5 sm:h-6 w-72 sm:w-80 bg-muted/40 rounded animate-pulse" />
      </div>
      <div className="mb-8 sm:mb-12">
        <div className="h-7 sm:h-8 w-36 mb-4 sm:mb-6 bg-muted/50 rounded animate-pulse" />
        <p className="text-muted-foreground">Loading raffles...</p>
        <div className="mt-4 flex flex-col gap-3 max-w-md">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
