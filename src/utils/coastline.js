const GRID_CELL_SIZE_DEG = 2

function landBit(mask, index) {
  return (mask.bits[index >> 3] >> (index & 7)) & 1
}

function normalizeLongitude(value) {
  return ((value + 180) % 360 + 360) % 360 - 180
}

function nextEdgeFor(edges, edgeIndex, used) {
  const candidate = edges.get(edgeIndex)
  if (candidate === undefined) return -1
  if (Array.isArray(candidate)) {
    for (const item of candidate) if (!used[item]) return item
    return -1
  }
  return used[candidate] ? -1 : candidate
}

export function extractLandPolygons(mask) {
  const width = Number(mask?.width)
  const height = Number(mask?.height)
  const bits = mask?.bits
  if (!(width > 0 && height > 0) || !bits) throw new Error('陆海掩膜数据无效')
  const west = Number(mask.west)
  const north = Number(mask.north)
  const lonStep = Number(mask.lonStep)
  const latStep = Number(mask.latStep)
  if (![west, north, lonStep, latStep].every(Number.isFinite) || lonStep <= 0 || latStep <= 0) {
    throw new Error('陆海掩膜尺寸无效')
  }

  const vertexWidth = width + 1
  const starts = []
  const ends = []
  for (let row = 0; row < height; row += 1) {
    const base = row * width
    for (let col = 0; col < width; col += 1) {
      const index = base + col
      if (!landBit(mask, index)) continue
      const topLeft = row * vertexWidth + col
      const topRight = topLeft + 1
      const bottomLeft = (row + 1) * vertexWidth + col
      const bottomRight = bottomLeft + 1
      if (row === 0 || !landBit(mask, index - width)) {
        starts.push(topLeft)
        ends.push(topRight)
      }
      if (row === height - 1 || !landBit(mask, index + width)) {
        starts.push(bottomRight)
        ends.push(bottomLeft)
      }
      if (col === 0 || !landBit(mask, index - 1)) {
        starts.push(bottomLeft)
        ends.push(topLeft)
      }
      if (col === width - 1 || !landBit(mask, index + 1)) {
        starts.push(topRight)
        ends.push(bottomRight)
      }
    }
  }

  const edges = new Map()
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]
    const existing = edges.get(start)
    if (existing === undefined) edges.set(start, index)
    else if (Array.isArray(existing)) existing.push(index)
    else edges.set(start, [existing, index])
  }

  const used = new Uint8Array(starts.length)
  const vertices = new Float32Array(starts.length * 2)
  const offsets = [0]
  let cursor = 0
  let vertexCount = 0
  let ringCount = 0

  for (let index = 0; index < starts.length; index += 1) {
    if (used[index]) continue
    const ringStart = vertexCount
    const startVertex = starts[index]
    let edge = index
    let closed = false

    while (edge >= 0 && !used[edge]) {
      used[edge] = 1
      const vertexId = starts[edge]
      const row = Math.floor(vertexId / vertexWidth)
      const col = vertexId - row * vertexWidth
      vertices[cursor] = west + col * lonStep
      vertices[cursor + 1] = north - row * latStep
      cursor += 2
      vertexCount += 1
      const endVertex = ends[edge]
      if (endVertex === startVertex) {
        closed = true
        break
      }
      edge = nextEdgeFor(edges, endVertex, used)
    }

    if (closed && vertexCount - ringStart >= 3) {
      ringCount += 1
      offsets.push(vertexCount)
    } else {
      cursor = ringStart * 2
      vertexCount = ringStart
    }
  }

  return {
    vertices: vertices.subarray(0, cursor),
    offsets: Uint32Array.from(offsets),
    ringCount,
    vertexCount,
  }
}

export function createLandPolygonIndex(result) {
  const vertices = result?.vertices
  const offsets = result?.offsets
  if (!(vertices instanceof Float32Array) || !offsets || offsets.length < 1) {
    throw new Error('海岸线多边形数据无效')
  }
  const ringCount = Math.max(0, offsets.length - 1)
  const rings = new Array(ringCount)
  for (let index = 0; index < ringCount; index += 1) {
    const start = offsets[index]
    const end = offsets[index + 1]
    let west = Infinity
    let east = -Infinity
    let south = Infinity
    let north = -Infinity
    for (let vertex = start; vertex < end; vertex += 1) {
      const lon = vertices[vertex * 2]
      const lat = vertices[vertex * 2 + 1]
      if (lon < west) west = lon
      if (lon > east) east = lon
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
    rings[index] = { start, end, west, east, south, north }
  }

  const columns = Math.ceil(360 / GRID_CELL_SIZE_DEG)
  const rows = Math.ceil(180 / GRID_CELL_SIZE_DEG)
  const grid = new Array(columns * rows)
  const cellX = (lon) => Math.max(0, Math.min(columns - 1, Math.floor((lon + 180) / GRID_CELL_SIZE_DEG)))
  const cellY = (lat) => Math.max(0, Math.min(rows - 1, Math.floor((lat + 90) / GRID_CELL_SIZE_DEG)))

  for (let index = 0; index < ringCount; index += 1) {
    const ring = rings[index]
    const firstColumn = cellX(ring.west)
    const lastColumn = cellX(ring.east)
    const firstRow = cellY(ring.south)
    const lastRow = cellY(ring.north)
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const cell = row * columns + column
        if (!grid[cell]) grid[cell] = []
        grid[cell].push(index)
      }
    }
  }

  function pointInRing(start, end, lon, lat) {
    let inside = false
    let previous = end - 1
    for (let vertex = start; vertex < end; previous = vertex, vertex += 1) {
      const xi = vertices[vertex * 2]
      const yi = vertices[vertex * 2 + 1]
      const xj = vertices[previous * 2]
      const yj = vertices[previous * 2 + 1]
      if ((yi > lat) !== (yj > lat)) {
        const crossing = xi + ((lat - yi) * (xj - xi)) / (yj - yi)
        if (crossing > lon) inside = !inside
      }
    }
    return inside
  }

  function contains(longitude, latitude) {
    const lon = Number(longitude)
    const lat = Number(latitude)
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90) return null
    const x = normalizeLongitude(lon)
    const candidates = grid[cellY(lat) * columns + cellX(x)]
    if (!candidates) return false
    let inside = false
    for (const index of candidates) {
      const ring = rings[index]
      if (x < ring.west || x > ring.east || lat < ring.south || lat > ring.north) continue
      if (pointInRing(ring.start, ring.end, x, lat)) inside = !inside
    }
    return inside
  }

  return {
    ringCount,
    vertexCount: Number(result.vertexCount) || offsets[ringCount] || 0,
    contains,
  }
}

export function extractLandPolygonsAsync(mask) {
  if (typeof Worker === 'undefined') {
    return Promise.resolve().then(() => extractLandPolygons(mask))
  }
  let worker
  try {
    worker = new Worker(new URL('../workers/coastlineWorker.js', import.meta.url), { type: 'module' })
  } catch {
    return Promise.resolve().then(() => extractLandPolygons(mask))
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      resolve(result)
    }
    const timer = setTimeout(() => finish(null), 30_000)
    worker.onmessage = (event) => {
      const data = event.data
      if (!data?.ok) {
        finish(null)
        return
      }
      finish({
        vertices: data.vertices,
        offsets: data.offsets,
        ringCount: data.ringCount,
        vertexCount: data.vertexCount,
      })
    }
    worker.onerror = () => finish(null)
    try {
      const bits = mask.bits.slice()
      worker.postMessage({
        width: mask.width,
        height: mask.height,
        west: mask.west,
        north: mask.north,
        lonStep: mask.lonStep,
        latStep: mask.latStep,
        bits,
      }, [bits.buffer])
    } catch {
      finish(null)
    }
  })
}
