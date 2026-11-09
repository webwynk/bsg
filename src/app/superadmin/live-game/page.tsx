"use client"

import { useState } from 'react'
import { TripleChanceLive } from './triple-chance-live'
import { LuckyCardLive } from './lucky-card-live'
import { Spin2WinLive } from './spin2win-live'
import { Lucky16Live } from './lucky16-live'
import {
  Radio,
  Gamepad2,
  Sparkles,
  CircleDot,
} from 'lucide-react'

export default function SuperAdminLiveGamePage() {
  const [selectedGameTab, setSelectedGameTab] = useState<'triple_chance' | 'lucky_card' | 'spin2win' | 'lucky16'>('triple_chance')

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card p-4 sm:p-5 rounded-2xl border border-border shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">Live Game Telemetry</h1>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              Real-time 24/7 global round outcome monitor & draw history ledger.
            </p>
          </div>
        </div>
      </div>

      {/* Game Selector Tabs */}
      <div className="flex items-center justify-between border-b border-border/80 pb-2">
        <div className="flex items-center space-x-1 sm:space-x-2">
          <button
            onClick={() => setSelectedGameTab('triple_chance')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              selectedGameTab === 'triple_chance'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Gamepad2 className="h-4 w-4" />
            <span>Triple Chance</span>
          </button>

          <button
            onClick={() => setSelectedGameTab('lucky_card')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              selectedGameTab === 'lucky_card'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            <span>Lucky Card</span>
          </button>

          <button
            onClick={() => setSelectedGameTab('spin2win')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              selectedGameTab === 'spin2win'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <CircleDot className="h-4 w-4" />
            <span>Spin2Win</span>
          </button>

          <button
            onClick={() => setSelectedGameTab('lucky16')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              selectedGameTab === 'lucky16'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            <span>Lucky 16 Card</span>
          </button>
        </div>
      </div>

      {/* Main Active View */}
      {selectedGameTab === 'triple_chance' && <TripleChanceLive />}
      {selectedGameTab === 'lucky_card' && <LuckyCardLive />}
      {selectedGameTab === 'spin2win' && <Spin2WinLive />}
      {selectedGameTab === 'lucky16' && <Lucky16Live />}
    </div>
  )
}
