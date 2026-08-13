<script lang="ts">
    import { shapeSvgPath } from "../shapeSVG"
    import { DEFAULT_BRUSH, type Brush } from "../grid/brush"
    import { DRAWN_SHAPES } from "../grid/palette"
    import { SHIP_LAYERS } from "../grid/layers"
    import { COMPONENT_KINDS, maxLevel, type ComponentKind } from "../grid/components"
    import { turnCount, variantCount, type BlockShape } from "../grid/shapes"

    /**
     * The ship editor's controls.
     *
     * Owns nothing. `brush` is the scene's, rendered here; every control asks for
     * a change through onPatch and waits to be told what the brush became. That
     * is why there is no local copy to fall out of step with the scene.
     */
    let { brush, palette = [], onPatch }: {
        brush: Brush
        /** Hex colors currently used in the ship, published by the scene. */
        palette?: string[]
        onPatch: (patch: Partial<Brush>) => void
    } = $props()

    const FACINGS = ["N", "E", "S", "W"] as const
    const TOOLS = ["paint", "erase"] as const

    /**
     * Which row the bottom bar shows.
     *
     * The one piece of state that genuinely belongs here: it is a view choice, not
     * part of the brush. The brush carries a shape and a component kind at all
     * times, so switching tabs never changes what would be placed.
     */
    let tab = $state<"blocks" | "components">("blocks")

    /** Requested, not applied. The scene decides, publishes, and this rerenders. */
    function set(patch: Partial<Brush>) {
        onPatch(patch)
    }

    function selectShape(shape: BlockShape) {
        // Orientation resets with the shape: turn 3 of a wedge means nothing once
        // you have switched to a circle, and carrying it over is confusing
        set({ shape, turns: 0, mirrored: false })
    }

    function selectKind(kind: ComponentKind) {
        set({ kind, level: Math.min(brush.level, maxLevel(kind)) })
    }

    /**
     * One step through every distinct state of the current shape.
     *
     * Indices at or past turnCount mean mirrored, so R walks four rotations and
     * then the four mirrored ones - rotation alone can never produce a mirror
     * image, and a symmetric hull needs both hands of a ramp. On a `full` block
     * this does nothing, because it has exactly one distinct state.
     */
    function rotate() {
        const turns = turnCount(brush.shape)
        const next = ((brush.mirrored ? turns + brush.turns : brush.turns) + 1) % variantCount(brush.shape)

        set({ turns: next % turns, mirrored: next >= turns })
    }

    /** True when [R] would visibly do something, so the hint only shows where it helps. */
    function isRotatable(shape: BlockShape): boolean {
        return variantCount(shape) > 1
    }

    function step<T>(list: readonly T[], current: T, by: number): T {
        const index = list.indexOf(current)
        return list[(index + by + list.length) % list.length]!
    }

    function onKey(event: KeyboardEvent) {
        // Typing a ship name must not rotate blocks and change layers
        const target = event.target as HTMLElement | null
        if (target?.isContentEditable) return
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

        switch (event.key) {
            case "r": case "R": rotate(); break
            case "m": case "M": set({ mirrored: !brush.mirrored }); break
            case "ArrowLeft": selectShape(step(DRAWN_SHAPES, brush.shape, -1)); break
            case "ArrowRight": selectShape(step(DRAWN_SHAPES, brush.shape, 1)); break
            case "ArrowUp": set({ layer: step(SHIP_LAYERS, brush.layer, -1) }); break
            case "ArrowDown": set({ layer: step(SHIP_LAYERS, brush.layer, 1) }); break
            default: return
        }

        // Arrows scroll the page otherwise
        event.preventDefault()
    }
</script>

<svelte:window onkeydown={onKey} />

<!-- V1's shape exactly: a full-screen grid of bar, spacer, bar. The spacer is
     inert so the canvas underneath still gets the pointer - V1 could put its
     handlers here because its editor lived in the DOM, and ours does not -->
<div id="build-ui">
    <div id="top-bar" class="ui">
        <h1>Ship Builder</h1>

        <div class="bar-group">
            <span class="bar-label">Layer</span>
            {#each SHIP_LAYERS as name (name)}
                <button class={brush.layer === name ? "active" : ""} onclick={() => set({ layer: name })}>
                    {name}
                </button>
            {/each}
        </div>

        <div class="bar-group">
            <span class="bar-label">Tool</span>
            {#each TOOLS as name (name)}
                <button class={brush.tool === name ? "active" : ""} onclick={() => set({ tool: name })}>
                    {name}
                </button>
            {/each}
        </div>

        <div class="color-picker">
            <label for="build-color">Colour</label>
            <input
                id="build-color"
                type="color"
                value={brush.color}
                oninput={(e) => set({ color: e.currentTarget.value })}
            />
            <span class="color-value">{brush.color}</span>
        </div>

        {#if palette.length > 0}
            <div class="bar-group palette">
                <span class="bar-label">Palette</span>
                {#each palette as entry (entry)}
                    <!-- Re-selects a colour already in the ship; placing always uses
                         the picker, so this never gates what you can build -->
                    <button
                        class="chip {brush.color.toLowerCase() === entry.toLowerCase() ? 'active' : ''}"
                        style:background-color={entry}
                        title={entry}
                        aria-label={entry}
                        onclick={() => set({ color: entry })}
                    ></button>
                {/each}
            </div>
        {/if}

        <button onclick={() => onPatch(DEFAULT_BRUSH)}>Reset</button>
    </div>

    <div id="spacer"></div>

    <div id="bottom-bar" class="ui">
        <div id="bottom-bar-left">
            <h3 id="bottom-bar-title-bar">
                {tab === "blocks" ? "Hull Editor" : "Components"}

                {#if tab === "blocks"}
                    <span class="rotate-hint">left/right picks &middot; R rotates &middot; M mirrors</span>
                {:else}
                    <!-- Level and facing belong to the component, so they sit with
                         the component row rather than in the always-on top bar -->
                    <span class="inline">
                        Level
                        <input
                            type="range" min="1" max={maxLevel(brush.kind)} step="1"
                            value={brush.level}
                            oninput={(e) => set({ level: e.currentTarget.valueAsNumber })}
                        />
                        <span class="readout">{brush.level}</span>
                    </span>

                    <span class="inline">
                        Facing
                        {#each FACINGS as name, index (name)}
                            <button
                                class="tiny {brush.facing === index ? 'active' : ''}"
                                onclick={() => set({ facing: index })}
                            >{name}</button>
                        {/each}
                    </span>
                {/if}
            </h3>

            <div id="bottom-bar-options">
                {#if tab === "blocks"}
                    {#each DRAWN_SHAPES as shape (shape)}
                        <button
                            class={brush.shape === shape ? "active" : ""}
                            onclick={() => selectShape(shape)}
                        >
                            <!-- The selected block previews its live orientation; the
                                 rest sit at turn 0, so the row reads as a menu rather
                                 than a jumble -->
                            <svg class="block-preview" viewBox="0 0 100 100" aria-hidden="true">
                                <path
                                    d={shapeSvgPath(
                                        shape,
                                        brush.shape === shape ? brush.turns : 0,
                                        brush.shape === shape && brush.mirrored,
                                    )}
                                    fill={brush.color}
                                />
                            </svg>
                            {shape}
                            {#if brush.shape === shape && isRotatable(shape)}
                                <span class="rotate-hint">[R]</span>
                            {/if}
                        </button>
                    {/each}
                {:else}
                    {#each COMPONENT_KINDS as kind (kind)}
                        <button
                            class={brush.kind === kind ? "active" : ""}
                            onclick={() => selectKind(kind)}
                        >
                            <!-- The component's art is GPU-side, so the letter stands
                                 in for it - the same letter the scene draws -->
                            <span class="glyph" style:color={brush.color}>{kind[0]?.toUpperCase()}</span>
                            {kind}
                            <span class="rotate-hint">max {maxLevel(kind)}</span>
                        </button>
                    {/each}
                {/if}
            </div>
        </div>

        <div id="bottom-bar-right">
            <div id="bottom-bar-selector">
                <button class={tab === "blocks" ? "active" : ""} onclick={() => (tab = "blocks")}>Blocks</button>
                <button class={tab === "components" ? "active" : ""} onclick={() => (tab = "components")}>Components</button>
            </div>
        </div>
    </div>
</div>

<style>
    /* V1 declared these on :root. A scoped component cannot, so they hang off
       the wrapper instead and inherit down exactly the same way. */
    #build-ui {
        --ui-background: rgba(0, 191, 255, 0.3);
        --ui-background-dark: rgba(0, 191, 255, 0.1);
        --text-color: rgb(0, 221, 255);

        position: fixed;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        display: grid;
        grid-template-rows: auto 1fr auto;
        z-index: 3;
        margin: 0;
        overflow: hidden;
        color: var(--text-color);
        font-family: 'Courier New', Courier, monospace;
        /* The bars take the pointer back; everything between belongs to the canvas */
        pointer-events: none;
    }

    #top-bar, #bottom-bar { pointer-events: auto; }

    h1, h3 {
        line-height: normal;
        margin: 0;
        padding: 0;
    }

    button {
        background-color: var(--ui-background);
        border: solid 3px var(--ui-background);
        border-radius: 10px;
        padding: .5rem 1rem;
        font-family: 'Courier New', Courier, monospace;
        color: var(--text-color);
        font-weight: bold;
        font-size: 18px;
        cursor: pointer;
    }
    button:hover { background-color: rgba(0, 191, 255, 0.25); }
    button:active { background-color: rgba(0, 191, 255, 0.05); }

    button.active {
        background-color: rgba(0, 255, 64, 0.3);
        color: rgba(0, 255, 64, 0.8);
        border-color: rgba(0, 255, 64, 0.5);
    }
    button.active:hover { background-color: rgba(0, 255, 64, 0.25); }
    button.active:active { background-color: rgba(0, 255, 64, 0.1); }

    .ui { background-color: var(--ui-background); }

    #top-bar {
        display: flex;
        padding: 1rem;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border-bottom: solid 3px var(--ui-background);
        flex-wrap: wrap;
    }

    .bar-group {
        display: flex;
        align-items: center;
        gap: .5rem;
    }
    .bar-label {
        font-size: 12px;
        opacity: 0.8;
        text-transform: uppercase;
    }
    /* Scrolls rather than wraps: a wrapping palette makes the whole bar taller as
       a ship gains colours, and anything positioned below it has no fixed height
       to clear */
    .palette {
        flex-wrap: nowrap;
        overflow-x: auto;
        max-width: 28vw;
        padding-bottom: 2px;
    }
    .chip {
        width: 28px;
        height: 28px;
        padding: 0;
        border-radius: 6px;
    }

    #spacer {
        height: 100%;
        width: 100%;
        position: relative;
    }

    #bottom-bar {
        position: relative;
        display: grid;
        grid-template-columns: 9fr 2fr;
        align-items: center;
        border-top: solid 3px var(--ui-background);
        background: none;
        height: 100%;
    }
    #bottom-bar-left {
        position: relative;
        height: 100%;
        display: grid;
        grid-template-rows: 1fr 4fr;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
    }
    #bottom-bar-title-bar {
        border: 1px solid var(--ui-background);
        align-content: center;
        padding: .5rem;
        font-weight: bold;
        background-color: var(--ui-background);
        display: flex;
        align-items: center;
        gap: .75rem;
    }

    .color-picker {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: 90px;
        flex-shrink: 0;
        padding: 4px 8px;
        border-right: 1px solid var(--ui-background);
        border-left: 1px solid var(--ui-background);
    }
    .color-picker label {
        font-size: 12px;
        opacity: 0.8;
        white-space: nowrap;
    }
    .color-picker input[type="color"] {
        width: 56px;
        height: 32px;
        padding: 0;
        border: 2px solid var(--ui-background);
        border-radius: 6px;
        background: none;
        cursor: pointer;
    }
    /* Strip the native chrome so the swatch fills the control. */
    .color-picker input[type="color"]::-webkit-color-swatch-wrapper { padding: 2px; }
    .color-picker input[type="color"]::-webkit-color-swatch { border: none; border-radius: 3px; }

    .color-value {
        font-size: 10px;
        opacity: 0.6;
        text-transform: uppercase;
    }
    .rotate-hint {
        font-size: 10px;
        opacity: 0.6;
        font-weight: normal;
        text-transform: none;
    }
    .inline {
        display: flex;
        align-items: center;
        gap: .4rem;
        font-size: 13px;
        font-weight: normal;
    }
    .inline input[type="range"] { width: 90px; accent-color: var(--text-color); }
    .readout { font-variant-numeric: tabular-nums; }
    button.tiny { padding: .1rem .4rem; font-size: 13px; border-width: 2px; }

    .block-preview {
        display: block;
        width: 24px;
        height: 24px;
        margin-bottom: 2px;
    }
    .glyph { font-size: 22px; line-height: 24px; height: 24px; }

    #bottom-bar-options {
        border: 1px solid var(--ui-background);
        background-color: var(--ui-background-dark);
        display: flex;
        gap: .5rem;
        padding: .5rem;
        overflow-x: auto;
    }
    #bottom-bar-options button {
        min-width: 100px;
        max-width: 200px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        font-size: 14px;
        flex-shrink: 0;
    }

    /* Chrome and Safari. These are ignored the moment scrollbar-width or
       scrollbar-color is set on the same element, which is why the standard
       properties are quarantined in the @supports block below. */
    #bottom-bar-options::-webkit-scrollbar {
        height: 12px;
    }
    #bottom-bar-options::-webkit-scrollbar-track {
        background: rgba(0, 191, 255, 0.06);
        border-radius: 6px;
    }
    #bottom-bar-options::-webkit-scrollbar-thumb {
        background: var(--ui-background);
        border-radius: 6px;
        /* Transparent border plus content-box clipping insets the thumb without
           narrowing the track, so the hit area stays a comfortable 12px */
        border: 3px solid transparent;
        background-clip: content-box;
    }
    #bottom-bar-options::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 255, 64, 0.5);
        background-clip: content-box;
    }

    /* Firefox, which has no pseudo-elements to style */
    @supports not selector(::-webkit-scrollbar) {
        #bottom-bar-options {
            scrollbar-width: thin;
            scrollbar-color: rgba(0, 191, 255, 0.5) rgba(0, 191, 255, 0.06);
        }
    }

    #bottom-bar-right {
        border: 1px solid var(--ui-background);
        background-color: var(--ui-background);
        height: 100%;
    }
    #bottom-bar-selector {
        display: flex;
        flex-direction: column;
        padding: .5rem;
        gap: 10px;
    }
</style>
