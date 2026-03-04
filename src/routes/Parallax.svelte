<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte"
    import { browser } from "$app/environment"

    import L1 from "$lib/images/parallax/NoodleField L1.png"
    import L2 from "$lib/images/parallax/NoodleField L2.png"
    import L3 from "$lib/images/parallax/NoodleField L3.png"
    import L4 from "$lib/images/parallax/NoodleField L4.png"
    import L5 from "$lib/images/parallax/NoodleField L5.png"

    export let autoScroll: boolean = true
    export let scrollSpeed = 2

    const baseSpeed = 0.02

    let autoOffset = 0;
    let lastTimestamp = 0;
    let layers: HTMLElement[] = []
    let frame: number | null = null
    let viewportHeight = 0

    let tileHeights: number[] = []

    // Get the proper heights of the tiles when scaled to ensure seamless looping
    async function computeTileHeights() {
        await tick()

        tileHeights = await Promise.all(
            layers.map(layer => {
                return new Promise<number>((resolve) => {
                    const img = new Image()
                    const bg = getComputedStyle(layer)
                        .backgroundImage
                        .replace(/^url\(["']?/, "")
                        .replace(/["']?\)$/, "")

                    img.onload = () => {
                        const scale = window.innerWidth / img.width
                        resolve(img.height * scale)
                    }

                    img.src = bg
                })
            })
        )
    }

    // Move the layers
    function updateLayers(totalOffset: number) {
        for (let i = 0; i < layers.length; i++) {
            const depth = i + 1;
            const speed = baseSpeed * depth;
            const movement = -totalOffset * speed;

            const tileHeight = tileHeights[i] || 1

            const loopedOffset = ((movement % tileHeight) + tileHeight) % tileHeight

            layers[i].style.backgroundPosition = `0px ${loopedOffset}px`;
        }
    }

    // Animation loop
    function animateParallax(timestamp = 0) {
        if (lastTimestamp) {
            const delta = (timestamp - lastTimestamp) / 16.67; // ~60fps
            autoOffset += scrollSpeed * delta;
        }

        lastTimestamp = timestamp
        
        const scrollY = window.scrollY
        const totalOffset = autoOffset + scrollY

        updateLayers(totalOffset)

        frame = requestAnimationFrame(animateParallax);
    }

    function handleScroll() {
        if (autoScroll) return;
        updateLayers(window.scrollY);
    }

    function startAuto() {
        stopAuto(); // Always stop before starting
        lastTimestamp = 0;
        frame = requestAnimationFrame(animateParallax);
    }

    function stopAuto() {
        if (frame !== null) {
            cancelAnimationFrame(frame)
            frame = null
        }
    }

    $: if (browser && typeof autoScroll !== 'undefined') {
        if (autoScroll) {
            // Remove scroll event if present
            window.removeEventListener("scroll", handleScroll);
            autoOffset = window.scrollY;
            lastTimestamp = 0;
            startAuto();
        } else {
            stopAuto();
            lastTimestamp = 0;
            autoOffset = window.scrollY;
            updateLayers(window.scrollY);
            // Add scroll event if not present
            window.addEventListener("scroll", handleScroll, { passive: true });
        }
    }
    
    onMount(async () => {
        if (!browser) return;

        await computeTileHeights();
        updateLayers(window.scrollY);
        viewportHeight = window.innerHeight;

        window.addEventListener("resize", async () => {
            await computeTileHeights();
            updateLayers(window.scrollY);
        });

        updateLayers(window.scrollY);
    });


    onDestroy(() => {
        if (!browser) return;
        stopAuto();
        window.removeEventListener("scroll", handleScroll);
    });
</script>

<div class="parallax-container">
    <div class="parallax-container">
        <div bind:this={layers[0]} class="parallax-layer" 
            style="background-image: url('{L1}'); scale: 1; filter: blur(8px);" 
        ></div>
        <div bind:this={layers[1]} class="parallax-layer" 
            style="background-image: url('{L2}'); scale: 1.1; filter: blur(6px);" 
        ></div>
        <div bind:this={layers[2]} class="parallax-layer" 
            style="background-image: url('{L3}'); scale: 1.2; filter: blur(3px);" 
        ></div>
        <div bind:this={layers[3]} class="parallax-layer" 
            style="background-image: url('{L4}'); scale: 1.5; filter: blur(1px);" 
        ></div>
        <div bind:this={layers[4]} class="parallax-layer" 
            style="background-image: url('{L5}'); scale: 2;" 
        ></div>
    </div>
</div>


<style>
    .parallax-container {
        position: fixed;
        inset: 0;
        overflow: hidden;
        z-index: -1;
        background-color: #c5c5c5;
    }

    .parallax-layer {
        position: absolute;
        height: 100vh;
        inset: 0;
        background-repeat: repeat-y;
        background-size: 100% auto;
        will-change: background-position;
    }
</style>