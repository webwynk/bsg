import { AlertCircle } from "lucide-react"

/**
 * Issue #15: shared error display for a page's initial data load. Every
 * list/metrics-fetching action returns `{ ...data, error: string | null }` --
 * this is the one place that error is ever actually shown to the user,
 * instead of a real backend failure silently rendering as empty/zero data.
 * Renders nothing when `error` is null, so call sites can use it
 * unconditionally: `<ErrorBanner error={loadError} />`.
 */
export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="p-2.5 text-xs font-bold rounded-lg bg-danger-bg text-danger-text border border-red-500/20 flex items-center gap-2">
      <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
      <span>{error}</span>
    </div>
  )
}
