<script lang="ts">
    import { onMount } from "svelte";
    import { Assert } from "./dev/assert";

    let canvas = $state<HTMLCanvasElement | null>(null)
    let context: GPUCanvasContext | null
    let adapter
    let device: GPUDevice | undefined

    // Dev mode
    let devMode = $state(true) // If want only in dev, swith to 'import.meta.env.DEV'
    //let scene = $state<Scene | null>(null)

    let fps = $state(-1)
    let fpsClass = $derived(fps >= 55 ? "good" : fps >= 30 ? "ok" : "bad")

    function render(renderPassDescriptor: GPURenderPassDescriptor, pipeline: GPURenderPipeline) {
        Assert.exists(context, "context")

        // Get the current texture from the canvas context and
        // set it as the texture to render to.
        renderPassDescriptor.colorAttachments[0]!.view = context.getCurrentTexture().createView();
    
        // make a command encoder to start encoding commands
        const encoder = device!.createCommandEncoder({ label: 'our encoder' });
    
        // make a render pass encoder to encode render specific commands
        const pass = encoder.beginRenderPass(renderPassDescriptor);
        pass.setPipeline(pipeline);
        pass.draw(3);  // call our vertex shader 3 times
        pass.end();
    
        const commandBuffer = encoder.finish();
        device!.queue.submit([commandBuffer]); 
    }

    onMount(() => {
        Assert.exists(canvas, "canvas")

        // Check that the browser supports WebGPU, inside an inner call because onMount() can't be async and also return something
        void (async () => {
            adapter = await navigator.gpu?.requestAdapter()
            device = await adapter?.requestDevice()
            Assert.that(device instanceof GPUDevice, "Your browser does not support WebGPU... sorry.")

            // Get a WebGPU context from the canvas and configure it
            context = canvas?.getContext('webgpu')
            Assert.exists(context, "context")

            const format = navigator.gpu.getPreferredCanvasFormat()
            context?.configure(
                {
                    device,
                    format
                }
            )

            const module = device.createShaderModule({
                label: 'doubling compute module',
                code: /* wgsl */ `
                @group(0) @binding(0) var<storage, read_write> data: array<f32>;
            
                @compute @workgroup_size(1) fn computeSomething(
                    @builtin(global_invocation_id) id: vec3u
                ) {
                    let i = id.x;
                    data[i] = data[i] * 2.0;
                }
                `,
            });

            // Create a render pipeline
            const pipeline = device.createComputePipeline({
                label: 'doubling compute pipeline',
                layout: 'auto',
                compute: {
                module,
                },
            });

            // Create a buffer on the GPU to hold our computation input and output
            const input = new Float32Array([1, 3, 5]);

            const workBuffer = device.createBuffer({
                label: 'work buffer',
                size: input.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            });
            // Copy our input data to that buffer
            device.queue.writeBuffer(workBuffer, 0, input);

            // Create a buffer on the GPU to get a copy of the results
            const resultBuffer = device.createBuffer({
                label: 'result buffer',
                size: input.byteLength,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
            });

            // Setup a bindGroup to tell the shader which
            // buffer to use for the computation
            const bindGroup = device.createBindGroup({
                label: 'bindGroup for work buffer',
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: workBuffer  },
                ],
            });

            // Encode commands to do the computation
            const encoder = device.createCommandEncoder({
                label: 'doubling encoder',
            });
            const pass = encoder.beginComputePass({
                label: 'doubling compute pass',
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(input.length);
            pass.end();

            // Encode a command to copy the results to a mappable buffer.
            encoder.copyBufferToBuffer(workBuffer, 0, resultBuffer, 0, resultBuffer.size);

            // Finish encoding and submit the commands
            const commandBuffer = encoder.finish();
            device.queue.submit([commandBuffer]);


            // Read the results
            await resultBuffer.mapAsync(GPUMapMode.READ);
            const result = new Float32Array(resultBuffer.getMappedRange());
            
            console.log('input', input);
            console.log('result', result);
            
            resultBuffer.unmap();
            //// Create a render pass descriptor that describes a texture to draw and how to use them
            //const renderPassDescriptor = {
            //    label: 'our basic canvas renderPass',
            //    colorAttachments: [
            //        {
            //            view: context.getCurrentTexture().createView(),
            //            clearValue: [0.3, 0.3, 0.3, 1],
            //            loadOp: 'clear',
            //            storeOp: 'store',
            //        },
            //    ],
            //} as GPURenderPassDescriptor

            //render(renderPassDescriptor, pipeline)
        })() // These parentheses are important

        //const stats = setInterval(() => {fps = created.fps}, 100)

        return () => {
            //clearInterval(stats)
        }
    })
</script>

<svelte:window onkeydown={(e) => { if (e.key === "`") devMode = !devMode }} />

<div id="container">
    {#if devMode}
        <div id="dev-panel">
            <header>
                <span class="title">DEV</span>
                <span class="fps {fpsClass}">{fps.toFixed(0)} fps</span>
            </header>

            <span class="select">
                <!--<select
                    value={scene?.id ?? ""}
                    onchange={(e) => {
                        const found = DEV_SCENES.find((s) => s.id === e.currentTarget.value)
                        if (found) selectScene(found)
                    }}
                >
                    {#each DEV_SCENES as definition (definition.id)}
                        <option value={definition.id}>{definition.name}</option>
                    {/each}
                </select>-->
            </span>

            <footer>` toggles this panel</footer>
        </div>
    {/if}

    <canvas bind:this={canvas}></canvas>
</div>

<style>
    canvas {
        background-color: black;
        position: relative;
        height: 100vh;
        width: 100vw;
        z-index: 0;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
    }

    #container {
        background-color: black;
        position: absolute;
        padding: 0;
        margin: 0;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        overscroll-behavior: none;
        overflow: hidden;
    }

    #dev-panel {
        --accent: #0df;
        --line: #0df3;
        --track: #ffffff14;

        position: absolute;
        top: 12px;
        left: 12px;
        z-index: 1;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #fff;
        background: #070b0ee6;
        backdrop-filter: blur(6px);
        border: 1px solid var(--line);
        border-radius: 4px;
        box-shadow: 0 6px 24px #000a;
        padding: 10px;
        width: 320px;
        max-height: calc(100vh - 48px);
        overflow-y: auto;
        opacity: 25%;
        transition: .25s ease;
    }
    #dev-panel:hover {
        opacity: 100%;
    }

    .fps {
        font-variant-numeric: tabular-nums;
    }
    .fps.good { color: #6f6; }
    .fps.ok   { color: #fc4; }
    .fps.bad  { color: #f66; }
</style>
