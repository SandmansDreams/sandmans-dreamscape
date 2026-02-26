<script lang="ts">
    import { onMount, onDestroy } from "svelte"
    import { browser } from "$app/environment";

    export let text = "Hover Me"
    //export let interval: number | null = null
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()"
    
    let displayText = text
    let frame: number
    let progress = 0
    let isHovering = false
    let lastTime = 0

    function randomChar() {
        return characters[
            Math.floor(Math.random() * characters.length)
        ];
    }

    function loop(time: number) {
        if (!lastTime) lastTime = time;
        const delta = time - lastTime;

        // Control speed here (bigger = slower reveal)
        const speed = 30;

        if (delta > speed) {
            lastTime = time;

            if (isHovering) {
                progress += 1;
                if (progress > text.length) {
                    progress = text.length;
                }
            } else {
                progress = 0;
            }

            displayText = text
                .split("")
                .map((char, i) => {
                    if (char === " ") return " ";
                    if (i < progress) return text[i];
                    return randomChar();
                })
                .join("");
        }

        frame = requestAnimationFrame(loop);
    }

    function handleEnter() {
        isHovering = true;
    }

    function handleLeave() {
        isHovering = false;
    }

    onMount(() => {
        if (!browser) return
        frame = requestAnimationFrame(loop)
    });

    onDestroy(() => {
        if (!browser) return
        cancelAnimationFrame(frame)
    });
</script>

<span
    role="note"
    class="scramble-text"
    on:mouseenter={handleEnter}
    on:mouseleave={handleLeave}
>
    {displayText}
</span>

<style>
    .scramble-text {
        display: inline-block;
        cursor: pointer;
    }
</style>