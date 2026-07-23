"use client"

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Users, Coins, Activity, Percent, Settings2, ShieldCheck, TrendingUp, RefreshCw, Check, Loader2 } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { getAgentsAction } from './agents/actions'
import { getRtpAction, updateRtpAction, getAuditLogsAction } from './actions'
import { formatCurrency } from '@/lib/utils'

export default function SuperAdminDashboard() {
  const [rtpValue, setRtpValue] = React.useState(96.5)
  const [totalCoins, setTotalCoins] = React.useState(0)
  const [activeAgents, setActiveAgents] = React.useState(0)
  const [totalBets] = React.useState(0)
  const [systemLogs, setSystemLogs] = React.useState<Array<{ id: string; type: string; detail: string; time: string }>>([])
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [isSavingRtp, setIsSavingRtp] = React.useState(false)
  const [rtpSuccess, setRtpSuccess] = React.useState<string | null>(null)

  const fetchMetrics = () => {
    getAgentsAction().then((res) => {
      if (res.agents) {
        setActiveAgents(res.agents.length)
        const total = res.agents.reduce((acc, a) => acc + (a.balance || 0), 0)
        setTotalCoins(total)
      }
    })
    getRtpAction().then((res) => {
      if (res.rtp) {
        setRtpValue(res.rtp)
      }
    })
    getAuditLogsAction().then((res) => {
      if (res.logs) {
        setSystemLogs(res.logs)
      }
    })
  }

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    fetchMetrics()
    setTimeout(() => setIsRefreshing(false), 500)
  }

  const handleApplyRtp = async () => {
    setIsSavingRtp(true)
    setRtpSuccess(null)
    const res = await updateRtpAction(rtpValue)
    setIsSavingRtp(false)
    if (res.success) {
      setRtpSuccess(`RTP successfully updated to ${rtpValue}%`)
      fetchMetrics()
      setTimeout(() => setRtpSuccess(null), 2500)
    }
  }

  React.useEffect(() => {
    let isMounted = true
    getAgentsAction().then((res) => {
      if (isMounted && res.agents) {
        setActiveAgents(res.agents.length)
        const total = res.agents.reduce((acc, a) => acc + (a.balance || 0), 0)
        setTotalCoins(total)
      }
    })
    getRtpAction().then((res) => {
      if (isMounted && res.rtp) {
        setRtpValue(res.rtp)
      }
    })
    getAuditLogsAction().then((res) => {
      if (isMounted && res.logs) {
        setSystemLogs(res.logs)
      }
    })
    return () => {
      isMounted = false
    }
  }, [])

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
        <Button onClick={handleManualRefresh} variant="outline" size="sm" className="w-fit self-start md:self-auto hover:bg-secondary cursor-pointer">
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh Metrics
        </Button>
      </div>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-min">
        {/* Bento Card 1: Total Coins Issued */}
        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md hover:scale-[1.01] transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Coins Issued</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <Coins className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-3xl font-bold font-mono tracking-tight">{formatCurrency(totalCoins)}</div>
            <div className="flex items-center space-x-1.5 mt-2">
              <TrendingUp className="h-3.5 w-3.5 text-success-text" />
              <span className="text-xs font-semibold text-success-text">Active</span>
              <span className="text-xs text-muted-foreground">live tracking</span>
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
            <div className="text-3xl font-bold font-mono tracking-tight">{activeAgents}</div>
            <p className="text-xs text-muted-foreground mt-2">
              <span className="font-semibold text-foreground">{activeAgents} registered</span> agent network
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
              <span className="text-xs text-muted-foreground">Active optimization engine</span>
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
            <div className="text-3xl font-bold font-mono tracking-tight">{totalBets}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Live traffic: <span className="font-semibold text-foreground">0 rpm</span>
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
            {rtpSuccess && (
              <div className="p-3 text-xs font-bold rounded-lg bg-success-bg text-success-text border border-emerald-500/20 flex items-center space-x-2">
                <Check className="h-4 w-4 text-success-text" />
                <span>{rtpSuccess}</span>
              </div>
            )}

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

            <Button 
              onClick={handleApplyRtp} 
              disabled={isSavingRtp}
              className="w-full font-bold cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSavingRtp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isSavingRtp ? 'Saving RTP...' : 'Apply Configuration'}
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
            {systemLogs.length > 0 ? (
              <div className="space-y-4 max-h-[260px] overflow-y-auto pr-1">
                {systemLogs.map((log) => (
                  <div key={log.id} className="relative pl-8 flex items-start justify-between gap-4 py-1">
                    <span className="absolute left-[6px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-card bg-background flex items-center justify-center">
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

                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                      log.type === 'Security' ? 'bg-danger-bg text-danger-text' :
                      log.type === 'System' ? 'bg-success-bg text-success-text' : 'bg-info-bg text-info-text'
                    }`}>
                      {log.type}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-muted-foreground font-medium">
                No system logs recorded yet. Real-time actions will appear here.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
