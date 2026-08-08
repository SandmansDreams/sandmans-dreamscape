import { SpatialHash } from "../broadphase"
import { Vector2 } from "../physics"
import type { Camera } from "../types"
import { parseColor, type RGB } from "./color"
import {
    DEFAULT_SHADE_SETTINGS,
    ShadePalette,
    type ShadeSettings,
    type SurfaceLight
} from "./shading"

export interface LightSourceOptions {
    position: Vector2
    /** Any CSS colour. Used both for the sprite and for tinting lit surfaces. */
    color?: string
    intensity?: number
    /** Radius of the drawn glow, in world units. Purely cosmetic. */
    radius?: number
    /**
     * Distance at which illumination has fallen to half. Independent of
     * `radius`: a sun is a small bright disc that lights a whole system, a
     * flare is a big soft blob that lights almost nothing.
     */
    range?: number
    /**
     * Marks a light whose reach covers the whole playfield — a sun.
     *
     * Global lights are accumulated for every surface and drawn behind
     * entities. Everything else is treated as local: spatially indexed, only
     * gathered for nearby surfaces, and drawn over entities as bloom.
     */
    global?: boolean
}

/** Below this an extra light contributes nothing visible; skip it. */
const MIN_CONTRIBUTION = 0.002

/**
 * How many multiples of `range` a local light is considered to reach.
 *
 * The inverse-square curve has an infinite tail, so a cutoff is needed to
 * bound the spatial index. At 4x range the light is down to ~6% of peak, which
 * is below what the shading quantiser can resolve anyway.
 */
const LOCAL_RANGE_FACTOR = 4

export class LightSource {
    position: Vector2
    intensity: number
    radius: number
    range: number
    global: boolean

    /**
     * Whatever this light is mounted on, if anything.
     *
     * A ship's own engine glow sits inside its hull, where "direction to the
     * light" is meaningless and the near-field intensity would wash the whole
     * sprite out — so surfaces skip lights they own.
     */
    owner: unknown = null

    private _color!: string
    private _rgb!: RGB
    private gradient: CanvasGradient | null = null
    private gradientKey = ""

    constructor(options: LightSourceOptions) {
        this.position = options.position
        this.intensity = options.intensity ?? 1
        // A zero radius would make the glow gradient's stop offsets NaN.
        this.radius = Math.max(options.radius ?? 80, 0.01)
        this.range = Math.max(options.range ?? 12000, 0.01)
        this.global = options.global ?? false
        this.color = options.color ?? "#fffbe6"
    }

    /** Distance past which this light is treated as contributing nothing. */
    get effectiveRange(): number {
        return this.range * LOCAL_RANGE_FACTOR
    }

    get color(): string {
        return this._color
    }

    set color(value: string) {
        this._color = value
        this._rgb = parseColor(value)
        this.gradient = null
    }

    get rgb(): RGB {
        return this._rgb
    }

    /** How far the glow sprite visibly extends — used for culling. */
    get visualRadius(): number {
        return this.radius * 3
    }

    /**
     * Illumination reaching a point `sqrt(distSq)` away.
     *
     * Inverse-square with a soft core, so it is smooth at the centre and never
     * blows up: 1 at the light, 1/2 at `range`, 1/10 at 3x `range`.
     */
    attenuationSq(distSq: number): number {
        const r = this.range
        return this.intensity / (1 + distSq / (r * r))
    }

    draw(ctx: CanvasRenderingContext2D, camera: Camera) {
        const width = ctx.canvas.clientWidth
        const height = ctx.canvas.clientHeight
        const { x, y } = camera.worldToScreen(this.position.x, this.position.y, width, height)

        // Cull once the glow is fully off screen.
        const screenRadius = this.visualRadius * camera.zoom
        if (x + screenRadius < 0 || x - screenRadius > width) return
        if (y + screenRadius < 0 || y - screenRadius > height) return

        ctx.save()
        ctx.translate(x, y)
        ctx.scale(camera.zoom, camera.zoom)
        ctx.globalCompositeOperation = "lighter"

        ctx.fillStyle = this.glowGradient(ctx)
        ctx.beginPath()
        ctx.arc(0, 0, this.visualRadius, 0, Math.PI * 2)
        ctx.fill()

        // Hot core, drawn last so it stays white regardless of the glow colour.
        ctx.fillStyle = "#fff"
        ctx.beginPath()
        ctx.arc(0, 0, this.radius * 0.15, 0, Math.PI * 2)
        ctx.fill()

        ctx.restore()
    }

    /**
     * Gradients only depend on colour and radius, so building one per frame —
     * as the previous implementation did — was pure waste.
     */
    private glowGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
        const key = `${this._color}|${this.radius}`
        if (this.gradient && this.gradientKey === key) return this.gradient

        const { r, g, b } = this._rgb
        const outer = this.visualRadius
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, outer)

        gradient.addColorStop(0, `rgba(255,255,255,0.95)`)
        gradient.addColorStop(this.radius * 0.25 / outer, `rgba(${r},${g},${b},0.85)`)
        gradient.addColorStop(this.radius / outer, `rgba(${r},${g},${b},0.28)`)
        gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)

        this.gradient = gradient
        this.gradientKey = key
        return gradient
    }
}

/**
 * Owns the scene's lights and turns them into per-entity shading information.
 *
 * The expensive parts of lighting are amortised here: light accumulation runs
 * once per entity (not per cell), and the resulting colour ramps are shared by
 * every entity lit the same way.
 */
/**
 * Cap on live shade palettes.
 *
 * Each palette is a lazily-filled ramp for one quantised tint colour. A static
 * scene needs one or two, but moving coloured lights mint a new tint mix
 * constantly, so the cache is an LRU rather than unbounded.
 */
const MAX_PALETTES = 48

/** Bucket size for the local-light index, in world units. */
const LIGHT_CELL_SIZE = 200

export class LightingEnvironment {
    enabled = true

    /** Scene-wide lights — suns. Accumulated for every surface. */
    lights: LightSource[] = []

    private settings: ShadeSettings = { ...DEFAULT_SHADE_SETTINGS }
    private palettes = new Map<number, ShadePalette>()

    /**
     * Dynamic lights flagged global — rare, but a sun could be entity-mounted.
     * Rebuilt every frame alongside the local index.
     */
    private dynamicGlobals: LightSource[] = []
    private localIndex = new SpatialHash<LightSource>(LIGHT_CELL_SIZE)
    private nearby: LightSource[] = []

    constructor(lights: LightSource[] = []) {
        this.lights = lights
    }

    add(light: LightSource): LightSource {
        this.lights.push(light)
        return light
    }

    configure(settings: Partial<ShadeSettings>) {
        this.settings = { ...this.settings, ...settings }
        this.palettes.clear()
    }

    // --- Per-frame local lights --------------------------------------------

    /** Drops last frame's entity lights. Call before registering new ones. */
    beginFrame() {
        this.dynamicGlobals.length = 0
        this.localIndex.clear()
    }

    /**
     * Registers a light for this frame only.
     *
     * @param owner the entity carrying it, so that entity can skip its own
     *        light when shading itself.
     */
    addDynamic(light: LightSource, owner: unknown = null) {
        if (light.intensity <= 0) return

        light.owner = owner

        if (light.global) {
            this.dynamicGlobals.push(light)
            return
        }

        this.localIndex.insert(light, light.position.x, light.position.y, light.effectiveRange)
    }

    /** Finishes registration. Currently a marker; the index fills as it goes. */
    endFrame() {}

    get dynamicLightCount(): number {
        return this.localIndex.size + this.dynamicGlobals.length
    }

    /**
     * Aggregate light falling on an entity.
     *
     * @param localRotation the entity's world rotation plus any fixed offset
     *        between its rotation and its grid's axes, so the returned
     *        direction is already in grid space.
     * @param shadingRadius the entity's bounding radius in grid units; cells
     *        at that distance from the centre receive full contrast.
     * @returns undefined when nothing lights this point, meaning "draw flat".
     */
    /**
     * @param exclude the entity being shaded, so its own mounted lights are
     *        skipped. See LightSource.owner.
     */
    sample(
        worldX: number,
        worldY: number,
        localRotation: number,
        shadingRadius: number,
        exclude: unknown = null
    ): SurfaceLight | undefined {
        if (!this.enabled) return undefined

        let accX = 0, accY = 0
        let tintR = 0, tintG = 0, tintB = 0
        let total = 0

        const gather = (light: LightSource) => {
            if (exclude !== null && light.owner === exclude) return

            const dx = light.position.x - worldX
            const dy = light.position.y - worldY
            const distSq = dx * dx + dy * dy

            const strength = light.attenuationSq(distSq)
            if (strength < MIN_CONTRIBUTION) return

            // Weight the direction by strength so the brightest light wins.
            const dist = Math.sqrt(distSq)
            const scale = dist > 0 ? strength / dist : 0
            accX += dx * scale
            accY += dy * scale

            const rgb = light.rgb
            tintR += rgb.r * strength
            tintG += rgb.g * strength
            tintB += rgb.b * strength
            total += strength
        }

        for (let i = 0; i < this.lights.length; i++) gather(this.lights[i])
        for (let i = 0; i < this.dynamicGlobals.length; i++) gather(this.dynamicGlobals[i])

        // Only local lights whose reach overlaps this point. Without the
        // index this would be every engine glow in the fleet, per surface.
        if (this.localIndex.size > 0) {
            const near = this.localIndex.query(worldX, worldY, shadingRadius, this.nearby)
            for (let i = 0; i < near.length; i++) gather(near[i])
        }

        if (total < MIN_CONTRIBUTION) return undefined

        const len = Math.hypot(accX, accY)
        // Opposed lights of equal strength cancel; there is no shading direction.
        if (len === 0) return undefined

        const worldX0 = accX / len
        const worldY0 = accY / len

        // Rotate the world-space direction into the entity's local space.
        const cos = Math.cos(localRotation)
        const sin = Math.sin(localRotation)

        return {
            dirX: worldX0 * cos + worldY0 * sin,
            dirY: worldY0 * cos - worldX0 * sin,
            intensity: Math.min(total, 1),
            invRadius: 1 / Math.max(shadingRadius, 1),
            palette: this.paletteFor(tintR / total, tintG / total, tintB / total)
        }
    }

    /**
     * Distant lights, drawn before entities so anything in front occludes them.
     */
    drawGlobalLights(ctx: CanvasRenderingContext2D, camera: Camera) {
        if (!this.enabled) return
        for (const light of this.lights) light.draw(ctx, camera)
        for (const light of this.dynamicGlobals) light.draw(ctx, camera)
    }

    /**
     * Entity-mounted glows, drawn after entities so they bloom over the hull
     * they belong to rather than being painted out by it.
     */
    drawLocalLights(ctx: CanvasRenderingContext2D, camera: Camera) {
        if (!this.enabled) return
        this.localIndex.forEach(light => light.draw(ctx, camera))
    }

    /**
     * One palette per distinct tint colour, quantised to 5 bits per channel.
     *
     * Kept as an LRU: a static scene needs one or two palettes, but moving
     * coloured lights produce a continuously varying tint mix, and each
     * palette holds a ramp for every colour it has been asked about.
     */
    private paletteFor(r: number, g: number, b: number): ShadePalette {
        const key = ((r & 0xff) >> 3) << 10 | ((g & 0xff) >> 3) << 5 | ((b & 0xff) >> 3)

        const existing = this.palettes.get(key)
        if (existing) {
            // Re-insert to mark as most recently used.
            this.palettes.delete(key)
            this.palettes.set(key, existing)
            return existing
        }

        if (this.palettes.size >= MAX_PALETTES) {
            // Map iteration is insertion-ordered, so the first key is oldest.
            const oldest = this.palettes.keys().next().value
            if (oldest !== undefined) this.palettes.delete(oldest)
        }

        const palette = new ShadePalette(
            { r: Math.round(r), g: Math.round(g), b: Math.round(b) },
            this.settings
        )
        this.palettes.set(key, palette)
        return palette
    }

    get paletteCount(): number {
        return this.palettes.size
    }
}
