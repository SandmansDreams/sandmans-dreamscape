import { clamp255, colorById, internedColorCount, rgbToCss, type RGB } from "./color"

/**
 * Number of discrete illumination levels a base colour is shaded into.
 *
 * Shading is the hottest loop in the renderer (every filled cell of every
 * visible entity, every frame), and the expensive part is building the
 * `rgb(...)` string that goes into `ctx.fillStyle`. Quantising illumination
 * lets us build each (colour, level) string exactly once and hand back the same
 * string instance forever after — which also makes the "did fillStyle change?"
 * check in the draw loop a pointer comparison.
 *
 * 64 levels is well under what an 8-bit-per-channel display can show for the
 * contrast range we use, so the banding is not visible.
 */
export const SHADE_STEPS = 64

const MAX_STEP = SHADE_STEPS - 1

export interface ShadeSettings {
    /** How much the lit side brightens. 0 = flat, 1 = doubles the base colour. */
    contrast: number
    /** How much the shadow side darkens. 0 = flat, 1 = black at full shadow. */
    shadowDepth: number
    /** How strongly the light's own colour tints lit surfaces. */
    tint: number
    /** How strongly the ambient colour fills unlit surfaces. */
    ambientBleed: number
    /** Colour bounced into shadows, so unlit faces aren't dead grey. */
    ambientColor: RGB
}

export const DEFAULT_SHADE_SETTINGS: ShadeSettings = {
    contrast: 0.55,
    shadowDepth: 0.45,
    tint: 0.22,
    ambientBleed: 0.16,
    ambientColor: { r: 40, g: 70, b: 130 }
}

/**
 * A lazily-built ramp of shaded colours for one lighting condition (one tint
 * colour + one set of shading settings). Indexed by `colorId * SHADE_STEPS +
 * level`, so lookups are a single dense-array read.
 */
export class ShadePalette {
    private cache: (string | undefined)[] = []

    constructor(
        readonly tint: RGB,
        readonly settings: ShadeSettings
    ) {}

    /**
     * @param colorId interned id of the surface's base colour
     * @param e illumination in [0, 1]; 0.5 leaves the base colour untouched
     */
    shade(colorId: number, e: number): string {
        const level = e <= 0 ? 0 : e >= 1 ? MAX_STEP : (e * MAX_STEP + 0.5) | 0
        const key = colorId * SHADE_STEPS + level

        const hit = this.cache[key]
        if (hit !== undefined) return hit

        const built = this.build(colorId, level / MAX_STEP)
        this.cache[key] = built
        return built
    }

    private build(colorId: number, e: number): string {
        const base = colorById(colorId)
        const s = this.settings

        // -1 = fully shadowed, 0 = base colour, +1 = fully lit.
        const k = (e - 0.5) * 2

        if (k >= 0) {
            const gain = 1 + s.contrast * k
            const tint = k * s.tint
            return rgbToCss(
                base.r * gain + this.tint.r * tint,
                base.g * gain + this.tint.g * tint,
                base.b * gain + this.tint.b * tint
            )
        }

        const gain = 1 + s.shadowDepth * k
        const fill = -k * s.ambientBleed
        return rgbToCss(
            base.r * gain + s.ambientColor.r * fill,
            base.g * gain + s.ambientColor.g * fill,
            base.b * gain + s.ambientColor.b * fill
        )
    }

    /**
     * Colour ids are handed out globally and monotonically, so a palette built
     * before new colours appeared is still valid — this only reports how much
     * of its ramp is populated, for debugging.
     */
    get cachedEntries(): number {
        let count = 0
        for (let i = 0; i < this.cache.length; i++) if (this.cache[i] !== undefined) count++
        return count
    }

    get capacity(): number {
        return internedColorCount() * SHADE_STEPS
    }
}

/**
 * The aggregate light falling on one entity, expressed in that entity's own
 * local (unrotated) space so the per-cell loop needs no trigonometry.
 *
 * Sampled once per entity per frame by LightingEnvironment.
 */
export interface SurfaceLight {
    /** Unit vector toward the aggregate light, in the entity's local space. */
    dirX: number
    dirY: number
    /** Aggregate illumination, 0 (unlit) to 1 (fully lit). */
    intensity: number
    /** 1 / shading radius — cells further out than this get full contrast. */
    invRadius: number
    palette: ShadePalette
}

/**
 * Illumination for a point offset (dx, dy) from the entity's centre.
 *
 * The radial term keeps the entity's interior close to its base colour and
 * pushes contrast toward the silhouette, which reads as curvature rather than
 * as a hard terminator line across a flat sprite.
 */
export function illuminationAt(light: SurfaceLight, dx: number, dy: number, invert: boolean): number {
    const len = Math.hypot(dx, dy)
    if (len === 0) return 0.5

    let dot = (dx * light.dirX + dy * light.dirY) / len
    if (invert) dot = -dot

    // smoothstep over the terminator
    const facing = (dot + 1) * 0.5
    const diffuse = facing * facing * (3 - 2 * facing)

    const radial = Math.min(len * light.invRadius, 1)

    return 0.5 + (diffuse - 0.5) * radial * light.intensity
}
