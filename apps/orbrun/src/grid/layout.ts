export const LAYOUT_PRESETS = ['Auto', 'Phone portrait', 'Phone landscape', 'Tablet portrait', 'Tablet landscape', 'Desktop'] as const
export type LayoutPreset = typeof LAYOUT_PRESETS[number]
export type TouchLayout = Exclude<LayoutPreset, 'Auto' | 'Desktop'>

export const portraitLayout = (layout: TouchLayout) => layout === 'Phone portrait' || layout === 'Tablet portrait'
export const tabletLayout = (layout: TouchLayout) => layout === 'Tablet portrait' || layout === 'Tablet landscape'

/** Keep a forced orientation when its controls and panes fit in the safe viewport. */
export function resolveLayout(preset: LayoutPreset, touch: boolean, phone: boolean, width: number, height: number): Exclude<LayoutPreset, 'Auto'> {
  if (preset === 'Desktop' || (preset === 'Auto' && !touch)) return 'Desktop'
  const tablet = preset === 'Auto' ? !phone : tabletLayout(preset)
  const portrait = width < 480 || (preset === 'Auto' ? height > width : height >= 360 && portraitLayout(preset))
  if (tablet) return portrait ? 'Tablet portrait' : 'Tablet landscape'
  return portrait ? 'Phone portrait' : 'Phone landscape'
}
