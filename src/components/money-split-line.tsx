import { formatSplitValue, type SplitKind } from '@/lib/money-totals-logic'

/**
 * The small line under a combined money figure: how much of it came from each
 * game, e.g. "Triple Chance 8,000 · Lucky Card 1,500" (user decision 2026-10-07,
 * spec 17AY). The big figure above it is the two added together; this shows the
 * shares. On a narrow screen the two games stack on two lines; from the small
 * breakpoint up they sit side by side and wrap only when the card is narrow. No
 * separator dot: a wrapped line would leave it dangling at a line end.
 */
export function MoneySplitLine({
  triple,
  lucky,
  kind = 'money',
  className = '',
}: {
  triple: number
  lucky: number
  kind?: SplitKind
  className?: string
}) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:flex-wrap sm:gap-x-2.5 text-[9px] font-mono font-semibold leading-tight text-muted-foreground/80 ${className}`}
      aria-label="Split by game"
    >
      <span>Triple Chance {formatSplitValue(triple, kind)}</span>
      <span>Lucky Card {formatSplitValue(lucky, kind)}</span>
    </div>
  )
}
