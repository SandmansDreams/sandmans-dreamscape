// Lights, and the one direction-and-colour they add up to for a hull. World units.

import type { Vec2 } from "../render/camera"
import { Color } from "../render/color"

/** Below this an extra light contributes nothing visible; skip it. */
const MIN_CONTRIBUTION = 0.002

export interface LightOptions {
    position: Vec2
    /** Tints what it lights, and is the colour its glow is drawn in. */
    color?: Color
    intensity?: number
    /**
     * Distance at which illumination has fallen to half.
     *
     * Independent of how big the light looks: a sun is a small bright disc that
     * lights a whole system, a flare is a big soft blob that lights almost nothing.
     */
    range?: number
    /** Radius of the drawn glow, in world units. Purely cosmetic. */
    radius?: number
    /**
     * Whatever this light is mounted on, if anything.
     *
     * A ship's own engine glow sits inside its hull, where "direction to the
     * light" is meaningless and the near-field intensity would wash the whole
     * sprite out - so a hull skips the lights it owns when shading itself.
     */
    owner?: unknown
}

export class Light {
    position: Vec2
    color: Color
    intensity: number
    range: number
    radius: number
    owner: unknown

    constructor(options: LightOptions) {
        this.position = options.position
        this.color = options.color ?? Color.from("#fffbe6")
        this.intensity = options.intensity ?? 1
        // Zero would divide the falloff by nothing and blow the glow's stops up
        this.range = Math.max(options.range ?? 4000, 0.01)
        this.radius = Math.max(options.radius ?? 80, 0.01)
        this.owner = options.owner ?? null
    }

    /**
     * Illumination reaching a point `distanceSquared` away.
     *
     * Inverse-square with a soft core, so it is smooth at the centre and never
     * blows up: 1 at the light, 1/2 at `range`, 1/10 at three times `range`.
     */
    reach(distanceSquared: number): number {
        return this.intensity / (1 + distanceSquared / (this.range * this.range))
    }
}

/**
 * Every light on one hull, added up.
 *
 * The whole point of the model: a hull is sampled once, at its centre, and the
 * shader varies only within the hull from there. Direction is in the hull's own
 * space, so the per-cell maths needs no trigonometry.
 */
export interface SurfaceLight {
    /** Unit vector toward the aggregate light, in hull-local space. */
    direction: Vec2
    /** 0 unlit to 1 fully lit. */
    intensity: number
    /** The lights' colours, weighted by how much each contributed. */
    tint: Color
}

/** What a hull with nothing shining on it gets: flat, its own colours, no tint. */
export const UNLIT: SurfaceLight = {
    direction: { x: 0, y: -1 },
    intensity: 0,
    tint: Color.WHITE,
}

/**
 * The scene's lights.
 *
 * No spatial index yet: v1 had one so a surface only gathered the engine glows
 * near it, which matters with a fleet and not with a ship and a sun. `sample` is
 * where it slots in when that day comes.
 */
export class LightField {
    readonly lights: Light[] = []

    add(light: Light): Light {
        this.lights.push(light)
        return light
    }

    remove(light: Light): void {
        const at = this.lights.indexOf(light)
        if (at >= 0) this.lights.splice(at, 1)
    }

    clear(): void {
        this.lights.length = 0
    }

    /**
     * The light falling on a hull at `at`, in that hull's own space.
     *
     * @param rotation the hull's world rotation, so the direction comes back
     *        already rotated into the space its cell centres are in
     * @param exclude a hull skips the lights it owns - see `Light.owner`
     *
     * @returns UNLIT when nothing reaches it, or when opposed lights cancel
     *          exactly and there is no direction left to shade from
     */
    sample(at: Vec2, rotation: number, exclude: unknown = null): SurfaceLight {
        let towardX = 0
        let towardY = 0
        let red = 0
        let green = 0
        let blue = 0
        let total = 0

        for (const light of this.lights) {
            if (exclude !== null && light.owner === exclude) continue

            const dx = light.position.x - at.x
            const dy = light.position.y - at.y
            const distanceSquared = dx * dx + dy * dy

            const strength = light.reach(distanceSquared)
            if (strength < MIN_CONTRIBUTION) continue

            // Weighted by strength, so the brightest light wins the direction
            const distance = Math.sqrt(distanceSquared)
            const scale = distance > 0 ? strength / distance : 0
            towardX += dx * scale
            towardY += dy * scale

            red += light.color.r * strength
            green += light.color.g * strength
            blue += light.color.b * strength
            total += strength
        }

        if (total < MIN_CONTRIBUTION) return UNLIT

        const length = Math.hypot(towardX, towardY)
        if (length === 0) return UNLIT

        // World direction, rotated back into the hull's own frame
        const cos = Math.cos(rotation)
        const sin = Math.sin(rotation)
        const worldX = towardX / length
        const worldY = towardY / length

        return {
            direction: {
                x: worldX * cos + worldY * sin,
                y: worldY * cos - worldX * sin,
            },
            // Capped: past full brightness there is nothing more to say, and the
            // shader's terminator already overdrives what it is given
            intensity: Math.min(total, 1),
            tint: Color.rgb(red / total, green / total, blue / total),
        }
    }
}

/** How much the lit side brightens, the shadow darkens, and what fills the dark. */
export interface ShadingSettings {
    /** 0 flat, 1 doubles the base colour at full light. */
    contrast: number
    /** 0 flat, 1 black at full shadow. */
    shadowDepth: number
    /** How strongly the light's own colour tints what it lights. */
    tint: number
    /** How strongly the ambient colour fills what it does not. */
    ambientBleed: number
    /** Bounced into shadow, so unlit faces are not dead grey. */
    ambientColor: Color
    /**
     * True to filter the surface by the light's colour, false to add to it.
     *
     * Filtering by default, and v2's reasoning stands: adding can only raise the
     * channels the base is low in, which is desaturation by definition - an
     * additive purple on a green hull washes it grey rather than colouring it.
     * Filtering removes the hues the light lacks, so the surface goes darker and
     * keeps its own colour, which is what actually happens to a green object
     * under a purple lamp.
     */
    multiply: boolean
}

export const DEFAULT_SHADING: ShadingSettings = {
    contrast: 0.55,
    shadowDepth: 0.45,
    tint: 0.22,
    ambientBleed: 0.16,
    ambientColor: Color.rgb(40 / 255, 70 / 255, 130 / 255),
    multiply: true,
}
