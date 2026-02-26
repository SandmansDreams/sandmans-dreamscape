<script lang="ts">
    import { onMount, onDestroy } from "svelte"
    import { browser } from "$app/environment"

    import L1 from "$lib/images/parallax/NoodleField L1.png"
    import L2 from "$lib/images/parallax/NoodleField L2.png"
    import L3 from "$lib/images/parallax/NoodleField L3.png"
    import L4 from "$lib/images/parallax/NoodleField L4.png"
    import L5 from "$lib/images/parallax/NoodleField L5.png"

    const baseSpeed = 0.02
    const baseBlur = 7

    let layers: HTMLElement[] = []
    let frame: number

    function animateParallax() {
        const scrollY = window.scrollY;

        for (let i = 0; i < layers.length; i++) {
            const depth = i + 1;
            const speed = baseSpeed * depth
            
            let blurAmount = baseBlur / depth

            const movement = -scrollY * speed;

            layers[i].style.transform = `translateY(${movement}px)`;
            if (i !== layers.length - 1) {
                layers[i].style.filter = `blur(${blurAmount}px)`;
            }
        }

        frame = requestAnimationFrame(animateParallax);
    }
    
    onMount(() => {
        if (!browser) return
        animateParallax()
    })

    onDestroy(() => {
        if (!browser) return
        cancelAnimationFrame(frame)
    })
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
        top: 0;
        left: 0;
        width: 100%;
        height: 100vh;
        overflow: hidden;
        z-index: -1;
    }

    .parallax-layer {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 1000vh;
        background-repeat: repeat-y;
        background-size: 100% auto;
        will-change: transform;
    }
</style>