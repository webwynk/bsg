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
  LC_RANKS,
  LC_SUITS,
  bonusLabel,
  suitIsRed,
  suitSymbol,
  type PlayerLuckyCardPlay,
} from "@/lib/lucky-card"

/**
 * Full-detail popup for one Lucky Card play: who played, which round, the winning
 * card and the round's bonus, the bet and the win, and the 12-card grid with the
 * coins the player put on each card (the winning card highlighted).
 *
 * The Lucky Card counterpart of game-play-detail-dialog.tsx (Triple Chance),
 * which is left untouched. No PDF download (user decision 2026-10-07, spec 17AT).
 * Shared by the agent and superadmin player pages, so it takes only the play
 * and the player's name, not a page-owned type. Drawn on a white panel like
 * the Triple Chance popup, so it reads the same in both themes.
 */
export function LuckyCardPlayDetailDialog({
  play,
  playerFullName,
  playerUsername,
  trigger,
}: {
  play: PlayerLuckyCardPlay
  playerFullName: string
  playerUsername: string
  trigger: React.ReactElement
}) {
  const [isOpen, setIsOpen] = React.useState(false)
  const net = play.total_payout - play.total_stake

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
              Lucky Card Play Details
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
                  Lucky Card
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

          {/* Winning card, bet, win, status */}
          <div className="grid grid-cols-2 lg:grid-cols-4 rounded-xl bg-slate-50/90 border border-slate-200/80 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/80 overflow-hidden">
            <div className="flex flex-col items-center justify-center py-2.5 px-3">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Winning Card</span>
              {play.rank && play.suit ? (
                <span
                  className="text-2xl font-black leading-none"
                  style={{ color: suitIsRed(play.suit) ? '#dc2626' : '#0f172a' }}
                >
                  {play.rank}{suitSymbol(play.suit)}
                </span>
              ) : (
                <span className="text-xs font-bold text-slate-400">Not drawn yet</span>
              )}
              <span
                className="mt-1.5 inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black tracking-wide"
                style={
                  play.bonus_multiplier === 1
                    ? { background: '#ffffff', color: '#64748b', border: '1px solid #e2e8f0' }
                    : { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }
                }
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

          {/* The 12 cards: rows J, Q, K; columns hearts, spades, diamonds, clubs */}
          <div className="space-y-1.5 pb-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500">Coins on each card</span>
              <span className="text-[10px] text-slate-400">the winning card is highlighted</span>
            </div>
            <div className="space-y-1.5" role="table" aria-label="Coins the player put on each card">
              {LC_RANKS.map((rank, r) => (
                <div key={rank} className="grid grid-cols-4 gap-1.5" role="row">
                  {LC_SUITS.map((suit, s) => {
                    const cell = play.stakes[r * LC_SUITS.length + s]
                    const bet = cell.amount > 0
                    return (
                      <div
                        key={suit}
                        role="cell"
                        className={`rounded-lg border px-1.5 py-2 text-center ${
                          cell.isWinner
                            ? 'bg-emerald-50 border-emerald-400 ring-1 ring-emerald-300'
                            : bet
                              ? 'bg-indigo-50/60 border-indigo-200'
                              : 'bg-white border-slate-200'
                        }`}
                      >
                        <div
                          className="text-base sm:text-lg font-black leading-none"
                          style={{ color: suitIsRed(suit) ? '#dc2626' : '#0f172a' }}
                        >
                          {rank}{suitSymbol(suit)}
                        </div>
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
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
