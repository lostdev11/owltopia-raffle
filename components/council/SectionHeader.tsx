type SectionHeaderProps = {
  title: string
  description?: string
}

export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="mb-4 sm:mb-6">
      <h2 className="font-display text-xl sm:text-2xl tracking-wide text-theme-prime drop-shadow-[0_0_12px_rgba(0,255,136,0.25)]">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p>
      ) : null}
    </div>
  )
}
