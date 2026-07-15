<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte"
    import { browser } from "$app/environment"

    import L1 from "$lib/images/parallax/Noodle Field L1.webp"
    import L2 from "$lib/images/parallax/Noodle Field L2.webp"
    import L3 from "$lib/images/parallax/Noodle Field L3.webp"
    import L4 from "$lib/images/parallax/Noodle Field L4.webp"
    import L5 from "$lib/images/parallax/Noodle Field L5.webp"

    export let autoScroll: boolean = true
    export let scrollSpeed = 2

    const baseSpeed = 0.02

    let autoOffset = 0;
    let lastTimestamp = 0;
    let layers: HTMLElement[] = []
    let frame: number | null = null
    let resizeHandler: (() => void) | null = null

    let tileHeights: number[] = []
    
    // Hard-coded image dimensions: 480px × 960px
    const IMAGE_WIDTH = 480
    const IMAGE_HEIGHT = 960

    // Calculate the proper heights of the tiles when scaled to ensure seamless looping
    function computeTileHeights() {
        // Use the actual container width instead of window.innerWidth
        // to account for scrollbars and precise viewport dimensions
        const container = document.querySelector('.parallax-container') as HTMLElement
        const containerWidth = container ? container.getBoundingClientRect().width : window.innerWidth
        
        // More precise calculation to avoid rounding issues
        const aspectRatio = IMAGE_HEIGHT / IMAGE_WIDTH // 960/480 = 2
        const tileHeight = Math.round(containerWidth * aspectRatio)
        
        // All layers use the same tile height since CSS scale doesn't affect background-position
        tileHeights = [tileHeight, tileHeight, tileHeight, tileHeight, tileHeight]
        
        // console.log('Container width:', containerWidth)
        // console.log('Window inner width:', window.innerWidth) 
        // console.log('Computed tile height (same for all layers):', tileHeight)
        // console.log('Aspect ratio check:', aspectRatio)
    }

    // Move the layers
    function updateLayers(totalOffset: number) {
        if (tileHeights.length === 0) return // Don't update if heights aren't computed yet
        
        for (let i = 0; i < layers.length; i++) {
            if (!layers[i]) continue // Skip if layer isn't bound yet
            
            const depth = i + 1;
            const speed = baseSpeed * depth;
            const movement = -totalOffset * speed;

            const tileHeight = tileHeights[i]
            if (!tileHeight || tileHeight <= 0) continue

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
            startAuto();
        } else {
            stopAuto();
            lastTimestamp = 0;
            // Add scroll event if not present
            window.addEventListener("scroll", handleScroll, { passive: true });
        }
    }
    
    onMount(() => {
        if (!browser) return;

        // Compute heights immediately with known dimensions
        computeTileHeights();
        updateLayers(window.scrollY);

        resizeHandler = () => {
            computeTileHeights();
            updateLayers(window.scrollY);
        }
        
        window.addEventListener("resize", resizeHandler);
    });


    onDestroy(() => {
        if (!browser) return;
        stopAuto();
        window.removeEventListener("scroll", handleScroll);
        if (resizeHandler) {
            window.removeEventListener("resize", resizeHandler);
        }
    });
</script>

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
        style="background-image: url('{L4}'); scale: 1.4; filter: blur(1px);" 
    ></div>
    <div bind:this={layers[4]} class="parallax-layer" 
        style="background-image: url('{L5}'); scale: 1.8;" 
    ></div>
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