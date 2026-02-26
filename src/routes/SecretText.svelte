<script lang="ts">
    import { onMount, onDestroy } from "svelte"

    export let text = "Hover Me"
    export let interval: number | null = null
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()"
    
    let displayText = text
    let isHovering = false

    function startScramble() {
        if (interval) return;

        interval = window.setInterval(() => {
            if (isHovering) return;

            displayText = text
                .split("")
                .map((char) => {
                    if (char === " ") return " ";
                    return characters[
                        Math.floor(Math.random() * characters.length)
                    ];
                })
                .join("");
        }, interval || 50);
    }

    function stopScramble() {
        isHovering = true;
        displayText = text;
    }

    function resumeScramble() {
        isHovering = false;
    }

    onMount(() => {
        startScramble();
    });

    onDestroy(() => {
        if (interval) clearInterval(interval);
    });
</script>

<span
    role="note"
    class="scramble-text"
    on:mouseenter={stopScramble}
    on:mouseleave={resumeScramble}
>
    {displayText}
</span>

<style>
    .scramble-text {
        display: inline-block;
        cursor: pointer;
    }
</style>