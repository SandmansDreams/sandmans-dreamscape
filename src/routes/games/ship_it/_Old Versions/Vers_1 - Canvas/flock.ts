import { SpatialHash } from "./broadphase"
import type { Entity } from "./entities/entity"

/**
 * A group of entities that steer relative to each other.
 *
 * Boids is naturally O(n^2) — every member inspects every other member — which
 * is fine for a dozen and quadratic misery for a few hundred. The flock keeps a
 * spatial hash, rebuilt once per frame, so each member only inspects the
 * handful of others actually near it.
 */
export class Flock<T extends Entity = Entity> {
    readonly members: T[] = []

    private hash: SpatialHash<T>
    private scratch: T[] = []

    /**
     * @param interactionRadius the largest distance any steering rule cares
     *        about; also the hash's cell size, which keeps a neighbour query to
     *        a 3x3 block of buckets.
     */
    constructor(readonly interactionRadius: number = 250) {
        this.hash = new SpatialHash(interactionRadius)
    }

    get size(): number {
        return this.members.length
    }

    add(member: T): T {
        this.members.push(member)
        return member
    }

    /** Call once per frame, after positions have been integrated. */
    rebuild() {
        this.hash.clear()
        for (const member of this.members) {
            if (member.currentHealth <= 0) continue
            // Inserted as points: members are small relative to the cell size,
            // and single-cell insertion lets queries skip duplicate filtering.
            this.hash.insert(member, member.position.x, member.position.y)
        }
    }

    /**
     * Members near a point, as a SHARED array valid until the next call.
     * Consume it before querying again.
     */
    neighbors(x: number, y: number, radius: number = this.interactionRadius): T[] {
        return this.hash.query(x, y, radius, this.scratch)
    }

    /**
     * Removes members matching `isDead`, in place, and returns them.
     *
     * In place because controllers hold a reference to this flock — replacing
     * the array (as a `.filter()` would) would strand every one of them.
     */
    prune(isDead: (member: T) => boolean): T[] {
        const removed: T[] = []
        let write = 0

        for (let read = 0; read < this.members.length; read++) {
            const member = this.members[read]
            if (isDead(member)) {
                removed.push(member)
            } else {
                this.members[write++] = member
            }
        }

        this.members.length = write
        return removed
    }
}
