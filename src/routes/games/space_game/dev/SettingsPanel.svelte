<script lang="ts">
    import { positionToRange, rangeToPosition, type SettingsSchema, type SettingValue, type SettingValues, type SettingSpec } from "../settings/settings"

    let { schema, values = $bindable() }: {
        schema: SettingsSchema
        values: SettingValues
    } = $props()

    // Object key order is insertion order for string keys, so rows appear in the
    // order the scene declared them
    let entries = $derived(Object.entries(schema))

    // Replaces the object rather than mutating a key: the parent's
    // $effect(() => runner.setValues(values)) only re-runs on reassignment
    function set(key: string, value: SettingValue) {
        values = { ...values, [key]: value }
    }

    function press(key: string) {
        // Monotonic, so a scene sees a change even on the second click
        set(key, Number(values[key] ?? 0) + 1)
    }

    // Match the readout's precision to the step, so 0.1 + 0.2 does not show its seams
    function decimals(step: number | undefined): number {
        const text = String(step ?? 1)
        const dot = text.indexOf(".")
        return dot === -1 ? 0 : text.length - dot - 1
    }

    function reset(key: string, spec: SettingSpec) {
        // A button's value is a monotonic click counter, so "resetting" it back to 0
        // is itself a change and every scene watching would read it as another press
        if (spec.type === "separator" || spec.type === "button") return
        set(key, spec.default)
    }
</script>

<div class="settings">
    {#each entries as [key, spec] (key)}
        {#if spec.type === "range"}
            <label class="label" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            <input
                id={key}
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={rangeToPosition(spec.min, spec.max, spec.scale, Number(values[key] ?? spec.default))}
                oninput={(e) => set(key, positionToRange(spec.min, spec.max, spec.scale, e.currentTarget.valueAsNumber, spec.step))}
                ondblclick={() => reset(key, spec)}
            />
            <span class="readout">
                {Number(values[key] ?? spec.default).toFixed(decimals(spec.step))}{spec.unit ?? ""}
            </span>

        {:else if spec.type === "number"}
            <label class="label" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            <input
                id={key}
                class="wide"
                type="number"
                min={spec.min}
                max={spec.max}
                step={spec.step ?? 1}
                value={Number(values[key] ?? spec.default)}
                oninput={(e) => Number.isFinite(e.currentTarget.valueAsNumber) && set(key, e.currentTarget.valueAsNumber)}
            />

        {:else if spec.type === "color"}
            <label class="label" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            <input
                id={key}
                class="swatch"
                type="color"
                value={String(values[key] ?? spec.default)}
                oninput={(e) => set(key, e.currentTarget.value)}
            />
            <span class="readout">{String(values[key] ?? spec.default)}</span>

        {:else if spec.type === "button"}
            <button class="action full" type="button" onclick={() => press(key)}>{spec.label}</button>

        {:else if spec.type === "separator"}
            <span class="separator full">{spec.label}</span>

        {:else if spec.type === "selection" && spec.display === "segmented"}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="label" title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </span>
            <div class="segmented wide">
                {#each spec.options as option (option)}
                    <button
                        type="button"
                        class:active={String(values[key] ?? spec.default) === option}
                        onclick={() => set(key, option)}
                    >{option}</button>
                {/each}
            </div>
        {:else if spec.type === "checkbox"}
            <label class="label" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            <input
                id={key}
                class="wide"
                type="checkbox"
                checked={Boolean(values[key] ?? spec.default)}
                onchange={(e) => set(key, e.currentTarget.checked)}
            />
        {:else if spec.type === "selection"}
            <label class="label" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            <select
                id={key}
                class="wide"
                value={String(values[key] ?? spec.default)}
                onchange={(e) => set(key, e.currentTarget.value)}
            >
                {#each spec.options as option (option)}
                    <option value={option}>{option}</option>
                {/each}
            </select>
        {:else}
            <label class="label full" for={key} title="Double-click to reset" ondblclick={() => reset(key, spec)}>
                {spec.label}
            </label>
            {#if (spec.rows ?? 1) > 1}
                <!-- oninput not onchange: the scene should follow every keystroke
                     rather than waiting for the field to be blurred -->
                <textarea
                    id={key}
                    class="full"
                    rows={spec.rows}
                    placeholder={spec.placeholder ?? ""}
                    value={String(values[key] ?? spec.default)}
                    oninput={(e) => set(key, e.currentTarget.value)}
                ></textarea>
            {:else}
                <input
                    id={key}
                    class="full"
                    type="text"
                    placeholder={spec.placeholder ?? ""}
                    value={String(values[key] ?? spec.default)}
                    oninput={(e) => set(key, e.currentTarget.value)}
                />
            {/if}
        {/if}
    {/each}
</div>

<style>
    .settings {
        display: grid;
        grid-template-columns: 72px 1fr 44px;
        gap: 6px 10px;
        align-items: center;
        margin: 8px 0;
    }

    .label { color: #ffffff99; }
    .label[title] {
        cursor: pointer;
        user-select: none; /* or a double-click just highlights the word */
    }
    .label[title]:hover { color: #fff; }

    .readout {
        color: #0df;
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    /* A control with no readout takes the readout's column too */
    .wide { grid-column: 2 / span 2; }

    /* A sentence in a 1fr column next to its label is a scrolling keyhole */
    .full { grid-column: 1 / -1; }

    .separator {
        color: #ffffff55;
        text-transform: uppercase;
        letter-spacing: .08em;
        border-bottom: 1px solid #0df3;
        padding-bottom: 3px;
        margin-top: 4px;
    }

    .action,
    .segmented button {
        background: #0b1116;
        color: #fff;
        border: 1px solid #0df3;
        border-radius: 3px;
        padding: 3px 6px;
        font: inherit;
        cursor: pointer;
    }
    .action:hover,
    .segmented button:hover { border-color: #0df; }

    .segmented { display: flex; gap: 4px; }
    .segmented button { flex: 1; }
    .segmented button.active {
        background: #0df2;
        border-color: #0df;
        color: #0df;
    }

    .swatch {
        width: 100%;
        height: 20px;
        padding: 0;
        border: 1px solid #0df3;
        border-radius: 3px;
        background: none;
    }

    input[type="range"] { width: 100%; accent-color: #0df; }
    input[type="checkbox"] { accent-color: #0df; justify-self: start; }

    select,
    input[type="text"],
    textarea {
        width: 100%;
        background: #0b1116;
        color: #fff;
        border: 1px solid #0df3;
        border-radius: 3px;
        padding: 3px 5px;
        font: inherit;
    }
    textarea {
        /* Reserves the gutter whether or not the bar is showing, so typing past the
           last visible row does not reflow the text by 10px */
        scrollbar-gutter: stable;
        resize: vertical;
    }

    textarea::-webkit-scrollbar {
        width: 10px;
    }
    textarea::-webkit-scrollbar-track {
        background: transparent;
    }
    textarea::-webkit-scrollbar-thumb {
        background: #0df3;
        border-radius: 5px;
        border: 2px solid transparent;
        background-clip: content-box;
    }
    textarea::-webkit-scrollbar-thumb:hover {
        background: #0dfa;
        background-clip: content-box;
    }

    @supports not selector(::-webkit-scrollbar) {
        textarea {
            scrollbar-width: thin;
            scrollbar-color: #0df6 transparent;
        }
    }
</style>
