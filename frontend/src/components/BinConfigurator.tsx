'use client'

import { Info } from 'lucide-react'
import type { BinConfig } from '@/types'
import { NumericInput } from '@/components/NumericInput'
import { createPartialBinsValues } from '@/lib/binDefaults'
import { maxGridUnitsForOtherAxis } from '@/lib/constants'
import { BED_SIZE_MAX_MM, BED_SIZE_MIN_MM } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { ClassValue } from 'clsx'
import { useTheme } from '@/hooks/useTheme'

const GF_HEIGHT_UNIT = 7.0
const GF_BASE_HEIGHT = 4.75
// lip_d3 (1.2) + lip_d4 (2.6)
const LIP_NOTCH_DEPTH = 3.8

export function calcMaxCutoutDepth(heightUnits: number, stackingLip: boolean): number {
  const wallTopZ = heightUnits * GF_HEIGHT_UNIT
  const lipDeduction = stackingLip ? LIP_NOTCH_DEPTH : 0
  return Math.max(5, wallTopZ - GF_BASE_HEIGHT - 2 - lipDeduction)
}

interface Props {
  config: BinConfig
  onChange: (config: BinConfig) => void
  autoSize?: boolean
  onAutoSizeChange?: (v: boolean) => void
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="group ml-1">
      <Info className="w-3 h-3 text-text-muted cursor-help inline-block" />
      <span className="absolute left-0 right-0 bottom-full mb-1.5 px-2 py-1.5 text-[11px] leading-tight text-text-primary bg-elevated border border-border-subtle rounded whitespace-normal opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-30 shadow-lg">
        {text}
      </span>
    </span>
  )
}

function Toggle({ checked, onChange, label, help, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string; disabled?: boolean }) {
  return (
    <div className={`relative flex items-center justify-between py-2 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <span className="text-xs text-text-primary tracking-[0.3px]">
        {label}
        {help && <HelpTip text={help} />}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded transition-colors ${
          checked ? 'bg-accent' : 'bg-elevated'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-sm transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
          style={{
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: checked ? '#3096bc' : '#334155',
            backgroundColor: checked ? '#fff' : 'rgba(235,236,236,0.3)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
        />
      </button>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  help,
  onChange,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  help?: string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className={`relative space-y-1.5 py-2 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <span className="text-xs text-text-primary tracking-[0.3px]">
        {label}
        {help && <HelpTip text={help} />}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const v = step >= 1 ? parseInt(e.target.value) : parseFloat(e.target.value)
            onChange(v)
          }}
          className="flex-1 min-w-0"
          style={{ '--slider-pct': `${pct}%` } as React.CSSProperties}
        />
        <div className="flex items-center gap-1">
          <NumericInput
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={onChange}
            className="w-14 h-7 bg-elevated text-right text-xs font-semibold text-text-primary rounded pr-2 focus:outline-none"
          />
          {unit && <span className="text-[10px] text-text-muted w-5">{unit}</span>}
        </div>
      </div>
    </div>
  )
}

function RadioMatrix({ sizeX, sizeY, values, onChange }: { sizeX: number; sizeY: number; values: boolean[]; onChange: (v: boolean[]) => void }) {
  let containerClasses: ClassValue = "gap-1 p-1 mx-1 rounded-md w-1/3";
  if (sizeX > 1) containerClasses = "gap-1 p-1 mx-1 rounded-sm w-1/2";
  if (sizeX > 2) containerClasses = "gap-1 p-1 mx-1 rounded-sm";
  if (sizeX > 4) containerClasses = "gap-px p-0 mx-0 rounded-sm";

  return (
      <div className={cn("grid bg-base p-2 mx-2 rounded-md", containerClasses)} style={{ gridTemplateColumns: `repeat(${sizeX}, 1fr)`, gridTemplateRows: `repeat(${sizeY}, 1fr)` }}>
          {values.map((value, index) => (
              <button
                  key={index}
                  onClick={() => {
                      if (value && values.filter(Boolean).length <= 1) return;
                      onChange(values.map((v, i) => (i === index ? !v : v)));
                  }}
                  className={cn("w-full border-2 aspect-square border-muted min-w-3", value ? "bg-accent border-accent" : "bg-elevated border-muted", sizeX > 4 ? "rounded-[2px]" : "rounded-sm")}
              ></button>
          ))}
      </div>
  );
}

function HintBanner({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  return (
    <div className={cn("text-[11px] mt-1 leading-tight", theme === 'dark' ? 'text-amber-400' : 'text-amber-600')}>
      {children}
    </div>
  )
}

export function BinConfigurator({ config, onChange, autoSize, onAutoSizeChange }: Props) {
  function update(partial: Partial<BinConfig>) {
    onChange({ ...config, ...partial })
  }

  const maxCutoutDepth = calcMaxCutoutDepth(config.height_units, config.stacking_lip)
  const binWidth = config.grid_x * 42
  const binDepth = config.grid_y * 42
  const needsSplit = config.bed_size > 0 && (binWidth > config.bed_size || binDepth > config.bed_size)
  const exportsSeparateParts = config.partial_bins && !config.partial_bins_connect && config.partial_bins_values.some((enabled) => !enabled);

  return (
    <div className="space-y-0">
      {onAutoSizeChange && (
        <Toggle
          label="Auto-size grid"
          help="Automatically fit grid to placed tools. Turn off to set grid size manually."
          checked={!!autoSize}
          onChange={onAutoSizeChange}
        />
      )}

      <SliderRow
        label="Grid Width"
        help="Bin width in gridfinity units (42mm each). Half-unit increments (21mm) supported."
        value={config.grid_x}
        min={1}
        max={maxGridUnitsForOtherAxis(config.grid_y)}
        step={0.5}
        unit="u"
        onChange={(v) =>
          update({
              grid_x: v,
              partial_bins_values: createPartialBinsValues(v, config.grid_y),
          })
        }
        disabled={autoSize}
      />

      <SliderRow
        label="Grid Depth"
        help="Bin depth in gridfinity units (42mm each). Half-unit increments (21mm) supported."
        value={config.grid_y}
        min={1}
        max={maxGridUnitsForOtherAxis(config.grid_x)}
        step={0.5}
        unit="u"
        onChange={(v) =>
          update({
              grid_y: v,
              partial_bins_values: createPartialBinsValues(config.grid_x, v),
          })
        }
        disabled={autoSize}
      />

      <SliderRow
        label="Height"
        help="Bin height in gridfinity units. Each unit is 7mm, plus a 4.75mm base."
        value={config.height_units}
        min={1}
        max={20}
        unit="u"
        onChange={(v) => {
          const newMax = calcMaxCutoutDepth(v, config.stacking_lip)
          update({ height_units: v, cutout_depth: Math.min(config.cutout_depth, newMax) })
        }}
      />

      <SliderRow
        label="Cutout Depth"
        help={`How deep the tool pocket is cut into the bin. Max ${maxCutoutDepth.toFixed(1)}mm at ${config.height_units}u height.`}
        value={Math.min(config.cutout_depth, maxCutoutDepth)}
        min={5}
        max={maxCutoutDepth}
        step={0.5}
        unit="mm"
        onChange={(v) => update({ cutout_depth: v })}
      />

      <SliderRow
        label="Clearance"
        help="Extra space around tool outlines. Increase if tools fit too tightly."
        value={config.cutout_clearance}
        min={0}
        max={5}
        step={0.1}
        unit="mm"
        onChange={(v) => update({ cutout_clearance: v })}
      />

      <SliderRow
        label="Cutout Chamfer"
        help="Bevel distance on the top edge of each tool pocket, in mm. 0 = sharp edge."
        value={config.cutout_chamfer}
        min={0}
        max={3}
        step={0.1}
        unit="mm"
        onChange={(v) => update({ cutout_chamfer: v })}
      />

      <div className="border-t border-border mt-2 pt-1">
        <Toggle
          checked={config.half_grid_base}
          onChange={(v) => update({ half_grid_base: v, ...(v ? { magnets: false } : {}) })}
          label="Half-grid base"
          help="Use 21mm half-grid cells on the baseplate instead of standard 42mm. Gives finer positioning on the baseplate."
        />
        <Toggle
          checked={config.magnets && !config.half_grid_base}
          onChange={(v) => update({ magnets: v })}
          label="Magnet holes"
          help="Holes in the base for magnets. Keeps bins locked to the baseplate."
          disabled={config.half_grid_base}
        />
        {config.half_grid_base && (
          <p className="text-[11px] text-text-muted mt-0.5 leading-tight pl-0.5">
            Magnet holes are not compatible with half-grid base cells
          </p>
        )}
        {config.magnets && !config.half_grid_base && (
          <div className="pl-3 border-l border-border-subtle ml-1 space-y-0">
            <SliderRow
              label="Diameter"
              value={config.magnet_diameter}
              min={3}
              max={10}
              step={0.5}
              unit="mm"
              onChange={(v) => update({ magnet_diameter: v })}
            />
            <SliderRow
              label="Depth"
              value={config.magnet_depth}
              min={1}
              max={5}
              step={0.1}
              unit="mm"
              onChange={(v) => update({ magnet_depth: v })}
            />
            <Toggle
              checked={config.magnet_corners_only}
              onChange={(v) => update({ magnet_corners_only: v })}
              label="Corners only"
              help="Only place magnet holes at the 4 outer corners of the bin."
            />
          </div>
        )}
        <Toggle
          checked={config.stacking_lip}
          onChange={(v) => {
            const newMax = calcMaxCutoutDepth(config.height_units, v)
            update({
              stacking_lip: v,
              rim_units: v ? config.rim_units : 0,
              cutout_depth: Math.min(config.cutout_depth, newMax),
            })
          }}
          label="Stacking lip"
          help="Raised rim at the top so bins can stack securely on top of each other."
        />
        {config.stacking_lip && (
          <div className="pl-3 border-l border-border-subtle ml-1 space-y-0">
            <SliderRow
              label="Raise Lip"
              help="Extends the wall and lip this many units (7mm each) above the floor face, leaving the interior open. Lets a tool protrude above the floor while a stacked bin still clears it. 0 = standard."
              value={config.rim_units}
              min={0}
              max={10}
              unit="u"
              onChange={(v) => update({ rim_units: v })}
            />
          </div>
        )}
        <Toggle
          checked={config.insert_enabled}
          onChange={(v) => update({ insert_enabled: v })}
          label="Contrast Insert"
          help="Generates a separate insert STL to print in a contrasting colour. The pocket is deepened to accommodate it."
        />
        {config.insert_enabled && (
          <>
            <SliderRow
              label="Insert Height"
              help="Thickness of the insert in mm."
              value={config.insert_height}
              min={0.5}
              max={10}
              step={0.1}
              unit="mm"
              onChange={(v) => update({ insert_height: v })}
            />
            <SliderRow
              label="Insert Fit"
              help="Clearance shaved off the insert edges so it drops into the pocket."
              value={config.insert_clearance}
              min={0}
              max={1}
              step={0.05}
              unit="mm"
              onChange={(v) => update({ insert_clearance: v })}
            />
          </>
        )}
      </div>

      <div className="border-t border-border mt-2 pt-1">
        <SliderRow
          label="Bed Size"
          help="Print bed size. Bins wider than this are automatically split into pieces."
          value={config.bed_size}
          min={BED_SIZE_MIN_MM}
          max={BED_SIZE_MAX_MM}
          step={1}
          unit="mm"
          onChange={(v) => update({ bed_size: v })}
        />
        {needsSplit && (
          <HintBanner>
            {binWidth > config.bed_size && `Width ${binWidth}mm exceeds bed`}
            {binWidth > config.bed_size && binDepth > config.bed_size && ' & '}
            {binDepth > config.bed_size && `Depth ${binDepth}mm exceeds bed`}
            {' \u2014 will be split'}
          </HintBanner>
        )}
      </div>

      <div className="border-t border-border mt-2 pt-1">
          <Toggle
              checked={config.partial_bins}
              onChange={(v) =>
                  update({
                      partial_bins: v,
                      ...(!v ? { partial_bins_connect: false, partial_bins_retain_wall: false } : {}),
                  })
              }
              label="Partial Bins"
              help="Print only parts of the bin that are needed to hold the tools."
          />
          {config.partial_bins && (
              <div className="pl-3 border-l border-border-subtle ml-1 space-y-0">
                  <RadioMatrix sizeX={Math.ceil(config.grid_x)} sizeY={Math.ceil(config.grid_y)} values={config.partial_bins_values} onChange={(v) => update({ partial_bins_values: v })} />
                  <Toggle
                      checked={config.partial_bins_connect}
                      onChange={(v) =>
                          update({
                              partial_bins_connect: v,
                              ...(!v ? { partial_bins_retain_wall: false } : {}),
                          })
                      }
                      label="Connect base"
                      help="Remove walls in disabled cells, bridge them with a thin base plate, and keep one connected print."
                  />
                  {config.partial_bins_connect && (
                      <Toggle
                          checked={config.partial_bins_retain_wall}
                          onChange={(v) => update({ partial_bins_retain_wall: v })}
                          label="Retain outer wall"
                          help="Keep the bin perimeter wall through disabled cells while still connecting them on the base."
                      />
                  )}
                  {exportsSeparateParts && <HintBanner>Disconnected pieces {"\u2014"} export includes a ZIP with one STL per part</HintBanner>}
              </div>
          )}
      </div>
    </div>
  )
}
