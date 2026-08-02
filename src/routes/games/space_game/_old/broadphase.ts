/**
 * Uniform spatial hash used to avoid O(n^2) scans over the world.
 *
 * Everything here is built to be rebuilt from scratch every frame: buckets and
 * the item list are reused rather than reallocated, and queries write into a
 * caller-supplied array so a full frame of lookups allocates nothing.
 *
 * Cell coordinates are packed into a single integer key, which bounds the
 * usable world to +/-(HASH_LIMIT * cellSize) on each axis. At the default cell
 * size that is a couple of million units in every direction — far beyond any
 * playfield we generate — and anything outside simply clamps into the edge
 * buckets rather than misbehaving.
 */

const HASH_LIMIT = 1 << 14 // 16384 cells from the origin on each axis
const HASH_STRIDE = 1 << 15

/** Rebuild the bucket map once it has sprawled, so roaming entities can't leak it. */
const MAX_BUCKETS = 8192

export class SpatialHash<T> {
    private buckets = new Map<number, number[]>()
    private items: T[] = []
    private seen = new Set<number>()

    /** True once any item has been inserted across more than one cell. */
    private multiCell = false

    constructor(public cellSize: number) {}

    get size(): number {
        return this.items.length
    }

    clear() {
        if (this.buckets.size > MAX_BUCKETS) {
            this.buckets = new Map()
        } else {
            for (const bucket of this.buckets.values()) bucket.length = 0
        }
        this.items.length = 0
        this.multiCell = false
    }

    /**
     * Inserts an item covering a circle. A radius of 0 puts the item in exactly
     * one bucket, which lets queries skip duplicate filtering entirely.
     */
    insert(item: T, x: number, y: number, radius: number = 0) {
        const index = this.items.length
        this.items.push(item)

        const minCol = this.toCell(x - radius)
        const maxCol = this.toCell(x + radius)
        const minRow = this.toCell(y - radius)
        const maxRow = this.toCell(y + radius)

        if (minCol !== maxCol || minRow !== maxRow) this.multiCell = true

        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                this.bucket(col, row).push(index)
            }
        }
    }

    /** Visits every inserted item exactly once, regardless of bucket spread. */
    forEach(visit: (item: T) => void) {
        for (let i = 0; i < this.items.length; i++) visit(this.items[i])
    }

    /**
     * Collects every item whose bucket overlaps the given circle into `out`.
     *
     * This is a broadphase: results are candidates, not hits. Callers still do
     * their own exact distance test.
     */
    query(x: number, y: number, radius: number, out: T[]): T[] {
        out.length = 0

        const minCol = this.toCell(x - radius)
        const maxCol = this.toCell(x + radius)
        const minRow = this.toCell(y - radius)
        const maxRow = this.toCell(y + radius)

        const dedupe = this.multiCell
        if (dedupe) this.seen.clear()

        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                const bucket = this.buckets.get(this.key(col, row))
                if (!bucket) continue

                for (let i = 0; i < bucket.length; i++) {
                    const index = bucket[i]
                    if (dedupe) {
                        if (this.seen.has(index)) continue
                        this.seen.add(index)
                    }
                    out.push(this.items[index])
                }
            }
        }

        return out
    }

    /**
     * Invokes `visit` once for each unique pair of items sharing a bucket.
     *
     * Items spanning several cells appear in several buckets, so pairs are
     * de-duplicated by index before being reported.
     */
    forEachPair(visit: (a: T, b: T) => void) {
        const stride = this.items.length
        const dedupe = this.multiCell
        if (dedupe) this.seen.clear()

        for (const bucket of this.buckets.values()) {
            const length = bucket.length
            if (length < 2) continue

            for (let i = 0; i < length - 1; i++) {
                const a = bucket[i]
                for (let j = i + 1; j < length; j++) {
                    const b = bucket[j]

                    if (dedupe) {
                        const key = a < b ? a * stride + b : b * stride + a
                        if (this.seen.has(key)) continue
                        this.seen.add(key)
                    }

                    visit(this.items[a], this.items[b])
                }
            }
        }
    }

    private toCell(value: number): number {
        const cell = Math.floor(value / this.cellSize)
        return cell < -HASH_LIMIT ? -HASH_LIMIT : cell > HASH_LIMIT ? HASH_LIMIT : cell
    }

    private key(col: number, row: number): number {
        return (col + HASH_LIMIT) * HASH_STRIDE + (row + HASH_LIMIT)
    }

    private bucket(col: number, row: number): number[] {
        const key = this.key(col, row)
        let bucket = this.buckets.get(key)
        if (!bucket) {
            bucket = []
            this.buckets.set(key, bucket)
        }
        return bucket
    }
}
