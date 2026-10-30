import { formatSplitValue, type SplitKind } from '@/lib/money-totals-logic'

/**
 * The small line under a combined money figure: how much of it came from each
 * game, e.g. "Triple Chance 8,000 · Lucky Card 1,500 · Spin2Win 700 · Lucky 16
 * Card 300" (user decision 2026-10-07, spec 17AY; Spin2Win added 2026-10-25,
 * Lucky 16 Card added 2026-10-30). The big figure above it is the games added
 * together; this shows the shares. `spin` and `l16` are optional: when one is
 * left out, that game's entry is not shown. On a narrow
 * screen the games stack on separate lines; from the small breakpoint up they
 * sit side by side and wrap only when the card is narrow. No
 * separator dot: a wrapped line would leave it dangling at a line end.
 */
export function MoneySplitLine({
  triple,
  lucky,
  spin,
  l16,
  kind = 'money',
  className = '',
}: {
  triple: number
  lucky: number
  spin?: number
  l16?: number
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
      {spin !== undefined && <span>Spin2Win {formatSplitValue(spin, kind)}</span>}
      {l16 !== undefined && <span>Lucky 16 Card {formatSplitValue(l16, kind)}</span>}
    </div>
  )
}
