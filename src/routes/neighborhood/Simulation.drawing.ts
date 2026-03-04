/*~~~ DRAWING MATH ~~~*/
import type { Link } from "./Simulation.helpers"

// Get point on quadratic bezier curve at parameter t ∈ [0, 1]
function quadPoint(t: number, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) {
    const mt = 1 - t
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1
    return { x, y }
}

// Get tangent (derivative) of quadratic bezier curve at parameter t
function quadTangent(t: number, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) {
    const dx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx)
    const dy = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy)
    return { dx, dy }
}

export function drawLinks(links: Map<string, Link>, ctx: CanvasRenderingContext2D, radius: number, curveArrowDistMod = 1.35) {
    drawArrows(ctx, links, radius);
}

function drawStraightLine(ctx: CanvasRenderingContext2D, from: {x: number, y: number}, to: {x: number, y: number}, opacity?: number) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${opacity ?? 1})`;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
}

function drawArrowhead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size = 8) {
    const half = size * 0.75
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-size, half)
    ctx.lineTo(-size, -half)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
}

function drawArrows(ctx: CanvasRenderingContext2D, links: Map<string, Link>, radius: number) {
    // Draw each link (lines or curved if reciprocal)
    links.forEach(link => {
        const from = link.from
        const to = link.to
        if (!from || !to) return

        const reverseId = `L_${to.id}_${from.id}`
        const isReciprocal = links.has(reverseId)

        // Styling
        ctx.strokeStyle = `rgba(200,200,200,1)`
        ctx.fillStyle = `rgba(200,200,200,1)`
        ctx.lineWidth = 1

        // compute endpoints moved out from node centers by radius
        const dx = to.x - from.x
        const dy = to.y - from.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001
        const ux = dx / dist
        const uy = dy / dist

        const startX = from.x 
        const startY = from.y
        const endX = to.x 
        const endY = to.y 

        if (!isReciprocal) {
            const distMod = 1.35
            // straight line with arrow
            drawStraightLine(ctx, {x: startX, y: startY}, {x: endX, y: endY})

            // arrow at end
            const angle = Math.atan2(endY - startY, endX - startX)
            drawArrowhead(ctx, endX - radius * distMod * ux, endY - radius * distMod * uy, angle)
        } else {
            // curved quadratic; choose curve direction based on consistent node ordering
            const midX = (from.x + to.x) / 2
            const midY = (from.y + to.y) / 2
            
            // Calculate normal based on node pair ordering (independent of link direction)
            // This ensures the normal doesn't flip based on which direction the link goes
            const nodeA = from.id < to.id ? from : to
            const nodeB = from.id < to.id ? to : from
            const refDx = nodeB.x - nodeA.x
            const refDy = nodeB.y - nodeA.y
            const refDist = Math.sqrt(refDx * refDx + refDy * refDy) || 0.001
            const refUx = refDx / refDist
            const refUy = refDy / refDist
            const nx = -refUy  // perpendicular to reference direction
            const ny = refUx
            
            // Determine which side to curve: based on link direction relative to node ordering
            const curveMag = 50
            const sign = from.id < to.id ? 1 : -1
            const cx = midX + nx * curveMag * sign
            const cy = midY + ny * curveMag * sign

            // compute start/end points again but placed slightly off to avoid overlapping arrowheads
            ctx.beginPath()
            ctx.moveTo(startX, startY)
            ctx.quadraticCurveTo(cx, cy, endX, endY)
            ctx.stroke()

            // Find t where curve is exactly radius from node center (to)
            const arrowSize = 7;
            function distToNode(t: number) {
                const pt = quadPoint(t, startX, startY, cx, cy, endX, endY);
                const dx = pt.x - to.x;
                const dy = pt.y - to.y;
                return Math.sqrt(dx * dx + dy * dy);
            }
            // Place arrowhead just outside the node's circle (radius + arrowSize/2)
            const targetDist = to.radius - 55;
            let t0 = 0.7, t1 = 1.0, tMid = 1.0;
            for (let i = 0; i < 20; ++i) {
                tMid = (t0 + t1) / 2;
                const d = distToNode(tMid);
                if (Math.abs(d - targetDist) < 0.5) break;
                if (d > targetDist) t0 = tMid;
                else t1 = tMid;
            }
            const pt = quadPoint(tMid, startX, startY, cx, cy, endX, endY);
            const tan = quadTangent(tMid, startX, startY, cx, cy, endX, endY);
            const angle = Math.atan2(tan.dy, tan.dx);
            drawArrowhead(ctx, pt.x, pt.y, angle, arrowSize);
        }
    })
}
