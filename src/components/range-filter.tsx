'use client'

import * as React from 'react'
import type { DateRange as PickedRange } from 'react-day-picker'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarIcon } from 'lucide-react'
import { pickedDayKey } from '@/lib/date-range'
import { GAMEPLAY_PRESETS, rangeLabel, type DayRange, type GameplayPreset } from '@/lib/gameplay-range'

/** The chosen filter: a preset, or (preset null) a custom range of IST days. */
export interface RangeChoice {
  preset: GameplayPreset | null
  custom: DayRange | null
}

/**
 * Date filter shared by the dashboard's Gameplay & Bets Audit card and the
 * Player History page: preset pills (Today / Yesterday / 7 days / 30 days /
 * Lifetime) and a "Pick dates" calendar for any range of IST days.
 *
 * Calendar rules (tested 2026-11-07): react-day-picker's range mode already
 * reports a complete one-day range on the FIRST click, so a range is applied on
 * the second click; one click and closing, or the same day twice, = that day.
 * Every opening starts a fresh pick, opens on the chosen range's month (else
 * this month), and future days can't be picked. Days are read with
 * pickedDayKey, so the day clicked is the IST day used.
 */
export function RangeFilter({ value, onChange, presets = GAMEPLAY_PRESETS.map((p) => p.value), calendarFirst = false }: {
  value: RangeChoice
  onChange: (next: RangeChoice) => void
  /** Which presets to offer, in this order (default: all of GAMEPLAY_PRESETS). */
  presets?: readonly GameplayPreset[]
  /** Show "Pick dates" before the preset pills (the P&L Audit tab's order). */
  calendarFirst?: boolean
}) {
  const [picked, setPicked] = React.useState<PickedRange | undefined>(undefined)
  const [open, setOpen] = React.useState(false)
  const clicks = React.useRef(0)

  const applyPicked = (r: PickedRange | undefined) => {
    if (!r?.from) return
    const from = pickedDayKey(r.from)
    const to = pickedDayKey(r.to ?? r.from)
    onChange({ preset: null, custom: from <= to ? { from, to } : { from: to, to: from } })
  }

  const pills = (
    <div key="pills" className="flex items-center bg-secondary/40 border border-border/60 rounded-xl p-0.5 text-[10px] sm:text-[11px] font-bold overflow-x-auto table-scroll">
        {GAMEPLAY_PRESETS.filter((p) => presets.includes(p.value)).sort((a, b) => presets.indexOf(a.value) - presets.indexOf(b.value)).map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => { if (p.value !== value.preset) onChange({ preset: p.value, custom: null }) }}
            className={`px-2.5 py-1 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
              value.preset === p.value
                ? 'bg-primary text-primary-foreground font-black shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
    </div>
  )
  const calendar = (
      <Popover
        key="calendar"
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) { clicks.current = 0; setPicked(undefined); return }
          if (clicks.current === 1 && picked?.from) applyPicked({ from: picked.from, to: picked.from })
        }}
      >
        <PopoverTrigger
          className={`h-8 px-3 text-[11px] font-extrabold border rounded-xl flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-all ${
            value.preset === null
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border/80 bg-card hover:bg-secondary/60 text-foreground'
          }`}
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          {value.preset === null && value.custom ? rangeLabel(value.custom) : 'Pick dates'}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 bg-card border-border" align="end">
          <Calendar
            mode="range"
            selected={picked}
            onSelect={(r, clickedDay) => {
              clicks.current += 1
              if (clicks.current < 2) { setPicked(r); return }
              const range = r?.from ? r : { from: clickedDay, to: clickedDay }
              setPicked(range)
              applyPicked(range)
              setOpen(false)
            }}
            disabled={{ after: new Date() }}
            numberOfMonths={1}
            defaultMonth={value.preset === null && value.custom ? dayKeyToLocalDate(value.custom.to) : new Date()}
          />
          {/* w-0 min-w-full: the hint wraps to the calendar's width instead of widening the popover. */}
          <p className="w-0 min-w-full px-3 pb-2 text-[10px] leading-snug text-muted-foreground">Click a start day, then an end day (India time). One day: click it twice.</p>
        </PopoverContent>
      </Popover>
  )
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
      {calendarFirst ? [calendar, pills] : [pills, calendar]}
    </div>
  )
}

/** 'YYYY-MM-DD' as a local-midnight Date, the form the Calendar widget uses for a day. */
function dayKeyToLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** A pill-style tab (game tabs on the Gameplay card and the Player History page). */
export function PillTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer ${
        active
          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
          : 'bg-secondary/30 border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/60'
      }`}
    >
      {children}
    </button>
  )
}

/** One figure tile (label, big value, optional extra line and hint). */
export function StatTile({ label, hint, value, valueClass = 'text-foreground', loading, extra = null }: {
  label: string
  hint: string
  value: React.ReactNode
  valueClass?: string
  loading: boolean
  extra?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-secondary/20 p-2.5 sm:p-3 space-y-1 min-w-0">
      <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-muted-foreground block truncate">{label}</span>
      {loading ? (
        <div className="h-6 sm:h-7 w-20 bg-secondary/80 animate-pulse rounded" />
      ) : (
        <div className={`text-base sm:text-2xl font-black font-mono truncate ${valueClass}`}>{value}</div>
      )}
      {!loading && extra}
      <p className="text-[9px] text-muted-foreground/70 truncate">{hint}</p>
    </div>
  )
}
