<script lang="ts">
    import { onMount } from "svelte";

    let canvas: HTMLCanvasElement
    let context: CanvasRenderingContext2D | null
    const canvasDim = 1000
    let grids = 20
    const cellSize = canvasDim / grids

    let scale = $state(1)
    let hoveredCell = $state<Cell | null>(null)

    const testShip = [
        []
    ]

    type BlockShape = 
        | "full"         
        | "triSE"
        | "triSW"
        | "triNE"
        | "triNW"

    type CellType = 
        | "empty" 
        | "block"

    interface Cell {
        col: number,
        row: number,
        type: CellType,
        shape?: BlockShape
    }

    const grid: Cell[][] = Array.from({ length: grids }, (_, row) =>
        Array.from({ length: grids }, (_, col) => ({
            col,
            row,
            type: "empty" as CellType,
        }))
    )

    function drawGrid() {
        if (!context) {
            console.error("var {context} not found at function {drawGrid}")
            return
        }

        const strokeStyle = "rgba(105, 208, 255, 0.1)"

        for (const rowArr of grid) {
            for (const cell of rowArr) {
                drawCell(cell, strokeStyle)
            }
        }
    }
    function drawCell(cell: Cell, strokeStyle: string) {
        if (!context) {
            console.error("var {context} not found at function {drawCell}")
            return
        }

        const x = cell.col * cellSize
        const y = cell.row * cellSize

        context.strokeStyle = strokeStyle
        
        if (cell.type !== "empty") {
            switch (cell.type) {
                case "block": 
                    drawBlock(cell, "rgba(255, 180, 80, 0.9)")
                    break
                default:
                    break
            }
        } 
        
        if (hoveredCell && hoveredCell.col === cell.col && hoveredCell.row === cell.row) {
            context.fillStyle = strokeStyle
            context.fillRect(x, y, cellSize, cellSize)
        }


        context.strokeRect(x, y, cellSize, cellSize)

        drawCellNumbers(cell, strokeStyle)

        // Cleanup
        context.fillStyle = "rgba(0, 0, 0, 0)"
        context.strokeStyle = "rgba(0, 0, 0, 0)"
    }
    function drawCellNumbers(cell: Cell, fillStyle: string) {
        if (!context) {
            console.error("var {context} not found at function {drawCellChords}")
            return
        }
        const x = cell.col * cellSize + 5
        const y = cell.row * cellSize + 12

        context.fillStyle = fillStyle
        context.fillText(`(${cell.col}, ${cell.row})`, x, y)
    }

    function drawBlock(cell: Cell, fillStyle: string) {
        if (!context || cell.type !== "block" || !cell.shape) return

        const x = cell.col * cellSize
        const y = cell.row * cellSize

        context.fillStyle = fillStyle

        if (cell.shape === "full") {
            context.fillRect(x, y, cellSize, cellSize)
            return
        } else {
            drawTriangle(cell.shape, x, y, cellSize, cellSize)
        }

    }
    function drawTriangle(shape: Exclude<BlockShape, "full">, x: number, y: number, w: number, h: number) {
        if (!context) return

        const NW: [number, number] = [x, y]
        const NE: [number, number] = [x + w, y]
        const SW: [number, number] = [x, y + h]
        const SE: [number, number] = [x + w, y + h]

        // Each shape keeps its named corner + the two corners adjacent to it along
        // the cell's edges. The third point (hypotenuse) is the opposite corner.
        let points: [number, number][]

        switch (shape) {
            case "triNW": points = [NW, NE, SW]; break
            case "triNE": points = [NE, NW, SE]; break
            case "triSW": points = [SW, NW, SE]; break
            case "triSE": points = [SE, NE, SW]; break
        }

        context.beginPath()
        context.moveTo(points[0][0], points[0][1])
        context.lineTo(points[1][0], points[1][1])
        context.lineTo(points[2][0], points[2][1])
        context.closePath()
        context.fill()
    }

    function paintTestShape() {
        const setShape = (row: number, col: number, shape: BlockShape) => {
            if (row < 0 || row >= grids || col < 0 || col >= grids) return
            grid[row][col].type = "block"
            grid[row][col].shape = shape
        }

        const cy = Math.floor(grids / 2)
        const cx = Math.floor(grids / 2)

        setShape(cy, cx, "full")
        setShape(cy, cx - 1, "full")

        // top wing: apex points up, at the boundary between the two cells
        setShape(cy - 1, cx - 1, "triSE")
        setShape(cy - 1, cx, "triSW")

        // bottom wing: apex points down, at the boundary between the two cells
        setShape(cy + 1, cx - 1, "triNE")
        setShape(cy + 1, cx, "triNW")
    }


    function getCellFromMouseEvent(event: MouseEvent): Cell | null {
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvasDim / rect.width
        const scaleY = canvasDim / rect.height

        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;
    
        const col = Math.floor(x / cellSize);
        const row = Math.floor(y / cellSize);
    
        if (col < 0 || col >= grids || row < 0 || row >= grids) return null;
        return grid[row][col] as Cell
    }

    function onCanvasMouseMove(event: MouseEvent) {
        const cell = getCellFromMouseEvent(event)

        if (!cell) {
            handleMouseLeave()
            return
        }

        if (!hoveredCell || hoveredCell.col !== cell.col || hoveredCell.row !== cell.row) {
            handleCellHover(cell)
        }
    }

    function onCanvasClick(event: MouseEvent) {
        const cell = getCellFromMouseEvent(event)
        if (!cell) {
            console.error("var {cell} not found at function {onCanvasClick}: Canvas was clicked but no cell was found")
            return
        }
        handleCellClick(cell)
        //console.log(`Cell clicked: ${cell.col}, ${cell.row}, ${cell.type}`)
    }

    function handleCellClick(cell: Cell) {
        switch (cell.type) {
            case "empty":
                setCellType(cell, "block", "full")
                break
            case "block":
                switch (cell.shape) {
                    case "full":
                        setCellType(cell, "block", "triNW")
                        break
                    case "triNW":
                        setCellType(cell, "block", "triNE")
                        break
                    case "triNE":
                        setCellType(cell, "block", "triSE")
                        break
                    case "triSE":
                        setCellType(cell, "block", "triSW")
                        break
                    case "triSW":
                        setCellType(cell, "empty")
                        break
                }
                break
            default:
                break
        }

        draw()
    }

    function setCellType(cell: Cell, type: CellType, shape?: BlockShape) {
        if (!shape) {
            grid[cell.row][cell.col] = {col: cell.col, row: cell.row, type}
        } else {
            grid[cell.row][cell.col] = {col: cell.col, row: cell.row, type, shape}
        }

    }

    function handleCellHover(cell: Cell) {
        hoveredCell = cell
        draw()
    }

    function handleMouseLeave() {
        hoveredCell = null
        draw()
    }

    function draw() {
        if (!context) return
        context.clearRect(0,0,canvasDim, canvasDim)

        drawGrid()
    }

    onMount(() => {
        if (!canvas) return
        context = canvas.getContext("2d")

        paintTestShape()

        draw()
    }) 
</script>

<main>
    <div>

    </div>

    <canvas 
        bind:this={canvas} 
        width={canvasDim} 
        height={canvasDim} 
        onmousemove={onCanvasMouseMove}
        onmouseleave={handleMouseLeave}
        onclick={onCanvasClick}
        id="renderer" 
        class="crt"
    ></canvas>
</main>

<style>
    :root {
        background-color: black;
        overflow: hidden;
        overscroll-behavior: none;
        padding: 0;

        --background: rgb(18, 18, 18);
        --blue: rgba(105, 208, 255, 0.1);
    }

    canvas {
        background-color: var(--background);
        width: 1000px;
        height: 1000px;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        margin: 0;
        padding: 0;
    }

    .crt {
        background: linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0), rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.075));
        background-size: cover;
        background-size: 100% 1px;
    }
</style>