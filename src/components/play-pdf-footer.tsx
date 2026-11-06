"use client"

import * as React from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildPlayPdf, playPdfFileName, type PlayPdfData } from '@/lib/play-pdf'

/**
 * The foot of the Lucky Card, Lucky 16 and Spin2Win play popups: the Download PDF
 * button, matching the Triple Chance popup's. jsPDF loads only when pressed.
 */
export function PlayPdfFooter({ data }: { data: () => PlayPdfData }) {
  const [isDownloading, setIsDownloading] = React.useState(false)

  async function handleDownload() {
    if (isDownloading) return
    setIsDownloading(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const content = data()
      buildPlayPdf(jsPDF, content).save(playPdfFileName(content))
    } catch (e) {
      console.error('PDF generation failed:', e)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="flex items-center justify-between px-4 sm:px-5 py-2.5 border-t border-slate-200 bg-slate-50/80 rounded-b-2xl">
      <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">
        Game play receipt & details
      </span>
      <Button
        onClick={handleDownload}
        disabled={isDownloading}
        className="gap-2 text-xs font-bold h-8 px-3.5 rounded-lg cursor-pointer ml-auto shadow-xs hover:opacity-95 transition-opacity"
        style={{
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: '#ffffff',
          border: 'none',
        }}
      >
        {isDownloading ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Generating PDF…</span>
          </>
        ) : (
          <>
            <Download className="h-3.5 w-3.5" />
            <span>Download PDF</span>
          </>
        )}
      </Button>
    </div>
  )
}
