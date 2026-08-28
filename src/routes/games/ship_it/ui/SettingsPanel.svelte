<script lang="ts">
    import {
        positionToRange,
        rangeToPosition,
        type SettingSpec,
        type SettingsSchema,
        type SettingValue,
        type SettingValues,
    } from "../settings/settings"

    interface Props {
        schema: SettingsSchema
        values: SettingValues
        /** Buttons are events, not values - they go straight to the scene. */
        onAction?: (name: string) => void
    }

    let { schema, values = $bindable(), onAction }: Props = $props()

    // Entries rather than the object, so declaration order is panel order
    let rows = $derived(Object.entries(schema))

    function num(key: string, fallback: number): number {
        const value = values[key]
        return typeof value === "number" ? value : fallback
    }

    function str(key: string, fallback: string): string {
        const value = values[key]
        return typeof value === "string" ? value : fallback
    }

    function bool(key: string, fallback: boolean): boolean {
        const value = values[key]
        return typeof value === "boolean" ? value : fallback
    }

    /**
     * A log slider carries a 0..1 position, not the value itself.
     *
     * On a linear track a 100..200000 range puts ninety per cent of the travel in
     * the top decade and the low end is unreachable with a mouse.
     */
    function setRange(key: string, spec: Extract<SettingSpec, { type: "range" }>, raw: number): void {
        values[key] = spec.scale === "log"
            ? positionToRange(spec.min, spec.max, spec.scale, raw, spec.step)
            : raw
    }

    function sliderPosition(spec: Extract<SettingSpec, { type: "range" }>, value: number): number {
        return spec.scale === "log" ? rangeToPosition(spec.min, spec.max, spec.scale, value) : value
    }

    /** The value a spec falls back to, or undefined for the kinds carrying none. */
    function defaultOf(spec: SettingSpec): SettingValue | undefined {
        if (spec.type === "separator" || spec.type === "button") return undefined
        return spec.default
    }

    /** True when this key has drifted from its schema default. */
    function isChanged(key: string, spec: SettingSpec): boolean {
        const fallback = defaultOf(spec)
        return fallback !== undefined && values[key] !== fallback
    }

    function reset(key: string, spec: SettingSpec): void {
        const fallback = defaultOf(spec)
        if (fallback !== undefined) values[key] = fallback
    }

    /** Inputs whose own double-click means "select what I just double-clicked". */
    const TEXT_ENTRY = new Set(["text", "number", "search"])

    /**
     * Double-click a row to put that setting back to its default.
     *
     * An action rather than an inline ondblclick for two reasons: the row is a
     * container rather than a control, so an inline handler on it is the kind of
     * thing the a11y checker rightly complains about; and the "don't hijack the
     * double-click that selects a word" rule below has to hold for every row,
     * which is one place here instead of three stopPropagation calls scattered
     * across the inputs that take typing.
     *
     * Mouse-only by nature, which is why every row also carries a real reset
     * button once its value differs from the default.
     */
    function resetOnDoubleClick(node: HTMLElement, onReset: () => void) {
        let callback = onReset

        const handler = (event: MouseEvent) => {
            const target = event.target
            if (target instanceof HTMLTextAreaElement) return
            if (target instanceof HTMLInputElement && TEXT_ENTRY.has(target.type)) return

            callback()
        }

        node.addEventListener("dblclick", handler)

        return {
            update: (next: () => void) => { callback = next },
            destroy: () => node.removeEventListener("dblclick", handler),
        }
    }

    /** Trailing zeros on an integer step read as false precision. */
    function readable(value: number, step?: number): string {
        if (step !== undefined && Number.isInteger(step)) return Math.round(value).toLocaleString()
        return value.toFixed(2)
    }
</script>

<!--
    The label, plus a reset button once the value has moved off its default.

    The button is the keyboard path to what double-clicking the row does with a
    mouse, and it doubles as the only marker saying which settings you have
    actually touched - which is the thing that makes the gesture discoverable.
-->
{#snippet settingLabel(key: string, spec: SettingSpec)}
    {spec.label}
    {#if isChanged(key, spec)}
        <button
            type="button"
            class="reset"
            title="Reset to default"
            aria-label="Reset {spec.label} to default"
            onclick={() => reset(key, spec)}
        >&#8635;</button>
    {/if}
{/snippet}

<div class="settings">
    {#each rows as [key, spec] (key)}
        {#if spec.type === "separator"}
            <p class="separator">{spec.label}</p>

        {:else if spec.type === "button"}
            <button class="action" onclick={() => onAction?.(key)}>{spec.label}</button>

        {:else if spec.type === "range"}
            <label class="row" use:resetOnDoubleClick={() => reset(key, spec)}>
                <span class="label">
                    <span>{@render settingLabel(key, spec)}</span>
                    <span class="value">{readable(num(key, spec.default), spec.step)}{spec.unit ?? ""}</span>
                </span>
                <input
                    type="range"
                    min={spec.scale === "log" ? 0 : spec.min}
                    max={spec.scale === "log" ? 1 : spec.max}
                    step={spec.scale === "log" ? 0.001 : (spec.step ?? 0.01)}
                    value={sliderPosition(spec, num(key, spec.default))}
                    oninput={(event) => setRange(key, spec, event.currentTarget.valueAsNumber)}
                />
            </label>

        {:else if spec.type === "number"}
            <label class="row" use:resetOnDoubleClick={() => reset(key, spec)}>
                <span class="label"><span>{@render settingLabel(key, spec)}</span><span class="value">{spec.unit ?? ""}</span></span>
                <input
                    type="number"
                    min={spec.min}
                    max={spec.max}
                    step={spec.step ?? 1}
                    value={num(key, spec.default)}
                    oninput={(event) => { values[key] = event.currentTarget.valueAsNumber }}
                />
            </label>

        {:else if spec.type === "checkbox"}
            <label class="row inline" use:resetOnDoubleClick={() => reset(key, spec)}>
                <input
                    type="checkbox"
                    checked={bool(key, spec.default)}
                    onchange={(event) => { values[key] = event.currentTarget.checked }}
                />
                <span class="label"><span>{@render settingLabel(key, spec)}</span></span>
            </label>

        {:else if spec.type === "selection"}
            <div class="row" use:resetOnDoubleClick={() => reset(key, spec)}>
                <span class="label"><span>{@render settingLabel(key, spec)}</span></span>
                {#if spec.display === "segmented"}
                    <div class="segments">
                        {#each spec.options as option (option)}
                            <button
                                class="segment"
                                class:on={str(key, spec.default) === option}
                                onclick={() => { values[key] = option }}
                            >{option}</button>
                        {/each}
                    </div>
                {:else}
                    <select
                        value={str(key, spec.default)}
                        onchange={(event) => { values[key] = event.currentTarget.value }}
                    >
                        {#each spec.options as option (option)}
                            <option value={option}>{option}</option>
                        {/each}
                    </select>
                {/if}
            </div>

        {:else if spec.type === "search"}
            <label class="row" use:resetOnDoubleClick={() => reset(key, spec)}>
                <span class="label"><span>{@render settingLabel(key, spec)}</span></span>
                <!-- A datalist rather than the filtered table V4 had: the options
                     are still all reachable, and a table needs SearchColumn support
                     that nothing in the project asks for yet -->
                <input
                    type="text"
                    list="{key}-options"
                    placeholder={spec.placeholder ?? ""}
                    value={str(key, spec.default)}
                    oninput={(event) => { values[key] = event.currentTarget.value }}
                />
                <datalist id="{key}-options">
                    {#each spec.options.slice(0, spec.limit ?? 50) as option (option)}
                        <option value={option}></option>
                    {/each}
                </datalist>
            </label>

        {:else if spec.type === "text"}
            <label class="row" use:resetOnDoubleClick={() => reset(key, spec)}>
                <span class="label"><span>{@render settingLabel(key, spec)}</span></span>
                {#if (spec.rows ?? 1) > 1}
                    <textarea
                        rows={spec.rows}
                        placeholder={spec.placeholder ?? ""}
                        value={str(key, spec.default)}
                        oninput={(event) => { values[key] = event.currentTarget.value }}
                    ></textarea>
                {:else}
                    <input
                        type="text"
                        placeholder={spec.placeholder ?? ""}
                        value={str(key, spec.default)}
                        oninput={(event) => { values[key] = event.currentTarget.value }}
                    />
                {/if}
            </label>

        {:else if spec.type === "color"}
            <label class="row inline" use:resetOnDoubleClick={() => reset(key, spec)}>
                <input
                    type="color"
                    value={str(key, spec.default)}
                    oninput={(event) => { values[key] = event.currentTarget.value }}
                />
                <span class="label"><span>{@render settingLabel(key, spec)}</span></span>
            </label>
        {/if}
    {/each}

    {#if rows.length > 0}
        <p class="hint">Double-click a setting to reset it</p>
    {/if}
</div>

<style>
    .settings {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
    }

    .row {
        display: block;
        color: #ffffff99;
    }
    .row.inline {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .label {
        display: flex;
        justify-content: space-between;
        gap: 8px;
    }

    .value {
        color: var(--accent);
        font-variant-numeric: tabular-nums;
    }

    input[type="range"] {
        width: 100%;
        accent-color: var(--accent);
    }

    input[type="number"],
    input[type="text"],
    select,
    textarea {
        width: 100%;
        background: #0b1116;
        color: #fff;
        border: 1px solid var(--line);
        border-radius: 3px;
        padding: 3px 5px;
        font: inherit;
    }

    input[type="checkbox"],
    input[type="color"] {
        accent-color: var(--accent);
    }

    .reset {
        background: none;
        border: none;
        padding: 0 2px;
        margin-left: 4px;
        font: inherit;
        line-height: 1;
        color: var(--accent);
        cursor: pointer;
        /* At rest this glyph is the only thing marking a setting as changed, so
           it reads as a marker until the pointer arrives and it reads as a button */
        opacity: 0.55;
    }
    .reset:hover {
        opacity: 1;
    }

    .hint {
        margin: 6px 0 0;
        color: #ffffff55;
    }

    .separator {
        margin: 8px 0 0;
        color: var(--accent);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        border-bottom: 1px solid var(--line);
    }

    .action,
    .segment {
        background: #0b1116;
        color: #fff;
        border: 1px solid var(--line);
        border-radius: 3px;
        padding: 3px 6px;
        font: inherit;
        cursor: pointer;
    }
    .action:hover,
    .segment:hover {
        background: #16212b;
    }

    .segments {
        display: flex;
        gap: 4px;
    }
    .segment.on {
        background: var(--accent);
        color: #06121b;
    }
</style>
