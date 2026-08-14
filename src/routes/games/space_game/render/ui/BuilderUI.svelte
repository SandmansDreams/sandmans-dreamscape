<script lang="ts">
    import { shapeSvgPath } from "../shapeSVG"
    import { DEFAULT_BRUSH, type Brush } from "../grid/brush"
    import { DRAWN_SHAPES } from "../grid/palette"
    import { turnCount, type BlockShape } from "../grid/shapes"
    import { SHIP_LAYERS } from "../grid/layers"
    import { canPlace, COMPONENT_KINDS, maxLevel, statsFor, type ComponentKind } from "../grid/components"
    import { KIND_LETTER } from "../grid/blockDraw"
    import type { SelectedCell, ShipInfo } from "../../dev/scenes/ship-builder"

    /**
     * The builder's whole interface.
     *
     * Owns nothing but which panel is showing. `brush`, `shipInfo` and `selected`
     * are the scene's, rendered here; every control asks for a change and waits
     * to be told what happened, so there is no local copy to fall out of step.
     */
    let { brush, palette = [], shipInfo = null, selected = null, onPatch, onAction, onUpgrade, onHighlight }: {
        brush: Brush
        /** Hex colors currently used in the ship, published by the scene. */
        palette?: string[]
        shipInfo?: ShipInfo | null
        /** The block last clicked, or null when that cell is empty. */
        selected?: SelectedCell | null
        onPatch: (patch: Partial<Brush>) => void
        onAction: (name: string) => void
        onUpgrade: (delta: number) => void
        /** Hex to box on the ship, or null to clear. */
        onHighlight: (hex: string | null) => void
    } = $props()

    const TOOLS = ["paint", "erase", "select"] as const

    /** The kind under the cursor right now, which outranks everything else. */
    let hoveredKind = $state<ComponentKind | null>(null)

    /** True while the brush places a machine rather than plain structure. */
    let placingComponent = $derived(brush.kind !== "hull")

    /**
     * What the bottom of the info panel talks about.
     *
     * Hover wins, then a block you clicked, then the component the brush is
     * holding - so picking a thruster leaves its stats on screen rather than
     * flashing them for only as long as the pointer rests on the button.
     */
    let describing = $derived(
        hoveredKind ?? (selected ? null : placingComponent ? brush.kind : null),
    )

    /** Requested, not applied. The scene decides, publishes, and this rerenders. */
    function set(patch: Partial<Brush>) {
        onPatch(patch)
    }

    /**
     * True while the brush would actually place what the pickers are showing.
     *
     * Erase and select act on blocks already down, so highlighting a shape or a
     * placement during either would advertise a choice that changes nothing.
     */
    let picking = $derived(brush.tool === "paint")

    /**
     * Switches shape, carrying the rotation when it still means something.
     *
     * A wedge's turn 3 is meaningless on a shape with one turn, so the rotation
     * only survives when the new shape turns the same number of ways. Anything
     * else starts from zero rather than landing somewhere arbitrary.
     */
    function selectShape(shape: BlockShape) {
        const count = turnCount(shape)
        const carried = count === turnCount(brush.shape) ? brush.turns % count : 0

        // Back to paint, as picking a placement does: choosing a shape while the
        // brush sits on erase would otherwise light nothing up and do nothing
        set({ shape, turns: carried, tool: "paint" })
    }

    /**
     * Picks a component to place.
     *
     * Also switches to paint and to a layer the kind is allowed on: choosing a
     * thruster while the brush sits on "erase" and the cosmetic layer meant three
     * more clicks before anything could happen, and every one of them was the
     * only possible answer.
     */
    function selectKind(kind: ComponentKind) {
        const layers = SHIP_LAYERS.filter((layer) => canPlace(kind, layer))
        const layer = layers.includes(brush.layer) ? brush.layer : layers[0] ?? brush.layer

        set({
            kind,
            layer,
            level: Math.min(brush.level, maxLevel(kind)),
            tool: brush.tool === "paint" ? brush.tool : "paint",
        })
    }

    /**
     * One step of orientation.
     *
     * A component draws as a hexagon, so turning its art means nothing - what
     * points somewhere is its facing. Structure has no facing, so it turns.
     */
    function rotate() {
        if (placingComponent) {
            set({ facing: (brush.facing + 1) % 4 })
            return
        }

        set({ turns: (brush.turns + 1) % turnCount(brush.shape) })
    }

    /** Cycles 1..max and wraps, so one key reaches every level of the current kind. */
    function cycleLevel() {
        set({ level: (brush.level % maxLevel(brush.kind)) + 1 })
    }

    function step<T>(list: readonly T[], current: T, by: number): T {
        const index = list.indexOf(current)
        return list[(index + by + list.length) % list.length]!
    }

    /** 1..max for a kind, which is what stands in for its variants. */
    function levelsOf(kind: ComponentKind): number[] {
        return Array.from({ length: maxLevel(kind) }, (_, index) => index + 1)
    }

    function onKey(event: KeyboardEvent) {
        // Typing a ship name must not rotate blocks and change layers
        const target = event.target as HTMLElement | null
        if (target?.isContentEditable) return
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

        switch (event.key) {
            case "r": case "R": rotate(); break
            case "m": case "M": set({ mirrored: !brush.mirrored }); break
            case "l": case "L": cycleLevel(); break
            case "ArrowLeft": selectShape(step(DRAWN_SHAPES, brush.shape, -1)); break
            case "ArrowRight": selectShape(step(DRAWN_SHAPES, brush.shape, 1)); break
            case "ArrowUp": set({ layer: step(SHIP_LAYERS, brush.layer, -1) }); break
            case "ArrowDown": set({ layer: step(SHIP_LAYERS, brush.layer, 1) }); break
            default: return
        }

        // Arrows scroll the page otherwise
        event.preventDefault()
    }

    /**
     * The orientation a swatch draws at.
     *
     * Only the selected shape shows the live rotation. The rest sit at zero, so
     * the picker reads as a menu of shapes rather than a jumble of angles - the
     * current orientation is visible on the ghost out in the world anyway.
     */
    function swatchTurns(shape: BlockShape): number {
        return shape === brush.shape ? brush.turns : 0
    }

    function swatchMirrored(shape: BlockShape): boolean {
        return shape === brush.shape && brush.mirrored
    }
</script>

<svelte:window onkeydown={onKey} />

<div id="build-ui">
    <div id="top-panel" class="panel">
        <div class="group">
            {#each TOOLS as name (name)}
                <button class={brush.tool === name ? "active" : ""} onclick={() => set({ tool: name })}>
                    {name}
                </button>
            {/each}
        </div>

        <span class="divider"></span>

        <div class="group">
            <button onclick={() => onAction("undo")}>undo</button>
            <button onclick={() => onAction("redo")}>redo</button>
            <button onclick={() => onAction("clearLayer")}>clear layer</button>
            <button onclick={() => onAction("clearAll")}>clear all</button>
        </div>

        <span class="divider"></span>

        <div class="group">
            <button onclick={() => onAction("upload")}>upload</button>
            <button onclick={() => onAction("download")}>download</button>
        </div>

        <span class="divider"></span>

        <div class="group hints">
            <span><b>R</b> rotate</span>
            <span><b>M</b> mirror</span>
            <span><b>L</b> level</span>
        </div>
    </div>

    <div id="draw-panel" class="panel">
        <div class="heading">COLOR</div>
        <input
            id="build-color"
            type="color"
            value={brush.color}
            oninput={(e) => set({ color: e.currentTarget.value })}
        />

        <div class="heading">EMISSION</div>
        <div class="slider-row">
            <input
                type="range" min="0" max="1" step="0.05"
                value={brush.emission}
                oninput={(e) => set({ emission: e.currentTarget.valueAsNumber })}
            />
            <span class="slider-value">{brush.emission.toFixed(2)}</span>
        </div>

        <div class="heading">PLACEMENTS</div>
        <div id="placements">
            {#each COMPONENT_KINDS as kind (kind)}
                <button
                    class={`placement-swatch ${picking && brush.kind === kind ? "active" : ""}`}
                    onclick={() => selectKind(kind)}
                    onmouseenter={() => (hoveredKind = kind)}
                    onmouseleave={() => (hoveredKind = null)}
                    title={kind}
                    aria-label={kind}
                >
                    <svg class="shape-svg" viewBox="0 0 100 100" aria-hidden="true">
                        <path d={shapeSvgPath("hexagon", 0, false)} fill={brush.color} />
                        <text x="50" y="46" class="glyph">{KIND_LETTER[kind] || "H"}</text>
                        <!-- The level rides the sprite, the same way it does on a
                             placed block, so the picker reads like the ship will -->
                        {#if brush.kind === kind && brush.level > 1}
                            <text x="78" y="80" class="glyph-level">{brush.level}</text>
                        {/if}
                    </svg>
                </button>
            {/each}
        </div>

        <!-- Only a machine has grades to choose between; structure has shapes,
             and those live in the tray along the bottom -->
        {#if placingComponent}
            <div class="heading">{brush.kind.toUpperCase()}</div>
            <div id="levels">
                {#each levelsOf(brush.kind) as level (level)}
                    <button
                        class={`level-swatch ${brush.level === level ? "active" : ""}`}
                        onclick={() => set({ level })}
                        onmouseenter={() => (hoveredKind = brush.kind)}
                        onmouseleave={() => (hoveredKind = null)}
                    >
                        <span class="roman">L{level}</span>
                        <span class="sub">{statsFor(brush.kind, level).hitPoints}hp</span>
                    </button>
                {/each}
            </div>
        {/if}

        <div class="heading">PALETTE</div>
        <div id="palette">
            {#each palette as entry (entry)}
                <!-- Hovering boxes every block already wearing this colour, which is
                     how you find the three cells you got wrong on a finished hull -->
                <button
                    class="palette-swatch {brush.color.toLowerCase() === entry.toLowerCase() ? 'active' : ''}"
                    style:background-color={entry}
                    title={entry}
                    aria-label={entry}
                    onclick={() => set({ color: entry })}
                    onmouseenter={() => onHighlight(entry)}
                    onmouseleave={() => onHighlight(null)}
                ></button>
            {/each}
            {#if palette.length === 0}
                <span class="empty small">empty</span>
            {/if}
        </div>
    </div>

    <div id="info-panel" class="panel">
        <div class="heading">SHIP</div>
        {#if shipInfo}
            <dl class="readout">
                <dt>name</dt><dd>{shipInfo.name}</dd>
                <dt>by</dt><dd>{shipInfo.creator}</dd>
                <dt>mass</dt><dd>{shipInfo.mass}</dd>
                <dt>blocks</dt><dd>{shipInfo.blocks}</dd>
                <dt>size</dt><dd>{shipInfo.width}x{shipInfo.height}</dd>
            </dl>
        {:else}
            <p class="empty">no ship yet</p>
        {/if}

        <div class="heading">LAYERS</div>
        <div id="layers">
            {#each SHIP_LAYERS as layer (layer)}
                <!-- Disabled rather than hidden: the count is still worth reading,
                     and a row vanishing as you switch kinds is disorienting -->
                <button
                    class={`layer-row ${brush.layer === layer ? "active" : ""}`}
                    onclick={() => set({ layer })}
                    disabled={!canPlace(brush.kind, layer)}
                    title={canPlace(brush.kind, layer) ? layer : `${brush.kind} cannot go on ${layer}`}
                >
                    <span>{layer}</span>
                    <span class="count">{shipInfo?.perLayer[layer] ?? 0}</span>
                </button>
            {/each}
        </div>

        <!-- A hovered kind wins over the selection: you are asking about the thing
             under the cursor right now, not the thing you clicked a minute ago -->
        {#if describing}
            {@const stats = statsFor(describing, brush.level)}
            <div class="heading">{describing.toUpperCase()} L{brush.level}</div>
            <dl class="readout">
                <dt>hp</dt><dd>{stats.hitPoints}</dd>
                <dt>mass</dt><dd>{stats.mass}</dd>
                <dt>levels</dt><dd>{maxLevel(describing)}</dd>
            </dl>
        {:else if selected}
            <div class="heading">BLOCK</div>
            <dl class="readout">
                <dt>at</dt><dd>{selected.col}, {selected.row}</dd>
                <dt>layer</dt><dd>{selected.layer}</dd>
                <dt>shape</dt><dd>{selected.shape}</dd>
                <dt>kind</dt><dd>{selected.kind}</dd>
                <dt>hp</dt><dd>{selected.hitPoints}</dd>
                <dt>mass</dt><dd>{selected.mass}</dd>
            </dl>

            <div id="level-row">
                <!-- Upgrades the block already on the ship, not the brush. The scene
                     re-runs set() so hit points and mass follow the level. -->
                <button onclick={() => onUpgrade(-1)} disabled={selected.level <= 1}>&minus;</button>
                <span class="level">L{selected.level} / {selected.maxLevel}</span>
                <button onclick={() => onUpgrade(1)} disabled={selected.level >= selected.maxLevel}>+</button>
            </div>
        {:else}
            <div class="heading">BLOCK</div>
            <p class="empty">select a block</p>
        {/if}
    </div>

    <div id="bottom-panel" class="panel">
        {#each DRAWN_SHAPES as shape (shape)}
            <button
                class={`shape-swatch wide ${picking && brush.shape === shape ? "active" : ""}`}
                onclick={() => selectShape(shape)}
                title={shape}
                aria-label={shape}
            >
                <svg class="shape-svg" viewBox="0 0 100 100" aria-hidden="true">
                    <path
                        d={shapeSvgPath(shape, swatchTurns(shape), swatchMirrored(shape))}
                        fill={brush.color}
                    />
                </svg>
                <span class="component-name">{shape}</span>
            </button>
        {/each}
    </div>
</div>

<style>
    #build-ui {
        --ui-background: rgba(0, 191, 255, 0.3);
        --ui-background-dark: rgba(0, 20, 34, 0.82);
        --ui-border: rgba(0, 191, 255, 0.55);
        --ui-separator: rgba(0, 191, 255, 0.25);
        --text-color: rgb(0, 221, 255);
        --active: rgb(0, 255, 64);

        position: fixed;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        margin: 0;
        color: var(--text-color);
        background: none;
        z-index: 1;
        font-family: 'Courier New', Courier, monospace;
        /* The panels take the pointer back; everything between belongs to the canvas */
        pointer-events: none;
    }

    .panel {
        pointer-events: auto;
        position: absolute;
        background: var(--ui-background-dark);
        border: 2px solid var(--ui-border);
        border-radius: 8px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
        overflow: hidden;
    }

    button {
        background-color: var(--ui-background);
        border: solid 2px transparent;
        border-radius: 6px;
        padding: .35rem .7rem;
        font-family: inherit;
        color: var(--text-color);
        font-weight: bold;
        font-size: 14px;
        cursor: pointer;
        transition: background-color .12s ease, border-color .12s ease;
    }
    button:hover { background-color: rgba(0, 191, 255, 0.45); }
    button:active { background-color: rgba(0, 191, 255, 0.15); }
    button:disabled { opacity: .3; cursor: default; }
    button:disabled:hover { background-color: var(--ui-background); }

    button.active {
        background-color: rgba(0, 255, 64, 0.28);
        color: var(--active);
        border-color: rgba(0, 255, 64, 0.6);
    }
    button.active:hover { background-color: rgba(0, 255, 64, 0.4); }

    .heading {
        text-align: center;
        line-height: 20px;
        font-size: 11px;
        letter-spacing: .14em;
        font-weight: bold;
        color: var(--text-color);
        background: var(--ui-background);
        border-bottom: 1px solid var(--ui-separator);
    }

    .empty {
        margin: 0;
        padding: 8px;
        font-size: 12px;
        opacity: .5;
        text-align: center;
    }
    .empty.small { padding: 4px; grid-column: 1 / -1; }

    /*~~~ Top: tools ~~~*/
    #top-panel {
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
    }
    .group { display: flex; gap: 5px; align-items: center; }
    .divider {
        width: 1px;
        align-self: stretch;
        background: var(--ui-separator);
    }
    .hints {
        gap: 10px;
        font-size: 11px;
        opacity: .7;
    }
    .hints b { color: var(--active); }

    /*~~~ Left: colour, shapes or levels, palette ~~~*/
    #draw-panel {
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        width: 122px;
        max-height: 74vh;
        overflow-y: auto;
    }

    #build-color {
        display: block;
        width: calc(100% - 12px);
        height: 26px;
        margin: 6px;
        padding: 0;
        border: 2px solid var(--ui-border);
        border-radius: 5px;
        background: none;
        cursor: pointer;
    }
    /* Strip the native chrome so the swatch fills the control. */
    #build-color::-webkit-color-swatch-wrapper { padding: 2px; }
    #build-color::-webkit-color-swatch { border: none; border-radius: 3px; }

    .slider-row {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 5px 6px;
    }
    .slider-row input[type="range"] {
        flex: 1;
        min-width: 0;
        accent-color: var(--text-color);
    }
    .slider-value {
        font-size: 10px;
        opacity: .7;
        font-variant-numeric: tabular-nums;
    }

    #shapes { display: grid; grid-template-columns: repeat(2, 1fr); }
    .shape-swatch {
        border: 1px solid var(--ui-separator);
        border-radius: 0;
        width: 100%;
        margin: 0;
        aspect-ratio: 1 / 1;
        padding: 4px;
        background: transparent;
    }
    .shape-swatch:hover { background: rgba(0, 191, 255, 0.2); }
    .shape-swatch.active { background: rgba(0, 255, 64, 0.22); }
    .shape-svg { width: 100%; height: 100%; display: block; }

    /* The bottom tray runs sideways, so its swatches are fixed-width columns with
       a name under the art rather than cells in a grid */
    .shape-swatch.wide {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        width: 62px;
        flex-shrink: 0;
        aspect-ratio: auto;
        border-radius: 5px;
    }
    .shape-swatch.wide .shape-svg { width: 30px; height: 30px; }

    /* Two across, same square cells as the shapes had - a placement is picked the
       same way a shape is, and the column is only wide enough for two */
    #placements { display: grid; grid-template-columns: repeat(2, 1fr); }
    .placement-swatch {
        border: 1px solid var(--ui-separator);
        border-radius: 0;
        width: 100%;
        margin: 0;
        aspect-ratio: 1 / 1;
        padding: 4px;
        background: transparent;
    }
    .placement-swatch:hover { background: rgba(0, 191, 255, 0.2); }
    .placement-swatch.active { background: rgba(0, 255, 64, 0.22); }

    #levels { display: flex; flex-direction: column; }
    .level-swatch {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        border-radius: 0;
        border: 1px solid var(--ui-separator);
        background: transparent;
        padding: .3rem .5rem;
    }
    .level-swatch:hover { background: rgba(0, 191, 255, 0.2); }
    .roman { font-size: 13px; }
    .sub { font-size: 10px; opacity: .6; }

    #palette {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 2px;
        padding: 3px;
    }
    .palette-swatch {
        border: 2px solid transparent;
        width: 100%;
        aspect-ratio: 1 / 1;
        border-radius: 3px;
        padding: 0;
    }
    /* A ring rather than a fill, so the swatch keeps showing its own colour */
    .palette-swatch:hover { border-color: var(--text-color); }
    .palette-swatch.active { border-color: var(--active); }

    /*~~~ Right: ship, layers, block or hovered kind ~~~*/
    #info-panel {
        right: 14px;
        top: 50%;
        transform: translateY(-50%);
        width: 186px;
        max-height: 74vh;
        overflow-y: auto;
    }

    .readout {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 8px;
        margin: 0;
        padding: 6px 8px;
        font-size: 12px;
    }
    .readout dt { opacity: .6; }
    .readout dd {
        margin: 0;
        text-align: right;
        font-weight: bold;
        /* A long ship name must not widen the panel */
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    #layers { display: flex; flex-direction: column; }
    .layer-row {
        display: flex;
        justify-content: space-between;
        border-radius: 0;
        border: 1px solid var(--ui-separator);
        background: transparent;
        font-size: 12px;
        padding: .3rem .5rem;
    }
    .layer-row:hover { background: rgba(0, 191, 255, 0.2); }
    .count { opacity: .6; }

    #level-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 6px 8px;
    }
    #level-row button { padding: .1rem .55rem; }
    .level { font-size: 13px; font-weight: bold; }

    /*~~~ Bottom: functional blocks ~~~*/
    #bottom-panel {
        bottom: 14px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 6px;
        padding: 8px;
        max-width: 62vw;
        overflow-x: auto;
    }
    .component-swatch {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        width: 70px;
        flex-shrink: 0;
        padding: 4px;
        background: transparent;
        border: 2px solid var(--ui-separator);
    }
    .component-swatch:hover { background: rgba(0, 191, 255, 0.2); }
    .component-swatch .shape-svg { width: 32px; height: 32px; }
    .component-name { font-size: 11px; }

    .glyph {
        font-size: 44px;
        font-family: inherit;
        font-weight: bold;
        text-anchor: middle;
        dominant-baseline: central;
        fill: rgba(0, 20, 34, 0.75);
    }
    .glyph-level {
        font-size: 30px;
        font-family: inherit;
        font-weight: bold;
        text-anchor: middle;
        dominant-baseline: central;
        fill: rgba(0, 20, 34, 0.9);
    }

    /* Chrome and Safari. These are ignored the moment scrollbar-width or
       scrollbar-color is set on the same element, which is why the standard
       properties are quarantined in the @supports block below. */
    .panel::-webkit-scrollbar { width: 8px; height: 8px; }
    .panel::-webkit-scrollbar-track { background: transparent; }
    .panel::-webkit-scrollbar-thumb {
        background: var(--ui-background);
        border-radius: 4px;
    }
    .panel::-webkit-scrollbar-thumb:hover { background: var(--ui-border); }

    /* Firefox, which has no pseudo-elements to style */
    @supports not selector(::-webkit-scrollbar) {
        .panel {
            scrollbar-width: thin;
            scrollbar-color: var(--ui-background) transparent;
        }
    }
</style>
