<script lang="ts">
    import { onMount, tick } from "svelte";

    let simpleMode = false;

    import type { Button, Node, Link } from "./Simulation.helpers";
    import { getRandomCenterPoint } from "./Simulation.helpers";
    import { drawLinks } from "./Simulation.drawing";
    import { applyAllForces } from "./Simulation.physics";
    import type { PhysicsConfig } from "./Simulation.physics";

    const config: PhysicsConfig = {
        repulsionForce: 5000,
        springLength: 225,
        springStrength: 0.003,
        dampener: 0.9,
        centeringForce: 0.0001,
    }

    const buttons: Button[] = [
        {id: "0", name: "Sandaman", url:"https://sandmans-dreamscape.vercel.app/neighborhood", src:"https://sandmans-dreamscape.vercel.app/thebutton.gif"},
        {id: "1", name: "Onio", url: "https://onio.neocities.org", src: "https://onio.neocities.org/thebutton.gif"},
        {id: "2", name: "Kuroi", url: "https://kuroi.neocities.org/", src: "https://kuroi.com.br/img/button1.png"},
        {id: "3", name: "Kick", url: "https://kickalt.com/", src: "https://kickalt.neocities.org/neighborbutton.gif"},
        {id: "4", name: "Kazmirl", url: "https://dwarvenmeadhall.neocities.org/", src: "https://dwarvenmeadhall.neocities.org/button.gif"},
    ]

    const sharedLinks = [
        ["3", "0"], // Kick to Sandman
        ["1", "2"], // Onio to Kuroi
        ["2", "1"], // Kuroi to Onio
        ["3", "4"], // Kick to Kazmirl
        ["4", "3"], // Kazmirl to Kick
    ]

    let graphContainer: HTMLDivElement;
    let canvasLinks: HTMLCanvasElement;
    let width = 0;
    let height = 0;

    let nodes: Map<string, Node> = new Map();
    let links: Map<string, Link> = new Map();
    let animationId: number;
    
    function affixCenterNode() {
        const centerNode = nodes.get("0");
        if (!centerNode) return;
        const centreX = (width / 2) - (centerNode.radius / 2);
        const centreY = (height / 2) - (centerNode.radius / 2);

        centerNode.x = centreX;
        centerNode.y = centreY;
        centerNode.vx = 0;
        centerNode.vy = 0;
    }

    function updateDOM() {
        // Update links
        const ctx = canvasLinks.getContext("2d");
        if (ctx) {
            ctx.clearRect(0, 0, width, height);
            drawLinks(links, ctx, 40);
        }

        // Update nodes (absolutely position DOM elements)
        nodes.forEach((n) => {
            const el = document.getElementById(n.id);
            if (el) {
                el.style.left = `${n.x - n.radius}px`;
                el.style.top = `${n.y - n.radius}px`;
            }
        });
    }

    function simulate() {
        applyAllForces(nodes, links, config, width, height);
        affixCenterNode()
        updateDOM();
        animationId = requestAnimationFrame(simulate);
    }

    function createNodes() {
        nodes = new Map();
        buttons.forEach(b => {
            nodes.set(b.id, {
                ...b,
                x: getRandomCenterPoint(canvasLinks).x,
                y: getRandomCenterPoint(canvasLinks).y,
                vx: 0,
                vy: 0,
                radius: 110,
            });
        });
    }
    
    function createLinks() {
        // Create Link objects and store in Map with IDs as L_from_to
        links = new Map();
        sharedLinks.forEach(([a, b]) => {
            const from = nodes.get(a);
            const to = nodes.get(b);
            if (from && to) {
                links.set(`L_${a}_${b}`, { id: `L_${a}_${b}`, from, to });
            }
        });
        // add links to center
        buttons.forEach(b => {
            if (b.id !== "0") {
                const from = nodes.get("0");
                const to = nodes.get(b.id);
                if (from && to) {
                    links.set(`L_0_${to.id}`, { id: `L_0_${to.id}`, from, to });
                }
            }
        });
    }

    function startGraph() {
        if (!graphContainer) return;

        const rect = graphContainer.getBoundingClientRect();
        width = rect.width;
        height = rect.height;

        createNodes();
        createLinks();
        
        simulate();
        
        window.addEventListener("resize", () => {
            const rect = graphContainer.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
        });

        return () => {
            cancelAnimationFrame(animationId);
        };
    }


    async function resetGraph() {
        // Cancel any running animation
        cancelAnimationFrame(animationId);
        // Wait for DOM to update so refs are bound
        await tick();
        // Set canvas size to current container size
        if (graphContainer && canvasLinks) {
            const rect = graphContainer.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
            canvasLinks.width = width;
            canvasLinks.height = height;
        }
        // Recreate nodes and links
        createNodes();
        createLinks();
        // Update DOM once to avoid flicker
        updateDOM();
    }

    async function toggleMode() {
        simpleMode = !simpleMode;
        if (!simpleMode) {
            await resetGraph();
            simulate();
        } else {
            cancelAnimationFrame(animationId);
        }
    }

    onMount(async () => {
        await resetGraph();
        simulate();
    });
</script>

<svelte:head>
	<title>Sandman's Neighborhood</title>
	<meta name="description" content="Other sites I like" />
</svelte:head>

<section>
    <h1 style="margin: 0">Check Out My Neighbors</h1>
    <h2 style="margin: 0">(Other sites I like)</h2>

    <div class="center-btn">
        <button class="simple-button" on:click={toggleMode}>{simpleMode ? "Graph Mode" : "Simple Mode"}</button>
    </div>

    {#if simpleMode}
        <div class="neighborhood">
            {#each Array.from(nodes.values()) as node}
                <a href={node.url} target="_blank">
                    {#if node.src !== ""}
                        <img src={node.src} alt={node.name} width="88" height="31" style="background-color: grey;">
                    {:else}
                        <span class="placeholder">img broke...</span>
                    {/if}
                    <p class="node-label">{node.name}</p>
                </a>
            {/each}
        </div>
    {:else}
        <div class="graph" bind:this={graphContainer}>
            <canvas bind:this={canvasLinks} class="graph-links" width={width} height={height}></canvas>
            {#each Array.from(nodes.values()) as node}
                <span class="button-container" id={node.id}> 
                    <a href={node.url} target="_blank">
                        {#if node.src !== ""}
                            <img src={node.src} alt={node.name} width="88" height="31" style="background-color: grey;">
                        {:else}
                            <span class="placeholder">img broke...</span>
                        {/if}
                        <p class="node-label">{node.name}</p>
                    </a>
                </span>
            {/each}
        </div>
    {/if}

    <h2>Or put my button on your site:</h2>
    <div class="button-code inset">
        <a href="https://gabrieltangel.neocities.org" title="Check out the Dreamscape"><img src="https://sandmans-dreamscape.vercel.app/thebutton.gif" alt="The land of your dreams" width="176" height="62"></a>
        <textarea class="button-code"><a href="https://gabrieltangel.neocities.org" title="Check out the Dreamscape"><img src="https://sandmans-dreamscape.vercel.app/thebutton.gif" alt="The land of your dreams" width="88" height="31"></a></textarea>	
    </div>
</section>

<style>
    section {
        max-width: 80vw;
        margin: 0 auto;
    }

    .simple-button {
        margin: 0;
        padding: .5rem 1rem;
        border: none;
        border-radius: .5rem;
        background-color: rgba(0,0,0,0.3);
        color: white;
        font-size: 1rem;
        cursor: pointer;
        font-family: inherit;
        user-select: none;
        transition: .25s ease;
    }
    .simple-button:hover {
        background-color: rgba(0,0,0,0.7);
        transition: .25s ease;
    }

    .center-btn {
        display: flex;
        justify-content: center;
        align-items: center;
        width: 100%;
        margin: 1.5rem 0;
    }
    .button-code {
        display: grid;
        grid-template-columns: 1fr 2fr;
        justify-self: center;
        width: 100%;
        height: fit-content;
        justify-items: center;
        align-items: center;
        background-color: rgba(0,0,0,0.25);
        border-radius: 1rem;
        padding: 1rem;
    }
    .button-code textarea {
        min-height: 100px;
        min-width: 200px;
        width: 100%;
        max-height: 300px;
        max-width: 500px;
        text-indent: n;
        border-radius: 1rem;
        background-color: rgba(0,0,0,0.25);
        border: none;
        padding: 10px;
        color: white;
        justify-self: right;
    }

    .button-container img, a {
        justify-self: center;
    }

    .button-container {
        position: absolute;
        min-width: 110px;
        min-height: 110px;
        transform-origin: center;
        background-color: rgba(0,0,0,1);
        padding: .25rem;
        border-radius: 100%;
        justify-content: center;
        align-content: center;
        justify-items: center;
        align-items: center;
        text-align: center;
        transform: translate(50%, 50%);
    }
    .button-container:hover {
        transform: translate(50%, 50%) scale(1.25);
    }
    .button-container p {
        text-indent: 0rem;
        text-align: center;
        line-height: 12pt;
        font-size: 14pt;
    }
    .graph {
        position: relative;
        width: 100%;
        height: 70vh;
    }
    .graph a {
        color: white;
        width: 88;
        min-height: 31;
    }
    .graph p {
        margin: 0;
    }
    .graph-links {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
    }
    .placeholder {
        width: 88px;
        height: 31px;
        background-color: black;
        color: white;
    }

    .neighborhood {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        justify-content: center;
        gap: 1rem;
        max-width: 80vw;
        margin: 0 auto;
    }
    .neighborhood a {
        display: flex;
        flex-direction: column;
        flex: 1 1 150px;
        align-items: center;
        gap: .5rem;
        background-color: rgba(0, 0, 0, 0.3);
        padding: 1rem;
        justify-items: center;
        align-items: center;
        border-radius: 1rem;
        width: fit-content;
        height: fit-content;
        transition: .25s ease;
    }
    .neighborhood a:hover {
         background-color: rgba(0, 0, 0, 0.7);
         transition: .25s ease;
    }
    .neighborhood p {
        margin: 0;
        width: 100%;
        text-align: center;
        text-indent: 0px;
        color: rgb(0, 195, 255);
    }
</style>
