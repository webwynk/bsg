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

        {Array.from({ length: totalPages }, (_, index) => {
          const pageNum = index + 1
          return (
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
        })}

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
