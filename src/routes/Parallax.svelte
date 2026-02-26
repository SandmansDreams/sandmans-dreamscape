<script lang="ts">
    import { onMount, onDestroy } from "svelte"

    const baseSpeed = 0.02
    const baseBlur = 7

    let container: HTMLDivElement
    let layers: HTMLElement[] = []

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

        requestAnimationFrame(animateParallax);
    }
    
    onMount(() => {
        animateParallax()
    })
</script>

<div bind:this={container} class="parallax-container">
    <div class="parallax-container">
        <div bind:this={layers[0]} class="parallax-layer" 
            style="background-image: url('/parallax/NoodleField L1.png'); scale: 1; filter: blur(8px);" 
        ></div>
        <div bind:this={layers[1]} class="parallax-layer" 
            style="background-image: url('/parallax/NoodleField L2.png'); scale: 1.1; filter: blur(6px);" 
        ></div>
        <div bind:this={layers[2]} class="parallax-layer" 
            style="background-image: url('/parallax/NoodleField L3.png'); scale: 1.2; filter: blur(3px);" 
        ></div>
        <div bind:this={layers[3]} class="parallax-layer" 
            style="background-image: url('/parallax/NoodleField L4.png'); scale: 1.5; filter: blur(1px);" 
        ></div>
        <div bind:this={layers[4]} class="parallax-layer" 
            style="background-image: url('/parallax/NoodleField L5.png'); scale: 2;" 
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