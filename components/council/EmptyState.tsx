type EmptyStateProps = {
  title: string
  body?: string
}

export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <div
      className="rounded-xl border border-border/60 bg-background/40 px-4 py-10 text-center"
      role="status"
    >
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {body ? <p className="mt-2 text-xs text-muted-foreground/90 max-w-md mx-auto">{body}</p> : null}
    </div>
  )
}
