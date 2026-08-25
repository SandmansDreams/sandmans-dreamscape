// Every action the game can be asked for, and the keys that ask by default

/**
 * Which surface an action belongs to.
 *
 * A context is what makes rebinding tractable. `KeyW` can mean thrust while
 * flying and step-a-layer in the builder without either being a clash, because
 * only one scene context is ever active alongside `global` - so two actions only
 * conflict when they could fire in the same breath.
 *
 * `global` is the exception that is always live: it is for things that must work
 * whatever is on screen, which today is the dev panel and nothing else.
 */
export const INPUT_CONTEXTS = ["global", "flight", "builder", "sprite", "viewer"] as const
export type InputContext = (typeof INPUT_CONTEXTS)[number]

/**
 * A held key that changes what another key means.
 *
 * Only ctrl, because that is the one that turns a letter into a command. Shift
 * and alt are left alone deliberately: an action that required "no shift" would
 * stop mid-burn the moment a pilot leaned on it.
 */
export type Modifier = "ctrl"

export interface ActionSpec {
    /** Shown in a rebinding panel, so write it for a player and not for a log. */
    label: string
    context: InputContext
    /**
     * Physical key codes - `event.code`, never `event.key`.
     *
     * Several codes are alternative bindings, not a chord: any one of them fires
     * the action. That is what lets a rebinding keep a default alive beside a
     * new key rather than replacing it.
     */
    keys: readonly string[]
    /**
     * Suppress the browser default while this action's context is active.
     *
     * Opt-in, because the browser default is usually the right one: arrows scroll
     * the page and space scrolls it further, but swallowing every bound key would
     * cost refresh and devtools for the sake of tidiness.
     */
    capture?: boolean
    /**
     * Modifiers that must be held for this to fire.
     *
     * An action that names none also refuses to fire while ctrl is down, so
     * ctrl+Z is undo and not undo-and-whatever-Z-does. Meta counts as ctrl here:
     * on a Mac the same shortcut is written with command, and a builder should
     * not have to learn otherwise.
     */
    mods?: readonly Modifier[]
}

/**
 * The catalogue. One entry per thing a player can ask for.
 *
 * Ids are dotted so a conflict message or a log line names itself, and the
 * context is stated rather than parsed out of the id - the prefix is for humans
 * reading the id, `context` is what the code branches on.
 *
 * `as const satisfies` is load-bearing the same way it is for a settings schema:
 * it shape-checks every entry without widening the keys, which is what makes
 * `ActionId` a union of real ids instead of `string`.
 */
export const ACTIONS = {
    /*~~~ Always live ~~~*/
    "global.devPanel": {
        label: "Toggle dev panel",
        context: "global",
        keys: ["Backquote"],
    },

    /*~~~ Flying ~~~*/
    "flight.thrustForward": { label: "Thrust forward", context: "flight", keys: ["KeyW"] },
    "flight.thrustBack":    { label: "Thrust back", context: "flight", keys: ["KeyS"] },
    "flight.strafeLeft":    { label: "Thrust left", context: "flight", keys: ["KeyA"] },
    "flight.strafeRight":   { label: "Thrust right", context: "flight", keys: ["KeyD"] },
    "flight.turnLeft":      { label: "Turn left", context: "flight", keys: ["KeyQ"] },
    "flight.turnRight":     { label: "Turn right", context: "flight", keys: ["KeyE"] },
    "flight.toggleAssist":  { label: "Toggle flight assist", context: "flight", keys: ["KeyZ"], capture: true },

    /*~~~ Building a ship ~~~*/
    // Declaration order is what the builder's key guide lists, so the ones someone
    // reaches for first are declared first: pick a tool, pick a part, then the
    // adjustments, then undo
    "builder.toolBuild":   { label: "Build tool", context: "builder", keys: ["KeyB"] },
    "builder.toolDestroy": { label: "Destroy tool", context: "builder", keys: ["KeyD"] },
    "builder.toolSelect":  { label: "Select tool", context: "builder", keys: ["KeyS"] },

    // One per category, on its own first letter. They happen not to collide -
    // hull, thruster, cargo, generator, projector, weapon - which is luck worth
    // spending rather than inventing a scheme nobody would remember
    "builder.pickHull":      { label: "Pick hull", context: "builder", keys: ["KeyH"] },
    "builder.pickThruster":  { label: "Pick thruster", context: "builder", keys: ["KeyT"] },
    "builder.pickCargo":     { label: "Pick cargo", context: "builder", keys: ["KeyC"] },
    "builder.pickGenerator": { label: "Pick generator", context: "builder", keys: ["KeyG"] },
    "builder.pickProjector": { label: "Pick projector", context: "builder", keys: ["KeyP"] },
    "builder.pickWeapon":    { label: "Pick weapon", context: "builder", keys: ["KeyW"] },
    // Rotate is one action even though it means two things: a component turns its
    // facing and structure turns its art, and which one is a property of the brush
    // rather than of the key
    "builder.rotate":     { label: "Rotate block", context: "builder", keys: ["KeyR"] },
    "builder.mirror":     { label: "Mirror block", context: "builder", keys: ["KeyM"] },
    "builder.cycleLevel": { label: "Next level", context: "builder", keys: ["KeyL"] },
    "builder.prevShape":  { label: "Previous shape", context: "builder", keys: ["ArrowLeft"], capture: true },
    "builder.nextShape":  { label: "Next shape", context: "builder", keys: ["ArrowRight"], capture: true },
    "builder.layerUp":    { label: "Layer up", context: "builder", keys: ["ArrowUp"], capture: true },
    "builder.layerDown":  { label: "Layer down", context: "builder", keys: ["ArrowDown"], capture: true },

    "builder.undo": {
        label: "Undo", context: "builder", keys: ["KeyZ"], mods: ["ctrl"], capture: true,
    },
    "builder.redo": {
        label: "Redo", context: "builder", keys: ["KeyY"], mods: ["ctrl"], capture: true,
    },

    /*~~~ Drawing component art ~~~*/
    "sprite.toolBuild":   { label: "Build tool", context: "sprite", keys: ["KeyB"] },
    "sprite.toolDestroy": { label: "Destroy tool", context: "sprite", keys: ["KeyD"] },

    "sprite.rotate":     { label: "Rotate shape", context: "sprite", keys: ["KeyR"] },
    "sprite.mirror":     { label: "Mirror shape", context: "sprite", keys: ["KeyM"] },
    "sprite.cycleLayer": { label: "Next art layer", context: "sprite", keys: ["KeyL"] },
    "sprite.prevShape":  { label: "Previous shape", context: "sprite", keys: ["ArrowLeft"], capture: true },
    "sprite.nextShape":  { label: "Next shape", context: "sprite", keys: ["ArrowRight"], capture: true },
    "sprite.prevRole":   { label: "Previous role", context: "sprite", keys: ["ArrowUp"], capture: true },
    "sprite.nextRole":   { label: "Next role", context: "sprite", keys: ["ArrowDown"], capture: true },

    "sprite.undo": {
        label: "Undo", context: "sprite", keys: ["KeyZ"], mods: ["ctrl"], capture: true,
    },
    "sprite.redo": {
        label: "Redo", context: "sprite", keys: ["KeyY"], mods: ["ctrl"], capture: true,
    },
} as const satisfies Record<string, ActionSpec>

export type ActionId = keyof typeof ACTIONS

/** Every id in the catalogue. Declaration order, which is the order a panel lists. */
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[]

/**
 * A key code as a player would write it: "KeyR" reads "R", "ArrowUp" reads "Up".
 *
 * For a guide or a rebinding panel. Codes are physical and spelled for the
 * machine; nobody wants to read "Backquote" on a card telling them what to press.
 */
export function keyLabel(code: string): string {
    if (code.startsWith("Key")) return code.slice(3)
    if (code.startsWith("Digit")) return code.slice(5)
    if (code.startsWith("Arrow")) return code.slice(5)

    const named: Record<string, string> = {
        Backquote: "`",
        ControlLeft: "Ctrl",
        ControlRight: "Ctrl",
        MetaLeft: "Cmd",
        MetaRight: "Cmd",
        Space: "Space",
    }

    return named[code] ?? code
}

/** What to press for an action, modifiers included: "Ctrl+Z", "Left / Right". */
export function keysFor(action: ActionId, codes: readonly string[]): string {
    const prefix = specOf(action).mods?.includes("ctrl") ? "Ctrl+" : ""
    return codes.map((code) => prefix + keyLabel(code)).join(" / ")
}

export function specOf(action: ActionId): ActionSpec {
    return ACTIONS[action]
}

/** True when this id names a real action. The guard a stored binding needs. */
export function isActionId(value: unknown): value is ActionId {
    return typeof value === "string" && value in ACTIONS
}

/** The actions of one context, for a rebinding panel and for conflict checks. */
export function actionsIn(context: InputContext): ActionId[] {
    return ACTION_IDS.filter((id) => ACTIONS[id].context === context)
}
