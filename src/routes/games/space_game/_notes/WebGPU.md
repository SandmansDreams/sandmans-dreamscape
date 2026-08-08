Really good website for examples with code: https://webgpu.github.io/webgpu-samples/

- WebGPU works similarly to [[WebGL]], but faster
	- [[Vertex Shader]]
	- [[Fragment Shader]]
	- [[Compute Shader]]
	- [[Buffer]]
	- [[Texture]]
	- It's actually *lower level* than WebGL
- [[WebGPU Flow.canvas]]
	- Theres a 'pipeline' which the GPU will run
		- Pipeline contains shaders (including compute)
		- Defines [[Attributes]] that reference buffers indirectly through internal state
			1. Attributes pull data from buffers and feed to Vertex Shader
			2. Vertex Shader feeds data to Fragment Shader
			3. Fragment Shaders write to textures through render pass description
	- [[Shaders]] reference resources (buffers, textures, samplers) indirectly through 'bind groups'
- Most WebGPU resources cannot be changed after creation
	- Can change their content, but not their size, usage, or format
	- To do that ^, destroy the old one and create a new one
- Command Buffers - Lists of commands
	- Command Encoders encode commands into command buffer
	- Submit the command buffer to WebGPU to run
```js
/* Command Buffer pseudo-code */
encoder = device.createCommandEncoder()
// draw something
{
	pass = encoder.beginRenderPass(...)
	pass.setPipeline(...)
	pass.setVertexBuffer(0, …)
	pass.setVertexBuffer(1, …)
	pass.setIndexBuffer(...)
	pass.setBindGroup(0, …)
	pass.setBindGroup(1, …)
	pass.draw(...)
	pass.end()
}
// draw something else
{
	pass = encoder.beginRenderPass(...)
	pass.setPipeline(...)
	pass.setVertexBuffer(0, …)
	pass.setBindGroup(0, …)
	pass.draw(...)
	pass.end()
	}
// compute something
{
	pass = encoder.beginComputePass(...)
	pass.beginComputePass(...)
	pass.setBindGroup(0, …)
	pass.setPipeline(...)
	pass.dispatchWorkgroups(...)
	pass.end();
}
commandBuffer = encoder.finish();
```
- Positions are in "clip space"
	- -1 - 1 on the x and y (and z) axes
	- From there, the vertexes are transformed to look however we want
- WebGPU has "labels" on nearly every object
	- This is optional, but makes it easier for errors to actually tell you what is wrong
	- `WGSL syntax error in shaderModule('our hardcoded red triangle shaders') at line 10`
	- 