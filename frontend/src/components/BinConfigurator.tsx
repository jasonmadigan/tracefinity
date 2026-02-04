'use client'

import { Info } from 'lucide-react'
import type { BinConfig } from '@/types'

interface Props {
  config: BinConfig
  onChange: (config: BinConfig) => void
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="relative group ml-1">
      <Info className="w-3 h-3 text-text-muted cursor-help inline-block" />
      <span className="absolute bottom-full left-0 mb-1.5 px-2 py-1.5 text-[11px] leading-tight text-[#ebecec] bg-[#1a2332] border border-border-subtle rounded-[5px] whitespace-normal w-44 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-10 shadow-lg">
        {text}
      </span>
    </span>
  )
}

function Toggle({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-[#ebecec] tracking-[0.3px]">
        {label}
        {help && <HelpTip text={help} />}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-[5px] transition-colors ${
          checked ? 'bg-[rgba(75,178,247,0.8)]' : 'bg-elevated'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-[3px] bg-white transition-transform ${
            checked ? 'translate-x-[18px] border-accent' : 'translate-x-[3px] border-border-subtle'
          }`}
          style={{
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: checked ? '#2475c6' : '#334155',
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
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  help?: string
  onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className="space-y-1.5 py-2">
      <span className="text-xs text-[#ebecec] tracking-[0.3px]">
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
          onChange={(e) => {
            const v = step >= 1 ? parseInt(e.target.value) : parseFloat(e.target.value)
            onChange(v)
          }}
          className="flex-1 min-w-0"
          style={{ '--slider-pct': `${pct}%` } as React.CSSProperties}
        />
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const v = step >= 1 ? parseInt(e.target.value) : parseFloat(e.target.value)
              if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
            }}
            className="w-14 h-7 bg-[#222a35] text-right text-xs font-semibold text-[#ebecec] rounded-[5px] pr-2 focus:outline-none"
          />
          {unit && <span className="text-[10px] text-text-muted w-5">{unit}</span>}
        </div>
      </div>
    </div>
  )
}

export function BinConfigurator({ config, onChange }: Props) {
  function update(partial: Partial<BinConfig>) {
    onChange({ ...config, ...partial })
  }

  const binWidth = config.grid_x * 42
  const binDepth = config.grid_y * 42
  const needsSplit = config.bed_size > 0 && (binWidth > config.bed_size || binDepth > config.bed_size)

  return (
    <div className="space-y-0">
      <SliderRow
        label="Grid Width"
        help="Bin width in gridfinity units. Each unit is 42mm."
        value={config.grid_x}
        min={1}
        max={10}
        unit="u"
        onChange={(v) => update({ grid_x: v })}
      />

      <SliderRow
        label="Grid Depth"
        help="Bin depth in gridfinity units. Each unit is 42mm."
        value={config.grid_y}
        min={1}
        max={10}
        unit="u"
        onChange={(v) => update({ grid_y: v })}
      />

      <SliderRow
        label="Height"
        help="Bin height in gridfinity units. Each unit is 7mm, plus a 4.75mm base."
        value={config.height_units}
        min={1}
        max={20}
        unit="u"
        onChange={(v) => update({ height_units: v })}
      />

      <SliderRow
        label="Cutout Depth"
        help="How deep the tool pocket is cut into the bin."
        value={config.cutout_depth}
        min={5}
        max={100}
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

      <div className="border-t border-border mt-2 pt-1">
        <Toggle
          checked={config.magnets}
          onChange={(v) => update({ magnets: v })}
          label="Magnet holes"
          help="6mm holes in the base for magnets. Keeps bins locked to the baseplate."
        />
        <Toggle
          checked={config.stacking_lip}
          onChange={(v) => update({ stacking_lip: v })}
          label="Stacking lip"
          help="Raised rim at the top so bins can stack securely on top of each other."
        />
      </div>

      <div className="border-t border-border mt-2 pt-1">
        <SliderRow
          label="Bed Size"
          help="Print bed size. Bins wider than this are automatically split into pieces."
          value={config.bed_size}
          min={150}
          max={400}
          step={1}
          unit="mm"
          onChange={(v) => update({ bed_size: v })}
        />
        {needsSplit && (
          <div className="text-[11px] text-amber-400 mt-1 leading-tight">
            {binWidth > config.bed_size && `Width ${binWidth}mm exceeds bed`}
            {binWidth > config.bed_size && binDepth > config.bed_size && ' & '}
            {binDepth > config.bed_size && `Depth ${binDepth}mm exceeds bed`}
            {' \u2014 will be split'}
          </div>
        )}
      </div>
    </div>
  )
}
