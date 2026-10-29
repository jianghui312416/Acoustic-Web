/** 按绘制顺序反向拾取格网三角形，避免在地形边界外选中最近顶点。 */
export function pickTerrainPoint(scene, x, y) {
  for (let i = (scene?.faces?.length || 0) - 1; i >= 0; i--) {
    const p = scene.faces[i].p
    for (const [a, b, c] of [[p[0], p[1], p[2]], [p[0], p[2], p[3]]]) {
      const d = (b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y)
      if (Math.abs(d) < 1e-8) continue
      const u = ((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/d
      const v = ((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/d
      const w = 1-u-v
      if (Math.min(u,v,w) < -1e-6) continue
      // Undo display perspective before interpolating physical coordinates.
      const weights = [u * (a.perspective || 1), v * (b.perspective || 1), w * (c.perspective || 1)]
      const sum = weights.reduce((total, value) => total + value, 0)
      const point = { x, y }
      for (const key of ['lon','lat','elevation']) point[key] = (weights[0]*a[key]+weights[1]*b[key]+weights[2]*c[key]) / sum
      return point
    }
  }
  return null
}
