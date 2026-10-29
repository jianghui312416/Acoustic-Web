const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
export const terrainLighting = Object.freeze({ enabled: true, hillshadeIntensity: .75, hillshadeAzimuth: 254, hillshadeAltitude: 45 })
export function normalizeExaggeration(value) {
  return clamp(Number.isFinite(Number(value)) ? Number(value) : 3, 1, 10)
}

// Screen-space subdivision, bounded by the original raster and a fixed face budget.
// Exaggeration deliberately does not select a new mesh; only zoom/viewport does.
export function terrainSegments(size, zoom = 1, subdivisionThreshold = .75) {
  const pixels = Math.min(size.width * .72, size.height * 1.2) * zoom
  return clamp(2 ** Math.ceil(Math.log2(Math.max(1, pixels / (12 * subdivisionThreshold)))), 32, 192)
}

const meshes = new WeakMap()
export function terrainMesh(grid, segments) {
  let levels = meshes.get(grid)
  if (!levels) { levels = new Map(); meshes.set(grid, levels) }
  const cols = Math.min(grid.width - 1, segments), rows = Math.min(grid.height - 1, segments)
  const key = `${cols}:${rows}`
  if (levels.has(key)) return levels.get(key)
  const b = grid.bounds
  const dx = (b.east - b.west) * 111320 * Math.cos((b.north + b.south) * Math.PI / 360) / (grid.width - 1)
  const dy = (b.north - b.south) * 110574 / (grid.height - 1)
  const vertices = []
  for (let r = 0; r <= rows; r++) {
    const row = Math.round(r / rows * (grid.height - 1))
    for (let c = 0; c <= cols; c++) {
      const col = Math.round(c / cols * (grid.width - 1))
      const elevation = grid.values[row * grid.width + col]
      const left = Math.max(0, col - 1), right = Math.min(grid.width - 1, col + 1)
      const north = Math.max(0, row - 1), south = Math.min(grid.height - 1, row + 1)
      const value = (r, c) => Number.isFinite(grid.values[r * grid.width + c]) ? grid.values[r * grid.width + c] : elevation
      vertices.push({
        lon: b.west + col / (grid.width - 1) * (b.east - b.west),
        lat: b.north - row / (grid.height - 1) * (b.north - b.south), elevation,
        slopeX: (value(row, right) - value(row, left)) / Math.max(1, (right - left) * dx),
        slopeY: (value(north, col) - value(south, col)) / Math.max(1, (south - north) * dy),
      })
    }
  }
  const faces = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * (cols + 1) + c
    const face = [i, i + 1, i + cols + 2, i + cols + 1]
    if (face.every(index => Number.isFinite(vertices[index].elevation))) faces.push(face)
  }
  const mesh = { vertices, faces }
  levels.set(key, mesh)
  return mesh
}

export function hillshade(slopeX, slopeY, lighting) {
  const azimuth = lighting.hillshadeAzimuth * Math.PI / 180
  const altitude = lighting.hillshadeAltitude * Math.PI / 180
  const x = -slopeX * lighting.zFactor, y = -slopeY * lighting.zFactor
  const illumination = Math.max(0, (x * Math.sin(azimuth) * Math.cos(altitude) +
    y * Math.cos(azimuth) * Math.cos(altitude) + Math.sin(altitude)) / Math.hypot(x, y, 1))
  return 1 - lighting.hillshadeIntensity + lighting.hillshadeIntensity * illumination
}
