<script lang="ts">
    import { shapeSvgPath } from "../shapeSVG"
    import { layerFor, type Brush, type BrushTool } from "../grid/brush"
    import { DRAWN_SHAPES } from "../grid/palette"
    import { turnCount, type BlockShape } from "../grid/shapes"
    import { SHIP_LAYERS } from "../grid/layers"
    import {
        canPlace, componentById, componentsOfKind, kindOf, maxLevel, statsFor,
        type ComponentKind,
    } from "../grid/components"
    import { VIEW_LAYERS, type LayerView, type SelectedCell, type ShipInfo } from "../../dev/scenes/ship-builder"
    
    import circleFilledIconSRC from "../../assets/icons/SpaceGame-Circle_Filled.png"
    import circleHalfIconSRC from "../../assets/icons/SpaceGame-Circle_Half.png"
    import circleEmptyIconSRC from "../../assets/icons/SpaceGame-Circle_Empty.png"
    import screwDriverIconSRC from "../../assets/icons/SpaceGame-Screw_Driver.png"
    import eraserIconSRC from "../../assets/icons/SpaceGame-Eraser.png"
    import selectIconSRC from "../../assets/icons/SpaceGame-Select.png"
    import undoIconSRC from "../../assets/icons/SpaceGame-Undo.png"
    import clearLayerIconSRC from "../../assets/icons/SpaceGame-X.png"
    import clearAllIconSRC from "../../assets/icons/SpaceGame-Bomb.png"
    import arrowIconSRC from "../../assets/icons/SpaceGame-Arrow.png"
    import hullIconSRC from "../../assets/icons/SpaceGame-Hull.png"
    import thrusterIconSRC from "../../assets/icons/SpaceGame-Thruster.png"
    import storageIconSRC from "../../assets/icons/SpaceGame-Storage.png"
    import generatorIconSRC from "../../assets/icons/SpaceGame-Generator.png"
    import projectorIconSRC from "../../assets/icons/SpaceGame-Projector.png"
    import weaponIconSRC from "../../assets/icons/SpaceGame-Weapon.png"


    /**
     * The builder's whole interface.
     *
     * Owns nothing but which panel is showing. `brush`, `shipInfo` and `selected`
     * are the scene's, rendered here; every control asks for a change and waits
     * to be told what happened, so there is no local copy to fall out of step.
     */
    let { brush, palette = [], shipInfo = null, selected = null, notice = null, layerView = null, onPatch, onAction, onUpgrade, onSteering, onHighlight, onLayerView }: {
        brush: Brush
        /** Hex colors currently used in the ship, published by the scene. */
        palette?: string[]
        shipInfo?: ShipInfo | null
        /** The block last clicked, or null when that cell is empty. */
        selected?: SelectedCell | null
        notice?: string | null
        /** How much of each layer the scene draws. Null until it has published. */
        layerView?: Record<string, LayerView> | null
        onPatch: (patch: Partial<Brush>) => void
        onAction: (name: string) => void
        onUpgrade: (delta: number) => void
        /** Hex to box on the ship, or null to clear. */
        onHighlight: (hex: string | null) => void
        onLayerView: (patch: Record<string, LayerView>) => void
        /** Flips whether the selected thruster is used for turning. */
        onSteering: (steering: boolean) => void
    } = $props()

    /** What each control does, in the words someone who has not read the code would use. */
    const TIPS: Record<string, string> = {
        build: "Place the selected block",
        destroy: "Remove blocks. Refuses anything the ship needs",
        select: "Inspect a block without changing it",
        undo: "Undo the last stroke",
        redo: "Redo the last undone stroke",
        clear: "Empty the current layer",
        clearAll: "Empty every layer",
        upload: "Load a ship from a file",
        download: "Save this ship to a file",
    }

    /** The type under the cursor right now, which outranks everything else. */
    let hoveredType = $state<string | null>(null)

    /** The category the brush is holding, which is what the picker highlights. */
    let brushKind = $derived(kindOf(brush.type))

    /** True while the brush places a machine rather than plain structure. */
    let placingComponent = $derived(brushKind !== "hull")

    /** The models available under the brush's category. */
    let types = $derived(componentsOfKind(brushKind))

    /**
     * The one tooltip for the whole panel, placed from the hovered control's rect.
     *
     * A ::after on the button itself is less code but unusable here: every panel
     * sets `overflow: hidden`, and the ones that matter also carry a `transform`,
     * which makes them the containing block even for `position: fixed`. The tip
     * was being drawn inside the toolbar and clipped away. This element lives
     * outside every panel, so nothing can cut it off.
     *
     * Delegated from one listener rather than a handler per button, so adding
     * `data-tip` to a new control is all anyone has to remember.
     */
    let tip = $state<{ text: string; x: number; y: number; below: boolean } | null>(null)

    /**
     * What the accent picker shows before one has been chosen.
     *
     * The brush stores "" for "leave the art alone", which an <input type="color">
     * cannot display - it needs some hex, and this one is only ever a starting
     * point for the first drag of the slider.
     */
    const DEFAULT_ACCENT_SWATCH = "#ffb347"

    /** Enough room for a two-line tip; below that it flips above the control. */
    const TIP_ROOM = 70

    function trackTip(event: Event) {
        const found = (event.target as HTMLElement | null)?.closest?.("[data-tip]")
        const text = found instanceof HTMLElement ? found.dataset.tip : null

        if (!found || !text) {
            tip = null
            return
        }

        const rect = found.getBoundingClientRect()
        const below = rect.bottom + TIP_ROOM < window.innerHeight

        tip = {
            text,
            x: rect.left + rect.width / 2,
            y: below ? rect.bottom + 8 : rect.top - 8,
            below,
        }
    }

    /** What each visibility state does when clicked, and what it looks like. */
    const NEXT_VIEW: Record<LayerView, LayerView> = {
        full: "dim",
        dim: "hidden",
        hidden: "full",
    }

    /** The icon each state wears, so the button says what it is without a label. */
    const VIEW_ICON: Record<LayerView, string> = {
        full: circleFilledIconSRC,
        dim: circleHalfIconSRC,
        hidden: circleEmptyIconSRC,
    }

    const VIEW_TIP: Record<LayerView, string> = {
        full: "Visible. Click to dim to 15%",
        dim: "Dimmed to 15%. Click to hide",
        hidden: "Hidden. Click to show",
    }

    /** A layer's view, defaulting to full for the frames before the scene publishes. */
    function viewOf(layer: string): LayerView {
        return layerView?.[layer] ?? "full"
    }

    function cycleView(layer: string) {
        onLayerView({ [layer]: NEXT_VIEW[viewOf(layer)] })
    }

    /** Which destructive button is armed, if any. */
    let confirming = $state<string | null>(null)

    /**
     * What the bottom of the info panel talks about.
     *
     * Hover wins, then a block you clicked, then the component the brush is
     * holding - so picking a thruster leaves its stats on screen rather than
     * flashing them for only as long as the pointer rests on the button.
     */
    let describing = $derived(
        hoveredType ?? (selected ? null : placingComponent ? brush.type : null),
    )

    /** Requested, not applied. The scene decides, publishes, and this rerenders. */
    function set(patch: Partial<Brush>) {
        onPatch(patch)
    }

    /**
     * Switches tool, putting the brush back on a layer it can build on.
     *
     * Destroy and select reach every layer, so either can leave the brush on one
     * its type is not allowed to build on. Coming back to build without fixing
     * that is what shows a layer as selected and disabled at once.
     */
    function selectTool(tool: BrushTool) {
        set(tool === "build" ? { tool, layer: layerFor(brush.type, brush.layer) } : { tool })
    }

    /**
     * True while the brush would actually place what the pickers are showing.
     *
     * Erase and select act on blocks already down, so highlighting a shape or a
     * placement during either would advertise a choice that changes nothing.
     */
    let picking = $derived(brush.tool === "build")

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
        // brush sits on erase would otherwise light nothing up and do nothing.
        // The layer comes along for the same reason it does in selectTool - erase
        // may have left the brush somewhere it cannot build.
        set({ shape, turns: carried, tool: "build", layer: layerFor(brush.type, brush.layer) })
    }

    /** The model a category offers first, which is what its button selects. */
    function firstTypeOf(kind: ComponentKind): string {
        return componentsOfKind(kind)[0]?.id ?? brush.type
    }

    /**
     * Picks a component to place.
     *
     * Also switches to paint and to a layer the type is allowed on: choosing a
     * thruster while the brush sits on "erase" and the cosmetic layer meant three
     * more clicks before anything could happen, and every one of them was the
     * only possible answer.
     */
    function selectType(type: string) {
        const layers = SHIP_LAYERS.filter((layer) => canPlace(type, layer))
        const layer = layers.includes(brush.layer) ? brush.layer : layers[0] ?? brush.layer

        set({
            type,
            layer,
            level: Math.min(brush.level, maxLevel(type)),
            tool: brush.tool === "build" ? brush.tool : "build",
        })
    }

    /**
     * Picks a category, keeping the model if the brush already holds one of them.
     *
     * Clicking STORAGE while a battery is in hand must not silently swap it for a
     * crate - the category button is how you get to the tray, not a reset.
     */
    function selectKind(kind: ComponentKind) {
        selectType(brushKind === kind ? brush.type : firstTypeOf(kind))
    }

    /**
     * First click arms, second fires.
     *
     * In-panel rather than window.confirm: it matches the rest of the UI, it does
     * not block the render loop, and it is testable.
     */
    function armOrRun(name: string) {
        if (confirming !== name) {
            confirming = name
            return
        }

        confirming = null
        onAction(name)
    }

    // An armed button that stays armed is a trap: come back in a minute and a
    // single click wipes the ship
    $effect(() => {
        if (confirming === null) return

        const timer = setTimeout(() => (confirming = null), 3000)
        return () => clearTimeout(timer)
    })

    /** 1..max for a type, which is how far it upgrades. */
    function levelsOf(type: string): number[] {
        return Array.from({ length: maxLevel(type) }, (_, index) => index + 1)
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

<!-- mouseover/mouseout rather than enter/leave, and focusin/focusout rather than
     focus/blur: only the bubbling pairs reach one listener here, and the focus
     pair is what gives a keyboard the same tips a mouse gets.

     The a11y rule wants the literal onfocus/onblur beside the mouse handlers. It
     is asking for the right thing and getting the name wrong: focus and blur do
     not bubble, so on this container they would never fire for the buttons
     inside, and focusin/focusout already cover the keyboard the rule is
     protecting. -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<div
    id="build-ui"
    onmouseover={trackTip}
    onmouseout={() => (tip = null)}
    onfocusin={trackTip}
    onfocusout={() => (tip = null)}
    role="presentation"
>
    <!-- Outside every panel, so no panel's overflow can clip it -->
    {#if tip}
        <div
            id="tip"
            style={`left: ${tip.x}px; top: ${tip.y}px; transform: translateX(-50%) ${tip.below ? "" : "translateY(-100%)"}`}
        >
            {tip.text}
        </div>
    {/if}

    <!-- Over the canvas, where the eye already is. A refusal in a corner panel is
         a refusal nobody reads -->
    {#if notice}
        <div id="notice" role="status">{notice}</div>
    {/if}

    <div id="top-panel" class="panel">
        <div class="group">
            <button class={`icon-button ${brush.tool === "build" ? "active" : ""}`} onclick={() => selectTool("build")} data-tip={TIPS.build}>
                <img class="image-icon" src={screwDriverIconSRC} alt="screw-driver.png">
                BUILD
            </button>
            <button class={`icon-button ${brush.tool === "destroy" ? "active" : ""}`} onclick={() => selectTool("destroy")} data-tip={TIPS.destroy}>
                <img class="image-icon" src={eraserIconSRC} alt="eraser.png">
                DESTROY
            </button>
            <button class={`icon-button ${brush.tool === "select" ? "active" : ""}`} onclick={() => selectTool("select")} data-tip={TIPS.select}>
                <img class="image-icon" src={selectIconSRC} alt="select.png">
                SELECT
            </button>
        </div>

        <span class="divider"></span>

        <div class="group">
            <button class="icon-button" onclick={() => onAction("undo")} data-tip={TIPS.undo}>
                <img class="image-icon" src={undoIconSRC} alt="undo.png">
                UNDO
            </button>
            <button class="icon-button" onclick={() => onAction("redo")} data-tip={TIPS.redo}>
                <img class="image-icon" src={undoIconSRC} style="transform: scaleX(-1)" alt="redo.png">
                REDO
            </button>
            <button
                class={`icon-button ${confirming === "clear" ? "arming" : ""}`}
                onclick={() => armOrRun("clear")}
                data-tip={TIPS.clear}
            >
                <img class="image-icon" src={clearLayerIconSRC} alt="clear.png">
                {confirming === "clear" ? "YOU SURE?" : "CLEAR"}
            </button>
            <button
                class={`icon-button ${confirming === "clearAll" ? "arming" : ""}`}
                onclick={() => armOrRun("clearAll")}
                data-tip={TIPS.clearAll}
            >
                <img class="image-icon" src={clearAllIconSRC} alt="bomb.png">
                {confirming === "clearAll" ? "YOU SURE?" : "CLEAR ALL"}
            </button>
        </div>

        <span class="divider"></span>

        <div class="group">
            <button class="icon-button" onclick={() => onAction("upload")} data-tip={TIPS.upload}>
                <img class="image-icon" src={arrowIconSRC} alt="redo.png">
                UPLOAD
            </button>
            <button class="icon-button" onclick={() => onAction("download")} data-tip={TIPS.download}>
                <img class="image-icon" src={arrowIconSRC} style="transform: scaleY(-1)" alt="redo.png">
                DOWNLOAD
            </button>
        </div>
    </div>

    <div id="draw-panel" class="panel">
        <div class="heading">COMPONENTS</div>
        <div id="placements">
            <button 
                class={`icon-button ${picking && brushKind === "hull" ? "active" : ""}`} 
                onclick={() => selectKind("hull")}
                onmouseenter={() => (hoveredType = firstTypeOf("hull"))}
                onmouseleave={() => (hoveredType = null)}
                title={"hull"}
                aria-label={"hull"}
            >
                <img class="image-icon" src={hullIconSRC} alt="hull.png">
                HULL
            </button>
            <button 
                class={`icon-button ${picking && brushKind === "storage" ? "active" : ""}`} 
                onclick={() => selectKind("storage")}
                onmouseenter={() => (hoveredType = firstTypeOf("storage"))}
                onmouseleave={() => (hoveredType = null)}
                title={"storage"}
                aria-label={"storage"}
            >
                <img class="image-icon" src={storageIconSRC} alt="storage.png">
                STORAGE
            </button>
            <button 
                class={`icon-button ${picking && brushKind === "thruster" ? "active" : ""}`} 
                onclick={() => selectKind("thruster")}
                onmouseenter={() => (hoveredType = firstTypeOf("thruster"))}
                onmouseleave={() => (hoveredType = null)}
                title={"thruster"}
                aria-label={"thruster"}
            >
                <img class="image-icon" src={thrusterIconSRC} alt="thruster.png">
                THRUSTER
            </button>
            <button 
                class={`icon-button ${picking && brushKind === "generator" ? "active" : ""}`} 
                onclick={() => selectKind("generator")}
                onmouseenter={() => (hoveredType = firstTypeOf("generator"))}
                onmouseleave={() => (hoveredType = null)}
                title={"generator"}
                aria-label={"generator"}
            >
                <img class="image-icon" src={generatorIconSRC} alt="generator.png">
                GENERATOR
            </button>
            <button 
                class={`icon-button ${picking && brushKind === "weapon" ? "active" : ""}`} 
                onclick={() => selectKind("weapon")}
                onmouseenter={() => (hoveredType = firstTypeOf("weapon"))}
                onmouseleave={() => (hoveredType = null)}
                title={"weapon"}
                aria-label={"weapon"}
            >
                <img class="image-icon" src={weaponIconSRC} alt="weapon.png">
                WEAPON
            </button>
            <button 
                class={`icon-button ${picking && brushKind === "projector" ? "active" : ""}`} 
                onclick={() => selectKind("projector")}
                onmouseenter={() => (hoveredType = firstTypeOf("projector"))}
                onmouseleave={() => (hoveredType = null)}
                title={"projector"}
                aria-label={"projector"}
            >
                <img class="image-icon" src={projectorIconSRC} alt="projector.png">
                PROJECTOR
            </button>
        </div>

        <!-- Only shown when there is a choice to make: a category with one model
             is already named by the heading below, and a tray of one is noise -->
        {#if types.length > 1}
            <div class="heading">MODEL</div>
            <div id="types">
                {#each types as type (type.id)}
                    <button
                        class={`type-row ${picking && brush.type === type.id ? "active" : ""}`}
                        onclick={() => selectType(type.id)}
                        onmouseenter={() => (hoveredType = type.id)}
                        onmouseleave={() => (hoveredType = null)}
                        title={type.name}
                    >
                        {type.name}
                    </button>
                {/each}
            </div>
        {/if}

        <!-- Only a machine has grades to choose between; structure has shapes,
             and those live in the tray along the bottom -->
        {#if placingComponent}
            <div class="heading">{componentById(brush.type).name.toUpperCase()}</div>
            <div id="levels">
                {#each levelsOf(brush.type) as level (level)}
                    <button
                        class={`level-swatch ${brush.level === level ? "active" : ""}`}
                        onclick={() => set({ level })}
                        onmouseenter={() => (hoveredType = brush.type)}
                        onmouseleave={() => (hoveredType = null)}
                    >
                        <span class="roman">L{level}</span>
                        <span class="sub">{statsFor(brush.type, level).hitPoints}hp</span>
                    </button>
                {/each}
            </div>
        {/if}
        <div class="heading">{placingComponent ? "MAIN COLOR" : "COLOR"}</div>
        <input
            id="build-color"
            type="color"
            value={brush.color}
            oninput={(e) => set({ color: e.currentTarget.value })}
        />

        <!-- Only components have an accent: hull art is one colour, and offering a
             second picker there would imply something the block cannot do -->
        {#if placingComponent}
            <div class="heading">ACCENT</div>
            <input
                id="build-accent"
                type="color"
                value={brush.accentColor === "" ? DEFAULT_ACCENT_SWATCH : brush.accentColor}
                oninput={(e) => set({ accentColor: e.currentTarget.value })}
            />
            <button
                class="accent-reset"
                onclick={() => set({ accentColor: "" })}
                disabled={brush.accentColor === ""}
                data-tip="Use the colour the art was drawn with"
            >
                {brush.accentColor === "" ? "using art's accent" : "reset to art"}
            </button>
        {/if}

        <div class="heading">EMISSION</div>
        <div class="slider-row">
            <input
                type="range" min="0" max="1" step="0.05"
                value={brush.emission}
                oninput={(e) => set({ emission: e.currentTarget.valueAsNumber })}
            />
            <span class="slider-value">{brush.emission.toFixed(2)}</span>
        </div>
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
            {#each VIEW_LAYERS as layer (layer)}
                {@const isShipLayer = layer !== "markers"}
                <!-- Disabled rather than hidden: the count is still worth reading,
                     and a row vanishing as you switch types is disorienting -->
                <div class="layer-line">
                    <!-- Its own button, not part of the row: hiding a layer and
                         building on it are different intentions, and one must not
                         be a side effect of the other -->
                    <button
                        class={`eye ${viewOf(layer) === "hidden" ? "off" : ""}`}
                        onclick={() => cycleView(layer)}
                        data-tip={VIEW_TIP[viewOf(layer)]}
                        aria-label={`${layer} visibility`}
                    >
                        <img class="eye-icon" src={VIEW_ICON[viewOf(layer)]} alt="">
                    </button>

                    {#if isShipLayer}
                        <button
                            class={`layer-row ${brush.layer === layer ? "active" : ""}`}
                            onclick={() => set({ layer })}
                            disabled={picking && !canPlace(brush.type, layer)}
                            data-tip={!picking
                                ? `${brush.tool === "destroy" ? "Erase" : "Inspect"} on the ${layer} layer`
                                : canPlace(brush.type, layer)
                                    ? `Build on the ${layer} layer`
                                    : `${componentById(brush.type).name} cannot go on ${layer}`}
                        >
                            <span>{layer}</span>
                            <span class="count">{shipInfo?.perLayer[layer] ?? 0}</span>
                        </button>
                    {:else}
                        <!-- Not a button: nothing is stored in this layer, so there
                             is nothing to select and nothing to build on -->
                        <span class="layer-row static-row">markers</span>
                    {/if}
                </div>
            {/each}
        </div>

        <!-- A hovered type wins over the selection: you are asking about the thing
             under the cursor right now, not the thing you clicked a minute ago -->
        {#if describing}
            {@const stats = statsFor(describing, brush.level)}
            <div class="heading">{componentById(describing).name.toUpperCase()} L{brush.level}</div>
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
                <dt>type</dt><dd>{selected.typeName}</dd>
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

            {#if kindOf(selected.type) === "thruster"}
                <!-- Q and E fire only these. A main drive mounted off center is
                     still allowed to be one - it will just turn the ship hard. -->
                <div id="steer-row">
                    <span class="level">steering</span>
                    <button
                        class={selected.steering ? "active" : ""}
                        onclick={() => onSteering(!selected.steering)}
                        data-tip={selected.steering
                            ? "Turns the ship on Q/E. Click to stop using it to turn"
                            : "Thrust only. Click to steer with it"}
                    >{selected.steering ? "ON" : "OFF"}</button>
                </div>
            {/if}
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
                <!--<span class="component-name">{shape}</span>-->
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
        font-family: "Jost", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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
        border-block: 1px solid var(--ui-separator);
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

    .icon-button {
        /* An explicit column, not a label left to wrap past an inline icon: a
           short label like HULL fits beside a 40px icon in a wider font, so that
           one button would lay itself out differently from all its neighbours */
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;

        width: 85px;
        height: 85px;
        padding: 3px;
        color: white;
        font-weight: bold;
        font-size: 12px;
        border-radius: 0;
        margin: 0;
    }
    .image-icon {
        /* Must be a factor of 16 */
        width: 48px;
        height: 48px;
        margin-bottom: 5px;
        image-rendering: pixelated;
    }

    /*~~~ Left: colour, shapes or levels, palette ~~~*/
    #draw-panel {
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        max-height: 74vh;
        overflow-y: auto;
    }

    #build-color,
    #build-accent {
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
    #build-color::-webkit-color-swatch-wrapper,
    #build-accent::-webkit-color-swatch-wrapper { padding: 2px; }
    #build-color::-webkit-color-swatch,
    #build-accent::-webkit-color-swatch { border: none; border-radius: 3px; }

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

    .shape-swatch {
        border: 1px solid var(--ui-separator);
        border-radius: 0;
        width: 100%;
        margin: 0;
        aspect-ratio: 1 / 1;
        background: transparent;
    }
    .shape-swatch:hover { background: rgba(0, 191, 255, 0.2); }
    .shape-swatch.active { background: rgba(0, 255, 64, 0.22); }
    .shape-svg { width: 100%; height: 100%; display: block; aspect-ratio: 1/1; padding: 0;}

    /* The bottom tray runs sideways, so its swatches are fixed-width columns with
       a name under the art rather than cells in a grid */
    .shape-swatch.wide {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        width: 50px;
        flex-shrink: 0;
        aspect-ratio: auto;
        border-radius: 5px;
        aspect-ratio: 1/1
    }
    .shape-swatch.wide .shape-svg { width: 30px; height: 30px; padding: 0;}

    /* Two across, same square cells as the shapes had - a placement is picked the
       same way a shape is, and the column is only wide enough for two */
    #placements { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px}
    .placement-swatch {
        border: 1px solid var(--ui-separator);
        border-radius: 0;
        width: 100%;
        margin: 0;
        aspect-ratio: 1 / 1;
        padding: 0;
        background: transparent;
    }
    .placement-swatch:hover { background: rgba(0, 191, 255, 0.2); }
    .placement-swatch.active { background: rgba(0, 255, 64, 0.22); }

    /* Stacked and full width, like the layer rows: a model is picked by its
       name, and names do not fit in a swatch */
    #types { display: flex; flex-direction: column; }
    .type-row {
        border-radius: 0;
        border: 1px solid var(--ui-separator);
        background: transparent;
        font-size: 12px;
        text-align: left;
        padding: .3rem .5rem;
    }
    .type-row:hover { background: rgba(0, 191, 255, 0.2); }

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

    .accent-reset {
        display: block;
        width: calc(100% - 12px);
        margin: 0 6px 6px;
        padding: .25rem;
        font-size: 10px;
        background: transparent;
        border: 1px solid var(--ui-separator);
        border-radius: 4px;
    }
    .accent-reset:hover:not(:disabled) { background: rgba(0, 191, 255, 0.2); }
    .accent-reset:disabled { opacity: .45; cursor: default; }

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

    #level-row, #steer-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 6px 8px;
    }
    #level-row button, #steer-row button { padding: .1rem .55rem; }
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
    .component-swatch .shape-svg { width: 32px; height: 32px; padding: 0;}
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

        #notice {
        position: absolute;
        top: 120px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: bold;
        color: #ffd0d0;
        background: rgba(60, 8, 8, 0.9);
        border: 2px solid rgba(255, 90, 90, 0.75);
        border-radius: 6px;
        z-index: 5;
    }

    .icon-button.arming {
        background-color: rgba(255, 90, 90, 0.3);
        border-color: rgba(255, 90, 90, 0.8);
        color: #ffd0d0;
    }

    /* A styled tooltip rather than `title`: the native one waits about a second
       and cannot be themed, which on a toolbar this dense means you hover, wait,
       and give up before it appears.

       Fixed and positioned from script, because every panel clips its overflow
       and the important ones are also a containing block for fixed children -
       a pseudo-element on the button had nowhere to go but inside the bar. */
    #tip {
        position: fixed;
        z-index: 100;
        width: max-content;
        max-width: 190px;
        padding: 5px 8px;
        font-size: 11px;
        font-weight: normal;
        line-height: 1.35;
        text-align: center;
        color: var(--text-color);
        background: var(--ui-background-dark);
        border: 1px solid var(--ui-border);
        border-radius: 4px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
        pointer-events: none;
    }

    /* One row per layer: the eye acts on what is drawn, the row on what is built */
    .layer-line { display: flex; align-items: stretch; }
    .layer-line .layer-row { flex: 1; }

    /* The markers row, which only its eye can act on. Styled to match the others
       so the column still reads as one list, but plainly not clickable */
    .static-row {
        display: flex;
        align-items: center;
        font-size: 12px;
        font-weight: bold;
        padding: .3rem .5rem;
        opacity: .7;
        cursor: default;
    }

    .eye {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        padding: 0;
        border-radius: 0;
        border: 1px solid var(--ui-separator);
        background: transparent;
    }
    .eye:hover { background: rgba(0, 191, 255, 0.2); }
    .eye.off { opacity: .45; }

    .eye-icon {
        width: 16px;
        height: 16px;
        image-rendering: pixelated;
    }

    /* Firefox, which has no pseudo-elements to style */
    @supports not selector(::-webkit-scrollbar) {
        .panel {
            scrollbar-width: thin;
            scrollbar-color: var(--ui-background) transparent;
        }
    }
</style>
