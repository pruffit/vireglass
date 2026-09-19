export { VireGlassSurface } from './glass-surface';
export type { GlassDynamics, GlassIcon } from './glass-surface';

export { GlassGroup, useGlassGroup } from './glass-group';

export { GlassInkProvider, useGlassInk, useInkColor, inkColor } from './glass-ink';

export { VireGlassProvider, useAccessibilityModifiers, useBackdropEnabled } from './provider';

export { GlassLens, GlassBackdrop, GlassProbe, isGlassLensSupported } from './lens';
export type { GlassLensProps, GlassBackdropProps, GlassProbeProps } from './lens';

export { useEnvironmentLight } from './environment';

export { glassSurfaceStats, useGlassSurfaceRegistration, GLASS_GREEN_MAX } from './surface-registry';

export { useSystemAccessibility, mergeAccessibility } from './system-accessibility';
export type { SystemAccessibility } from './system-accessibility';
