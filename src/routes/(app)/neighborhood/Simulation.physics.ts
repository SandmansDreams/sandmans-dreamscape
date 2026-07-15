import type { Link, Node } from "./Simulation.helpers"

export type PhysicsConfig = {
    repulsionForce: number;
    springLength: number;
    springStrength: number;
    dampener: number;
    centeringForce: number;
}

const MAX_VELOCITY = 10

function applyAttraction(links: Map<string, Link>, config: PhysicsConfig) {
    links.forEach(link => {
        const from = link.from
        const to = link.to
        if (!from || !to) return
        
        const dx = to.x - from.x
        const dy = to.y - from.y

        const distanceSq = dx * dx + dy * dy
        if (distanceSq === 0) return

        const distance = Math.sqrt(distanceSq)

        const displacement = distance - config.springLength
        const force = config.springStrength * displacement

        const nx = dx / distance
        const ny = dy / distance

        const fx = nx * force
        const fy = ny * force

        from.vx += fx
        from.vy += fy
        to.vx -= fx
        to.vy -= fy
    })
}

function applyRepulsion(nodes: Map<string, Node>, config: PhysicsConfig) {
    const repulsionDistance = config.springLength
    const nodeList = Array.from(nodes.values())

    for (let i = 0; i < nodeList.length; i++) {
        for (let j = i + 1; j < nodeList.length; j++) {
            const nodeA = nodeList[i]
            const nodeB = nodeList[j]
            
            const dx = nodeB.x - nodeA.x
            const dy = nodeB.y - nodeA.y

            let distanceSquared = dx * dx + dy * dy
            if (distanceSquared === 0) continue

            const distance = Math.sqrt(distanceSquared)
            //if (distance > repulsionDistance) continue

            const force = Math.min(config.repulsionForce / distanceSquared, config.repulsionForce)

            const nx = dx / distance
            const ny = dy / distance

            const fx = nx * force;
            const fy = ny * force;

            nodeA.vx -= fx;
            nodeA.vy -= fy;
            nodeB.vx += fx;
            nodeB.vy += fy;
        }
    }
}

function applyCentering(nodes: Map<string, Node>, config: PhysicsConfig, width: number, height: number) {
    const centerX = width / 2
    const centerY = height / 2

    // Push nodes towards the center
    nodes.forEach(node => {
        node.vx += (centerX - node.x) * config.centeringForce
        node.vy += (centerY - node.y) * config.centeringForce
    })
}

function applyMovement(nodes: Map<string, Node>, config: PhysicsConfig, width: number, height: number) {
    nodes.forEach(node => {
        // Max velocity clamping
        const clamped = clampVelocity(node.vx, node.vy)

        // Apply total movement
        node.x += clamped.vx
        node.y += clamped.vy

        // Gradually slow velocity
        node.vx = clamped.vx * config.dampener
        node.vy = clamped.vy * config.dampener

        clampPosition(node, width, height)
    });
}

function clampPosition(node: Node, width: number, height: number) {
    if (node.x > width) {
        node.x = width
        node.vx = 0
    }
    if (node.y > height) {
        node.y = height
        node.vy = 0
    }
    if (node.x < 0) {
        node.x = 0
        node.vx = 0
    }
    if (node.y < 0) {
        node.y = 0
        node.vy = 0
    }
}

function clampVelocity(vx: number, vy: number) {
    let nx = vx
    let ny = vy

    const speedSquared = vx * vx + vy * vy
    const maxSquared = MAX_VELOCITY * MAX_VELOCITY

    if (speedSquared > maxSquared) {
        const scale = MAX_VELOCITY / Math.sqrt(speedSquared)
        nx *= scale
        ny *= scale
    }

    return {vx: nx, vy: ny}
}

export function applyAllForces(nodes: Map<string, Node>, links: Map<string, Link>, config: PhysicsConfig, width: number, height: number) {
    applyAttraction(links, config)
    applyRepulsion(nodes, config)
    applyCentering(nodes, config, width, height)    
    applyMovement(nodes, config, width, height)
}