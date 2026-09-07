import type { BinConfig, BinDefaults } from '@/types'
import { getSettings, saveSettings } from './settings'

export function createPartialBinsValues(gridX: number, gridY: number): boolean[] {
  return Array(Math.ceil(gridX) * Math.ceil(gridY)).fill(true);
}

export const FACTORY_BIN_CONFIG: BinConfig = {
  grid_x: 2,
  grid_y: 2,
  height_units: 4,
  magnets: true,
  magnet_diameter: 6.0,
  magnet_depth: 2.4,
  magnet_corners_only: false,
  stacking_lip: true,
  rim_units: 0,
  wall_thickness: 1.6,
  shell_floor_plate: 0.75,
  shelled: false,
  shell_exterior_standard: true,
  shell_exterior_wall: true,
  cutout_depth: 20,
  cutout_clearance: 1.0,
  cutout_chamfer: 0,
  insert_enabled: false,
  insert_height: 1.0,
  insert_clearance: 0.2,
  half_grid_base: false,
  partial_bins: false,
  partial_bins_values: createPartialBinsValues(2, 2),
  partial_bins_connect: false,
  partial_bins_retain_wall: false,
  bed_size: 256,
  text_labels: [],
}

export function buildBinConfig(overrides: Partial<BinDefaults> | null = null): BinConfig {
  const merged = {
      ...FACTORY_BIN_CONFIG,
      ...(overrides || {}),
      text_labels: [] as BinConfig["text_labels"],
  };
  const expectedLength = Math.ceil(merged.grid_x) * Math.ceil(merged.grid_y);
  if (!merged.partial_bins_values || merged.partial_bins_values.length !== expectedLength) {
      merged.partial_bins_values = createPartialBinsValues(merged.grid_x, merged.grid_y);
  }
  return merged;
}

export function binDefaultsFromConfig(config: Partial<BinConfig>): BinDefaults {
  const { text_labels: _textLabels, ...defaults } = buildBinConfig(config)
  return defaults
}

export function getDefaultBinConfig(): BinConfig {
  const settings = getSettings()
  return buildBinConfig({
    ...(settings.binDefaults || {}),
    bed_size: settings.bedSize,
  })
}

export function getDefaultBinDefaults(): BinDefaults {
  return binDefaultsFromConfig(getDefaultBinConfig())
}

export function saveDefaultBinConfig(config: BinConfig): BinDefaults {
  const defaults = binDefaultsFromConfig(config)
  saveSettings({ bedSize: defaults.bed_size, binDefaults: defaults })
  return defaults
}

export function resetDefaultBinConfig(): BinConfig {
  saveSettings({ bedSize: FACTORY_BIN_CONFIG.bed_size, binDefaults: undefined })
  return buildBinConfig()
}
