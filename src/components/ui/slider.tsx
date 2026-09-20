import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

/**
 * formatValue: how the live drag tooltip renders each thumb's value (e.g.
 * `(v) => \`${v}%\`` for a percentage). Defaults to the plain number so this
 * stays a generic, reusable primitive -- callers that need a unit/suffix
 * pass their own formatter rather than this component hardcoding one.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  formatValue = (v: number) => `${v}`,
  ...props
}: SliderPrimitive.Root.Props & { formatValue?: (value: number) => string }) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      // Fix (dead/broken-code sweep): bare `data-horizontal`/`data-vertical`
      // shorthand never matched anything -- Base UI sets a KEY-VALUE
      // attribute (`data-orientation="horizontal"`/`"vertical"`), not a
      // differently-named boolean flag per orientation, so these classes
      // silently never applied. Empirically confirmed (compiled and
      // inspected the generated CSS) that the bracket form below actually
      // resolves to `[data-orientation="horizontal"]` etc. Zero visible
      // impact previously since this component is only ever used
      // horizontally and width already came from other classes regardless,
      // but a future `orientation="vertical"` usage would have rendered
      // broken/collapsed without this fix.
      className={cn("data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-secondary border border-border/80 shadow-inner select-none data-[orientation=horizontal]:h-3 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-3"
        >
          {/* Gradient fill instead of a flat color -- adds a touch of depth
              without needing a second element. */}
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-gradient-to-r from-primary/75 to-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="group relative block size-5 shrink-0 rounded-full border-2 border-primary bg-background shadow-md transition-all duration-150 select-none hover:scale-110 hover:ring-4 hover:ring-primary/15 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing data-[dragging]:scale-125 data-[dragging]:ring-8 data-[dragging]:ring-primary/20"
          >
            {/* Live value tooltip -- pure CSS, driven by Base UI's own
                data-dragging attribute (present on the Thumb while the user
                is actively dragging it, per @base-ui/react/slider), so no
                extra pointer-event tracking/state is needed here. Bracket
                variant syntax (data-[dragging]/group-data-[dragging]), not
                the bare data-dragging shorthand -- matches this project's
                own established convention for boolean data-attribute
                variants elsewhere (see components/ui/label.tsx's
                group-data-[disabled=true]), since bare shorthand is not
                reliably how Tailwind v4 resolves an attribute that has no
                fixed value. Fades and scales in on drag start, back out on
                release. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 scale-90 whitespace-nowrap rounded-md bg-primary px-2 py-1 text-[10px] font-bold font-mono text-primary-foreground opacity-0 shadow-md transition-all duration-150 group-data-[dragging]:scale-100 group-data-[dragging]:opacity-100"
            >
              {formatValue(_values[index])}
            </span>
          </SliderPrimitive.Thumb>
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
