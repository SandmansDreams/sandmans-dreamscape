// Lighting engine.
//
//   color.ts    CSS colour parsing, caching and interning
//   shading.ts  the surface shading model and its quantised colour ramps
//   light.ts    light sources and the scene-level lighting environment
//
// The shape of the hot path is: LightingEnvironment.sample() runs once per
// entity per frame and returns a SurfaceLight; Grid.draw() then calls
// illuminationAt() + palette.shade() per cell, both of which are pure
// arithmetic plus a dense-array lookup.

export { parseColor, internColor, colorById, hslToRgb, rgbToCss, type RGB } from "./color"

export {
    illuminationAt,
    ShadePalette,
    DEFAULT_SHADE_SETTINGS,
    SHADE_STEPS,
    type ShadeSettings,
    type SurfaceLight
} from "./shading"

export { LightSource, LightingEnvironment, type LightSourceOptions } from "./light"
