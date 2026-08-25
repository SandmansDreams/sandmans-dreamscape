// The soft blob a light is drawn as, built out of triangles rather than a texture

import { Color } from "./color"
import { MeshBuilder } from "./mesh"

/** Segments around the rim. Enough that the silhouette reads as a circle. */
const SEGMENTS = 24

/**
 * A unit disc that fades from white at its centre to black at its rim.
 *
 * Drawn additively, black adds nothing - so the rim disappears into whatever is
 * behind it and the falloff comes free from the interpolation between the fan's
 * centre vertex and its edge. That is a radial gradient without a texture, a
 * sampler, or a second bind group to hold them.
 *
 * Built at radius 1 and scaled per instance, so one mesh serves every light.
 */
export function glowDisc(inner = 0.22): MeshBuilder {
    const builder = new MeshBuilder()
    appendGlow(builder, 0, 0, 1, Color.WHITE, inner)
    return builder
}

/**
 * One glow, at a position and radius, in a colour.
 *
 * Two rings rather than one: a single fan from centre to rim fades linearly,
 * which reads as a flat cone. The inner ring holds the core near full brightness
 * and lets the outer one fall away faster, which is the shape a glow has.
 */
export function appendGlow(
    builder: MeshBuilder,
    x: number,
    y: number,
    radius: number,
    color: Color,
    inner = 0.22,
): void {
    appendRing(builder, x, y, 0, inner * radius, color, color)
    appendRing(builder, x, y, inner * radius, radius, color, Color.BLACK)
}

/** One annulus, coloured `from` at the inner edge and `to` at the outer. */
function appendRing(
    builder: MeshBuilder,
    cx: number,
    cy: number,
    innerRadius: number,
    outerRadius: number,
    from: Color,
    to: Color,
): void {
    for (let i = 0; i < SEGMENTS; i++) {
        const a = (i / SEGMENTS) * Math.PI * 2
        const b = ((i + 1) / SEGMENTS) * Math.PI * 2

        const ax = Math.cos(a)
        const ay = Math.sin(a)
        const bx = Math.cos(b)
        const by = Math.sin(b)

        const inner = [
            cx + ax * innerRadius, cy + ay * innerRadius,
            cx + bx * innerRadius, cy + by * innerRadius,
        ]
        const outer = [
            cx + ax * outerRadius, cy + ay * outerRadius,
            cx + bx * outerRadius, cy + by * outerRadius,
        ]

        // A degenerate inner edge at radius 0 collapses to a fan, which is what
        // the core ring wants and costs nothing to leave general
        builder.raw([
            inner[0]!, inner[1]!, ...from.rgb,
            outer[0]!, outer[1]!, ...to.rgb,
            outer[2]!, outer[3]!, ...to.rgb,
        ])
        builder.raw([
            inner[0]!, inner[1]!, ...from.rgb,
            outer[2]!, outer[3]!, ...to.rgb,
            inner[2]!, inner[3]!, ...from.rgb,
        ])
    }
}
