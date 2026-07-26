"use client"

import * as React from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Users, Coins, Activity, Percent, Settings2, ShieldCheck, TrendingUp, RefreshCw, Check, Loader2, ArrowUpRight } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { getRtpAction, updateRtpAction, getAuditLogsAction, getSystemOverviewMetricsAction } from './actions'
import { formatCurrency } from '@/lib/utils'

export default function SuperAdminDashboard() {
  const [rtpValue, setRtpValue] = React.useState(96.5)
  const [totalCoins, setTotalCoins] = React.useState(0)
  const [todaysCoins, setTodaysCoins] = React.useState(0)
  const [activeAgents, setActiveAgents] = React.useState(0)
  const [activePlayers, setActivePlayers] = React.useState(0)
  const [totalBets24h, setTotalBets24h] = React.useState(0)
  const [systemLogs, setSystemLogs] = React.useState<Array<{ id: string; type: string; detail: string; time: string }>>([])
  const [isLoadingMetrics, setIsLoadingMetrics] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [isSavingRtp, setIsSavingRtp] = React.useState(false)
  const [rtpSuccess, setRtpSuccess] = React.useState<string | null>(null)

  const fetchMetrics = () => {
    setIsLoadingMetrics(true)
    Promise.all([
      getSystemOverviewMetricsAction(),
      getRtpAction(),
      getAuditLogsAction()
    ]).then(([resMetrics, resRtp, resLogs]) => {
      setIsLoadingMetrics(false)
      if (resMetrics) {
        setTotalCoins(resMetrics.totalCoins || 0)
        setTodaysCoins(resMetrics.todaysCoinsIssued || 0)
        setActiveAgents(resMetrics.activeAgents || 0)
        setActivePlayers(resMetrics.activePlayers || 0)
        setTotalBets24h(resMetrics.totalBets24h || 0)
      }
      if (resRtp?.rtp) {
        setRtpValue(resRtp.rtp)
      }
      if (resLogs?.logs) {
        setSystemLogs(resLogs.logs)
      }
    }).catch(() => setIsLoadingMetrics(false))
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
    fetchMetrics()
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
        {/* Bento Card 1: Today's Coins Issued (Clickable to /superadmin/agents/issued) */}
        <Link href="/superadmin/agents/issued" className="block cursor-pointer group">
          <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden group-hover:border-primary/50 group-hover:shadow-md group-hover:scale-[1.01] transition-all duration-200 h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
                Today&apos;s Coins Issued
              </span>
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                <Coins className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {isLoadingMetrics ? (
                <div className="h-8 w-28 bg-secondary/80 animate-pulse rounded my-1" />
              ) : (
                <div className="text-3xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
                  <span>{formatCurrency(todaysCoins)}</span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </div>
              )}
              <div className="flex items-center space-x-1.5 mt-2">
                <TrendingUp className="h-3.5 w-3.5 text-success-text" />
                <span className="text-xs font-semibold text-success-text">Given to agents today</span>
                <span className="text-[10px] text-muted-foreground font-semibold">(Click for ledger)</span>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Bento Card 2: Active Agent & Player Count */}
        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md hover:scale-[1.01] transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active Network</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <Users className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {isLoadingMetrics ? (
              <div className="h-8 w-24 bg-secondary/80 animate-pulse rounded my-1" />
            ) : (
              <div className="text-3xl font-bold font-mono tracking-tight">{activeAgents} <span className="text-sm font-normal text-muted-foreground">Agents</span></div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              <span className="font-semibold text-foreground">{activePlayers} registered</span> players network
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
            {isLoadingMetrics ? (
              <div className="h-8 w-20 bg-secondary/80 animate-pulse rounded my-1" />
            ) : (
              <div className="text-3xl font-bold font-mono tracking-tight text-amber-500">{rtpValue}%</div>
            )}
            <div className="flex items-center space-x-1.5 mt-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">Active optimization engine</span>
            </div>
          </CardContent>
        </Card>

        {/* Bento Card 4: Bets Placed (24h) */}
        <Card className="bg-card border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md hover:scale-[1.01] transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Bets (24h)</span>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
              <Activity className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {isLoadingMetrics ? (
              <div className="h-8 w-24 bg-secondary/80 animate-pulse rounded my-1" />
            ) : (
              <div className="text-3xl font-bold font-mono tracking-tight">{totalBets24h}</div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Coins bet in last <span className="font-semibold text-foreground">24 hours</span>
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
                min={50} 
                step={0.5}
                className="w-full cursor-pointer"
              />
              <div className="flex justify-between text-xs text-muted-foreground font-mono">
                <span>50% (High House Edge)</span>
                <span>99% (Low House Edge)</span>
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
            {isLoadingMetrics ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between gap-4 p-3 rounded-lg bg-secondary/20 animate-pulse border border-border/40">
                    <div className="h-4 bg-secondary/80 rounded w-2/3" />
                    <div className="h-4 bg-secondary/60 rounded w-1/6" />
                  </div>
                ))}
              </div>
            ) : systemLogs.length > 0 ? (
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
