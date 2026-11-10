import { extractLandPolygons } from '../utils/coastline.js'

self.onmessage = (event) => {
  try {
    const result = extractLandPolygons(event.data)
    self.postMessage({
      ok: true,
      vertices: result.vertices,
      offsets: result.offsets,
      ringCount: result.ringCount,
      vertexCount: result.vertexCount,
    }, [result.vertices.buffer, result.offsets.buffer])
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || String(error) })
  }
}
