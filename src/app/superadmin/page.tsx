"use client"

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Users, DollarSign, Activity, Percent, Settings2, ShieldCheck, TrendingUp, RefreshCw } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'

const MOCK_RECENT_SYSTEM_LOGS = [
  { id: 'LOG-001', type: 'System', detail: 'Agent "agent_alpha" balance topped up by ₹50,000.00', time: '5 mins ago' },
  { id: 'LOG-002', type: 'Game', detail: 'Player "rahul99" won ₹2,500.00 on Wheel of Fortune', time: '12 mins ago' },
  { id: 'LOG-003', type: 'Security', detail: 'Admin login detected from IP 192.168.1.45', time: '30 mins ago' },
  { id: 'LOG-004', type: 'Agent', detail: 'Agent "agent_beta" registered player "neil_k"', time: '1 hour ago' },
]

export default function SuperAdminDashboard() {
  const [rtpValue, setRtpValue] = React.useState(96.5)

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 md:px-0">
      {/* Page Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent">
            System Overview
          </h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Real-time management dashboard and network controls (God Mode).
          </p>
        </div>
        <Button variant="outline" size="sm" className="w-fit self-start md:self-auto hover:bg-secondary">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin-slow" /> Refresh Metrics
        </Button>
      </div>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-min">
        {/* Bento Card 1: Total Points Issued */}
        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md hover:scale-[1.01] transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Points Issued</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <DollarSign className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-3xl font-bold font-mono tracking-tight">12,450,000</div>
            <div className="flex items-center space-x-1.5 mt-2">
              <TrendingUp className="h-3.5 w-3.5 text-success-text" />
              <span className="text-xs font-semibold text-success-text">+2.1%</span>
              <span className="text-xs text-muted-foreground">from last week</span>
            </div>
          </CardContent>
        </Card>

        {/* Bento Card 2: Active Agent Count */}
        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md hover:scale-[1.01] transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active Agents</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <Users className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-3xl font-bold font-mono tracking-tight">142</div>
            <p className="text-xs text-muted-foreground mt-2">
              <span className="font-semibold text-foreground">12 new</span> accounts registered today
            </p>
          </CardContent>
        </Card>

        {/* Bento Card 3: Global System RTP status */}
        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md hover:scale-[1.01] transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Global RTP Target</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
              <Percent className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-3xl font-bold font-mono tracking-tight text-amber-500">{rtpValue}%</div>
            <div className="flex items-center space-x-1.5 mt-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">Active optimization cycle</span>
            </div>
          </CardContent>
        </Card>

        {/* Bento Card 4: Bets Placed */}
        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md hover:scale-[1.01] transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Bets (24h)</span>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
              <Activity className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-3xl font-bold font-mono tracking-tight">8,234</div>
            <p className="text-xs text-muted-foreground mt-2">
              Peak traffic: <span className="font-semibold text-foreground">1,240 rpm</span>
            </p>
          </CardContent>
        </Card>

        {/* Bento Card 5: RTP Control Slider Settings (Wide: Col-span 2 on Desktop) */}
        <Card className="md:col-span-2 bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-all duration-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded bg-primary/10 text-primary">
                  <Settings2 className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold">RTP Configuration</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Adjust theoretical payouts across slots and tables.
                  </CardDescription>
                </div>
              </div>
              <span className="font-bold text-amber-500 text-2xl font-mono">{rtpValue}%</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <Slider 
                value={[rtpValue]}
                onValueChange={(val) => {
                  if (typeof val === 'number') {
                    setRtpValue(val)
                  } else if (Array.isArray(val) && typeof val[0] === 'number') {
                    setRtpValue(val[0])
                  }
                }}
                max={99} 
                min={80} 
                step={0.1}
                className="py-4 cursor-pointer"
              />
              <div className="grid grid-cols-3 text-center text-xs text-muted-foreground font-semibold">
                <span className="text-left">Tight (80%)</span>
                <span>Normal (95%)</span>
                <span className="text-right">Loose (99%)</span>
              </div>
            </div>

            {/* Presets */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Presets</span>
              <div className="grid grid-cols-4 gap-2">
                {[85, 92, 96.5, 98.5].map((preset) => (
                  <Button
                    key={preset}
                    variant={rtpValue === preset ? "default" : "outline"}
                    size="sm"
                    onClick={() => setRtpValue(preset)}
                    className="w-full text-xs font-bold border-border cursor-pointer transition-all active:scale-95"
                  >
                    {preset}%
                  </Button>
                ))}
              </div>
            </div>

            <Button className="w-full font-bold cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90">
              Apply Configuration
            </Button>
          </CardContent>
        </Card>

        {/* Bento Card 6: Recent Activity Audit Logs (Wide: Col-span 2 on Desktop) */}
        <Card className="md:col-span-2 bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-all duration-200">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <div className="p-2 rounded bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold">Recent System Logs</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Live audit logs of administrative actions.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="relative">
            {/* Timeline connector line */}
            <div className="absolute left-[27px] top-[24px] bottom-[24px] w-0.5 bg-border/60" />

            <div className="space-y-4">
              {MOCK_RECENT_SYSTEM_LOGS.map((log) => (
                <div key={log.id} className="relative pl-8 flex items-start justify-between gap-4 py-1">
                  {/* Timeline dot */}
                  <span className={`absolute left-[6px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-card bg-background flex items-center justify-center`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      log.type === 'Security' ? 'bg-danger' :
                      log.type === 'System' ? 'bg-success' : 'bg-info'
                    }`} />
                  </span>

                  <div className="space-y-1 min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground leading-normal pr-2">
                      {log.detail}
                    </p>
                    <span className="text-[11px] font-medium text-muted-foreground">{log.time}</span>
                  </div>

                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    log.type === 'Security' ? 'bg-danger-bg text-danger-text' :
                    log.type === 'System' ? 'bg-success-bg text-success-text' : 'bg-info-bg text-info-text'
                  }`}>
                    {log.type}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Database Warning Bar */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-center space-x-3">
        <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping shrink-0" />
        <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
          <strong>Database Notice:</strong> Currently utilizing mock client data. Live Supabase database integration is pending.
        </p>
      </div>
    </div>
  )
}
