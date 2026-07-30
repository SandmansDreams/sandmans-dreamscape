import { buildStarMap, drawLayerLocally } from "./background"
import { SpatialHash } from "./broadphase"
import { EmptyController, type PlayerController } from "./controller"
import { Asteroid, spawnAsteroidField } from "./entities/asteroid"
import { spawnScouter } from "./entities/enemy"
import { Ship } from "./entities/ship"
import { buildStarterHull, STARTER_MOUNTS } from "./entities/shipModels/starter"
import { Flock } from "./flock"
import { getRandomVector, isVisible } from "./helpers"
import { LightingEnvironment, LightSource, type SurfaceLight } from "./lighting"
import { drawParticles, Particle, spawnExplosion } from "./particle"
import { Thruster, Turret } from "./placements"
import { CollisionManager, Vector2 } from "./physics"
import { Camera, NO_DEBUG, Player, type DebugOptions } from "./types"

export interface WorldOptions {
    shipCount?: number
    scouterCount?: number
    asteroidCount?: number
    fieldSize?: number
}

const DEFAULTS: Required<WorldOptions> = {
    shipCount: 1,
    scouterCount: 100,
    asteroidCount: 200,
    fieldSize: 4000
}

/** Ceiling on live cosmetic particles. Projectiles are exempt — see emit(). */
const MAX_PARTICLES = 4000

/**
 * The simulation: everything that exists in space, and how it advances and
 * draws. The Svelte component owns input, UI state and the build editor; it
 * drives this and otherwise stays out of it.
 */
export class World {
    readonly camera = new Camera()
    readonly lighting = new LightingEnvironment()

    ships: Ship[] = []
    readonly enemies = new Flock<Ship>(250)
    asteroids: Asteroid[] = []
    particles: Particle[] = []
    starMaps: HTMLCanvasElement[] = []

    player!: Player

    private readonly options: Required<WorldOptions>
    private readonly collisions = new CollisionManager()

    /** Rebuilt each frame so projectiles test only against nearby targets. */
    private readonly targets = new SpatialHash<Asteroid | Ship>(200)
    private readonly candidates: (Asteroid | Ship)[] = []

    /** Reused across frames so the per-entity lighting pass allocates nothing. */
    private readonly shipLights = new Map<Ship, SurfaceLight>()

    /** Scratch for collision broadphase input; refilled, never reallocated. */
    private readonly bodies: (Asteroid | Ship)[] = []

    constructor(options: WorldOptions = {}) {
        this.options = { ...DEFAULTS, ...options }
    }

    /** Builds the starting scene. Requires a DOM (star maps are canvases). */
    init(controller: PlayerController) {
        this.starMaps = [
            buildStarMap(1000, 1000, 0.2, 4),
            buildStarMap(1000, 1000, 0.05, 7),
            buildStarMap(1000, 1000, 0.006, 12)
        ]

        this.lighting.add(new LightSource({
            position: new Vector2(5000, -4000),
            color: "#a832a4",
            intensity: 1,
            radius: 120,
            // Comfortably larger than the playfield, so the sun reads as a
            // distant source: direction varies, brightness barely does.
            range: 20000
        }))

        this.ships = []
        for (let i = 0; i < this.options.shipCount; i++) {
            this.ships.push(buildStarterShip())
        }

        this.player = new Player(this.ships, controller)

        for (let i = 0; i < this.options.scouterCount; i++) {
            this.enemies.add(spawnScouter(getRandomVector(1000, 1000), this.player.currentShip, this.enemies))
        }

        this.asteroids = spawnAsteroidField(
            this.options.asteroidCount,
            this.options.fieldSize,
            this.options.fieldSize
        )
    }

    // --- Simulation ---------------------------------------------------------

    update(delta: number, followCamera: boolean) {
        this.emit(this.player.update(delta, this.enemies.members))

        this.enemies.rebuild()
        for (const enemy of this.enemies.members) {
            enemy.update(delta)
            // Enemies run their modules too, otherwise their thrusters are
            // inert and they fly with no exhaust. Player hulls are the only
            // thing their weapons should ever consider.
            this.emit(enemy.updatePlacements(delta, this.ships))
        }

        for (const asteroid of this.asteroids) asteroid.update(delta)

        this.updateProjectiles(delta)
        this.reapEnemies()
        this.reapAsteroids()

        this.bodies.length = 0
        for (const ship of this.ships) this.bodies.push(ship)
        for (const enemy of this.enemies.members) this.bodies.push(enemy)
        for (const asteroid of this.asteroids) this.bodies.push(asteroid)
        this.collisions.update(this.bodies)

        if (followCamera) {
            this.camera.follow(this.player.currentShip)
        }
    }

    /**
     * Queues newly spawned particles, discarding the overflow.
     *
     * A hundred thrusting scouters emit continuously, so the plume needs a
     * ceiling. Damaging particles are always admitted — dropping a shot
     * because the screen is busy would be a gameplay bug, not a visual one.
     */
    private emit(spawned: Particle[]) {
        for (let i = 0; i < spawned.length; i++) {
            const particle = spawned[i]
            if (particle.damage > 0 || this.particles.length < MAX_PARTICLES) {
                this.particles.push(particle)
            }
        }
    }

    /**
     * Advances particles and resolves hits.
     *
     * Every projectile used to be tested against every asteroid and every
     * enemy, and the enemy test recomputed the enemy's bounding radius from
     * scratch inside that loop. Now targets go into a spatial hash once and
     * each projectile only looks at its own neighbourhood.
     */
    private updateProjectiles(delta: number) {
        this.targets.clear()
        for (const asteroid of this.asteroids) {
            this.targets.insert(asteroid, asteroid.position.x, asteroid.position.y, asteroid.hitRadius)
        }
        for (const enemy of this.enemies.members) {
            this.targets.insert(enemy, enemy.position.x, enemy.position.y, enemy.hitRadius)
        }

        let alive = 0

        for (const particle of this.particles) {
            particle.update(delta)

            if (!particle.dead && particle.damage > 0) {
                const hits = this.targets.query(particle.position.x, particle.position.y, 0, this.candidates)

                for (let i = 0; i < hits.length; i++) {
                    const target = hits[i]

                    // Exact test against the real hitbox, so shots pass through
                    // the corners a ship's bounding circle would have caught.
                    if (target.collider?.containsPoint(particle.position.x, particle.position.y)) {
                        target.takeDamage(particle.damage)
                        particle.dead = true
                        break
                    }
                }
            }

            // Compact in place rather than allocating a new array every frame.
            if (!particle.dead) this.particles[alive++] = particle
        }

        this.particles.length = alive
    }

    private reapEnemies() {
        const destroyed = this.enemies.prune(enemy => enemy.currentHealth <= 0)
        for (const enemy of destroyed) {
            this.emit(spawnExplosion(enemy.position, 30, 2.5, 4, 40))
        }
    }

    private reapAsteroids() {
        const survivors: Asteroid[] = []
        const children: Asteroid[] = []

        for (const asteroid of this.asteroids) {
            if (!asteroid.dead) {
                survivors.push(asteroid)
                continue
            }
            this.emit(
                spawnExplosion(asteroid.position, Math.round(asteroid.radius / 2), 1.5, asteroid.radius / 10, 25)
            )
            children.push(...asteroid.split())
        }

        this.asteroids = survivors.concat(children)
    }

    // --- Rendering ----------------------------------------------------------

    drawBackground(ctx: CanvasRenderingContext2D) {
        ctx.save()
        for (let i = 0; i < this.starMaps.length; i++) {
            drawLayerLocally(this.starMaps[i], (i + 1) * 0.1, ctx, this.camera)
        }
        ctx.restore()
    }

    draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, debug: DebugOptions = NO_DEBUG) {
        this.lighting.drawLights(ctx, this.camera)

        for (const asteroid of this.asteroids) {
            if (!isVisible(asteroid.position.x, asteroid.position.y, asteroid.drawRadius, canvas, this.camera)) {
                continue
            }
            asteroid.draw(ctx, this.camera, debug, this.sampleFor(asteroid))
        }

        // Ship lighting is sampled up front because Player.draw fans out over
        // its fleet and needs the results keyed by ship.
        this.shipLights.clear()
        for (const ship of this.ships) {
            const light = this.sampleFor(ship)
            if (light) this.shipLights.set(ship, light)
        }

        this.player.draw(ctx, this.camera, debug, this.shipLights)

        for (const enemy of this.enemies.members) {
            if (!isVisible(enemy.position.x, enemy.position.y, enemy.hitRadius, canvas, this.camera)) {
                continue
            }
            enemy.draw(ctx, this.camera, debug, this.sampleFor(enemy))
        }

        drawParticles(ctx, this.camera, this.particles)
    }

    private sampleFor(entity: Asteroid | Ship): SurfaceLight | undefined {
        return this.lighting.sample(
            entity.position.x,
            entity.position.y,
            entity.lightRotation,
            entity.grid.getBoundingRadius()
        )
    }
}

function buildStarterShip(): Ship {
    const grid = buildStarterHull()

    const turret = new Turret()
    const turretCell = grid.getCell(STARTER_MOUNTS.turret.col, STARTER_MOUNTS.turret.row)
    turret.cell = turretCell
    grid.setCell(turretCell, turretCell.shape, turretCell.color, turret)

    for (const mount of STARTER_MOUNTS.thrusters) {
        const cell = grid.getCell(mount.col, mount.row)
        const thruster = new Thruster()
        thruster.cell = cell
        grid.setCell(cell, cell.shape, cell.color, thruster)
    }

    return new Ship(getRandomVector(1000, 1000), new Vector2(0, 0), 0, new EmptyController(), grid)
}
