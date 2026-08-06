import * as React from "react"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  totalItems: number
  itemsPerPage: number
}

const ELLIPSIS = -1

/**
 * Page numbers to render: always the first and last, plus a window around the
 * current page, with gaps collapsed to an ellipsis.
 *   1 … 4 5 6 … 42
 */
function pageWindow(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages = new Set<number>([1, total, current])
  if (current - 1 > 1) pages.add(current - 1)
  if (current + 1 < total) pages.add(current + 1)
  // Keep the row a stable width near the ends.
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4) }
  if (current >= total - 2) { pages.add(total - 1); pages.add(total - 2); pages.add(total - 3) }

  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b)

  const out: number[] = []
  let previous = 0
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push(ELLIPSIS)
    out.push(p)
    previous = p
  }
  return out
}

export function ResponsivePagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  itemsPerPage,
}: PaginationProps) {
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 border-t border-border bg-card">
      {/* Desktop Info Text */}
      <div className="hidden md:block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Showing {startItem}–{endItem} of {totalItems} entries
      </div>

      {/* Mobile Simplified Control */}
      <div className="flex md:hidden items-center justify-between w-full">
        <Button
          variant="outline"
          size="default"
          onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
          disabled={currentPage === 1}
          className="flex-1 h-11 font-bold border-border cursor-pointer select-none"
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Prev
        </Button>
        <span className="flex-1 text-center text-xs font-bold text-foreground">
          Page {currentPage} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="default"
          onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
          disabled={currentPage === totalPages}
          className="flex-1 h-11 font-bold border-border cursor-pointer select-none"
        >
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>

      {/* Desktop Controller */}
      <div className="hidden md:flex items-center space-x-1.5 self-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
          disabled={currentPage === 1}
          className="border-border cursor-pointer select-none"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* B-8 FIX: a windowed pager. This rendered one button per page via
            Array.from({ length: totalPages }), so a few hundred records
            produced hundreds of buttons across the layout. */}
        {pageWindow(currentPage, totalPages).map((pageNum, i) =>
          pageNum === ELLIPSIS ? (
            <span key={`gap-${i}`} className="px-1 text-muted-foreground select-none">…</span>
          ) : (
            <Button
              key={pageNum}
              variant={currentPage === pageNum ? "default" : "ghost"}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              className={`h-8 w-8 font-semibold cursor-pointer ${
                currentPage === pageNum ? "bg-primary text-primary-foreground font-extrabold shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {pageNum}
            </Button>
          )
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
          disabled={currentPage === totalPages}
          className="border-border cursor-pointer select-none"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
