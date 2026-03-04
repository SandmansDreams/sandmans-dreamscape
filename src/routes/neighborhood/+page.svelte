<script lang="ts">
    import { onMount } from "svelte";

    type Button = {
        id: string
        name: string
        url: string
        src: string
    }

    type Node = Button & {
        x: number;
        y: number;
        vx: number;
        vy: number;
        radius: number;
    }

    type Link = {
        from: string,
        to: string
    }

    const buttons: Button[] = [
        {id: "0", name: "Sandaman", url:"https://sandmans-dreamscape.vercel.app/neighborhood", src:"https://sandmans-dreamscape.vercel.app/thebutton.gif"},
        {id: "1", name: "Onio", url: "https://onio.neocities.org", src: "https://onio.neocities.org/thebutton.gif"},
        {id: "2", name: "Kuroi", url: "https://kuroi.neocities.org/", src: "https://kuroi.com.br/img/button1.png"},
        {id: "3", name: "Kick", url: "https://kickalt.com/", src: ""},
    ]

    const sharedLinks = [
        ["1", "2"], // Onio and Kuroi
    ]

    let graphContainer: HTMLDivElement
    let svgLinks: SVGSVGElement
    let width = 0
    let height = 0

    let nodes: Node[] = [];
    let links: Link[] = [];
    let animationId: number;

    function getNodeById(id: string): Node | undefined {
        return nodes.find(n => n.id === id);
    }

    function updateDOM() {
        // Update links
        const pathData = links
            .map(l => {
                const a = getNodeById(l.from)
                const b = getNodeById(l.to)
                if (!a || !b) return "";
                return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
            })
            .join(" ");
        
        const path = svgLinks.querySelector("path");
        if (path) path.setAttribute("d", pathData);

        // Update nodes
        nodes.forEach(n => {
            const el = document.getElementById(n.id);
            if (el) {
                el.style.left = `${n.x - n.radius}px`;
                el.style.top = `${n.y - n.radius}px`;
            }
        });
    }

    function simulate() {
        const repulsion = -200
        const linkLength = 150
        const damping = 0.9
        const orbitalForce = 0.005

        // Repulsion
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i]
                const b = nodes[j]

                const dx = b.x - a.x
                const dy = b.y - a.y
                const dist = Math.sqrt(dx * dx + dy * dy) || 1

                const force = repulsion / (dist * dist)
                const fx = (force * dx) / dist
                const fy = (force * dy) / dist

                a.vx += fx;
                a.vy += fy;
                b.vx -= fx;
                b.vy -= fy;
            }
        }

        // Attraction
        links.forEach(l => {
            const from = getNodeById(l.from)
            const to = getNodeById(l.to)
            if (!from || !to) return

            const dx = to.x - from.x
            const dy = to.y - from.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1

            const diff = dist - linkLength

            const force = diff * 0.1
            const fx = (force * dx) / dist
            const fy = (force * dy) / dist

            from.vx += fx
            from.vy += fy
            to.vx -= fx
            to.vy -= fy
        })

        // Centering
        const centreX = width / 2
        const centreY = height / 2

        nodes.forEach(n => {
            const dx = centreX - n.x
            const dy = centreY - n.y
            n.vx += dx * 0.01
            n.vy += dy * 0.01
            
            // Add orbital spin (tangential velocity)
            if (n.id !== "0") {
                const distance = Math.sqrt(dx * dx + dy * dy) || 1
                const tangentX = -dy / distance
                const tangentY = dx / distance
                n.vx += tangentX * orbitalForce
                n.vy += tangentY * orbitalForce
            }
        })

        // Update positions
        nodes.forEach(n => {
            const node = n as any;
            if (node.fx == null) {
                n.x += n.vx
                n.vx *= damping
            }
            if (node.fy == null) {
                n.y += n.vy
                n.vy *= damping
            }

            // Constrain to bounds
            const radius = n.radius;
            n.x = Math.max(radius, Math.min(width - radius, n.x));
            n.y = Math.max(radius, Math.min(height - radius, n.y));
        });

        updateDOM()
        animationId = requestAnimationFrame(simulate)
    }

    onMount (() => {
        if (!graphContainer) return

        const rect = graphContainer.getBoundingClientRect();
        width = rect.width;
        height = rect.height;

        nodes = buttons.map(b => ({
            ...b,
            x: Math.random() * width,
            y: Math.random() * height,
            vx: 0,
            vy: 0,
            radius: 40,
        }));

        links = sharedLinks.map(([a, b]) => ({ from: a, to: b }));
        // add links to center
        buttons.forEach(b => {
            if (b.id !== "0") {
                links.push({ from: b.id, to: "0" });
            }
        });

        // fix center node
        const centreX = width / 2;
        const centreY = height / 2;
        const centerNode = nodes.find(n => n.id === "0") as any;
        if (centerNode) {
            centerNode.x = centreX;
            centerNode.y = centreY;
            centerNode.fx = centreX;
            centerNode.fy = centreY;
        }

        simulate();

        return () => {
            cancelAnimationFrame(animationId);
        };
    })


</script>

<svelte:head>
	<title>Sandman's Neighborhood</title>
	<meta name="description" content="Other sites I like" />
</svelte:head>

<section>
	<h1 style="margin: 0">Check Out My Neighbors</h1>
    <h2 style="margin: 0">(Other sites I like)</h2>

    <div class="graph" bind:this={graphContainer}>
        <svg bind:this={svgLinks} class="graph-links fade-in-long" {width} {height}>
            <path stroke="#000" stroke-width="2" fill="none" />
        </svg>
        {#each nodes as node}
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

    <h2>Or put my button on your site:</h2>
    <div class="button-code tinted-small-border">
        <a href="https://sandmans-dreamscape.vercel.app/" title="Check out the Dreamscape"><img src="https://sandmans-dreamscape.vercel.app/thebutton.gif" alt="The land of your dreams" width="176" height="62"></a>
        <textarea class="button-code"><a href="https://sandmans-dreamscape.vercel.app/" title="Check out the Dreamscape"><img src="https://sandmans-dreamscape.vercel.app/thebutton.gif" alt="The land of your dreams" width="88" height="31"></a></textarea>	
    </div>

</section>

<style>
    .button-code {
        display: grid;
        grid-template-columns: 1fr 2fr;
        justify-self: center;
        width: 80%;
        height: fit-content;
        justify-items: center;
        align-items: center;
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
    }

    .button-container {
        position: absolute;
        min-width: 100px;
        min-height: 70px;
        width: fit-content;
        height: fit-content;
        transform-origin: center;
        /* background-color: rgba(0,0,0,0.25); */
        background-color: rgb(91, 91, 91);
        padding: .25rem;
        border-radius: 1rem;
        justify-content: center;
        align-content: center;
        justify-items: center;
        align-items: center;
        text-align: center;
        transition: .5s ease;
    }

    .button-container:hover {
        transition: .5s ease;
        transform: scale(1.25);
        
    }

    .button-container p {
        text-indent: 0rem;
        text-align: center;
        line-height: 12pt;
        font-size: 14pt;
    }

    .graph {
        position: relative;
        width: 110%;
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


</style>
