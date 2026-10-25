"use client"

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { formatCurrency } from "@/lib/utils"
import {
  bonusColors,
  bonusLabel,
  numberColor,
  type PlayerSpin2WinPlay,
} from "@/lib/spin2win"

/**
 * Full-detail popup for one Spin2Win play: who played, which round, the winning
 * number and the round's bonus, the bet and the win, and the ten numbers with
 * the coins the player put on each (the winning number highlighted).
 *
 * Built like lucky-card-play-detail-dialog.tsx, which is left untouched. No PDF
 * download, the same as Lucky Card. Shared by the agent and superadmin player
 * pages, so it takes only the play and the player's name. Drawn on a white
 * panel like the other games' popups, so it reads the same in both themes.
 */
export function Spin2WinPlayDetailDialog({
  play,
  playerFullName,
  playerUsername,
  trigger,
}: {
  play: PlayerSpin2WinPlay
  playerFullName: string
  playerUsername: string
  trigger: React.ReactElement
}) {
  const [isOpen, setIsOpen] = React.useState(false)
  const net = play.total_payout - play.total_stake
  const bonus = bonusColors(play.bonus_multiplier)

  const statusStyle =
    play.outcome === 'WON'
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
      : play.outcome === 'LOST'
        ? 'bg-red-50 text-red-700 border border-red-300'
        : 'bg-amber-50 text-amber-700 border border-amber-300'
  const dotStyle =
    play.outcome === 'WON' ? 'bg-emerald-500' : play.outcome === 'LOST' ? 'bg-red-500' : 'bg-amber-500'

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent
        className="w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] max-w-[95vw] lg:max-w-[760px] max-h-[92vh] overflow-y-auto rounded-2xl p-0 border border-slate-200 shadow-2xl"
        style={{ background: '#ffffff', color: '#1e293b' }}
      >
        <div
          className="h-1 w-full rounded-t-2xl"
          style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899, #f59e0b)' }}
        />

        <div className="px-4 sm:px-5 pt-3 pb-2 border-b border-slate-100 flex items-center justify-between">
          <DialogHeader>
            <DialogTitle className="text-sm sm:text-base font-black tracking-tight" style={{ color: '#0f172a' }}>
              Spin2Win Play Details
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-4 sm:px-5 py-3 space-y-3" style={{ background: '#ffffff' }}>
          {/* Identity: player, game, date, round id */}
          <div className="p-2.5 sm:p-3 rounded-xl bg-slate-50/90 border border-slate-200/80 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                  style={{ background: '#eef2ff', color: '#6366f1', border: '1.5px solid #c7d2fe' }}
                >
                  {playerFullName[0]?.toUpperCase() || 'P'}
                </div>
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-xs sm:text-sm font-black text-slate-900 truncate">{playerFullName}</span>
                  <span className="text-[11px] font-mono text-slate-400 truncate">@{playerUsername}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold"
                  style={{ background: '#ffffff', color: '#475569', border: '1px solid #e2e8f0' }}
                >
                  Spin2Win
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono text-slate-500 bg-white border border-slate-200">
                  {play.created_at}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1.5 border-t border-slate-200/70 text-[11px] font-mono">
              <span>
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 mr-1.5">Round:</span>
                <span className="font-bold text-slate-700">#{play.round_number}</span>
              </span>
              <span className="min-w-0 flex items-center gap-1.5">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 shrink-0">Hand ID:</span>
                <span className="font-bold text-slate-700 break-all select-all">{play.hand_id}</span>
              </span>
            </div>
          </div>

          {/* Winning number, bet, win, status */}
          <div className="grid grid-cols-2 lg:grid-cols-4 rounded-xl bg-slate-50/90 border border-slate-200/80 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/80 overflow-hidden">
            <div className="flex flex-col items-center justify-center py-2.5 px-3">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Winning Number</span>
              {play.winning_number !== null ? (
                <span
                  className="w-10 h-10 rounded-full inline-flex items-center justify-center text-xl font-black font-mono leading-none text-white"
                  style={{ background: numberColor(play.winning_number), boxShadow: `0 0 10px ${numberColor(play.winning_number)}80` }}
                >
                  {play.winning_number}
                </span>
              ) : (
                <span className="text-xs font-bold text-slate-400">Not drawn yet</span>
              )}
              <span
                className="mt-1.5 inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black tracking-wide text-white"
                style={{ background: `linear-gradient(180deg, ${bonus.light}, ${bonus.dark})` }}
              >
                {bonusLabel(play.bonus_multiplier)}
              </span>
            </div>

            <div className="flex flex-col items-center justify-center py-2.5 px-3">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Total Bet</span>
              <span className="text-sm sm:text-base font-black font-mono text-slate-900">{formatCurrency(play.total_stake)}</span>
            </div>

            <div className="flex flex-col items-center justify-center py-2.5 px-3">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Total Win</span>
              <span className={`text-sm sm:text-base font-black font-mono ${play.total_payout > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                {play.total_payout > 0 ? `+${formatCurrency(play.total_payout)}` : '-'}
              </span>
              {play.outcome !== 'PENDING' && (
                <span className={`text-[10px] font-mono font-bold mt-0.5 ${net >= 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                  net {net >= 0 ? '+' : ''}{formatCurrency(net)}
                </span>
              )}
            </div>

            <div className="flex flex-col items-center justify-center py-2.5 px-3">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Status</span>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] sm:text-xs font-black tracking-wide ${statusStyle}`}>
                <span className={`w-2 h-2 rounded-full ${dotStyle}`} />
                {play.outcome}
              </span>
            </div>
          </div>

          {/* The ten numbers, 0-4 on top and 5-9 below */}
          <div className="space-y-1.5 pb-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500">Coins on each number</span>
              <span className="text-[10px] text-slate-400">the winning number is highlighted</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5" role="table" aria-label="Coins the player put on each number">
              {play.stakes.map(cell => {
                const bet = cell.amount > 0
                const color = numberColor(cell.number)
                return (
                  <div
                    key={cell.number}
                    role="cell"
                    className={`rounded-lg border px-1.5 py-2 text-center ${
                      cell.isWinner
                        ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-300'
                        : bet
                          ? 'bg-indigo-50/60 border-indigo-200'
                          : 'bg-white border-slate-200'
                    }`}
                    style={cell.isWinner ? { boxShadow: `0 0 12px ${color}66` } : undefined}
                  >
                    <span
                      className="mx-auto w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-sm sm:text-base font-black font-mono leading-none text-white"
                      style={{ background: color, opacity: bet || cell.isWinner ? 1 : 0.45 }}
                    >
                      {cell.number}
                    </span>
                    <div className={`mt-1 text-[11px] font-mono font-bold ${bet ? 'text-slate-800' : 'text-slate-300'}`}>
                      {bet ? formatCurrency(cell.amount) : '–'}
                    </div>
                    {cell.isWinner && (
                      <div className="mt-0.5 text-[8px] font-black uppercase tracking-wider text-emerald-700">
                        {bet ? 'winner' : 'winner · no bet'}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
