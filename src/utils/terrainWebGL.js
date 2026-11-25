import {
  TERRAIN_MAX_MESH_SEGMENTS,
  normalizeExaggeration,
  pickBandStep,
  terrainColorAt,
  terrainLighting,
  terrainMesh,
  terrainShadowMask,
} from './terrainRendering.js'

const TERRAIN_VOLUME_MIN_SLICES = 35
const TERRAIN_VOLUME_MAX_SLICES = 251
const DEFAULT_VOLUME_OPACITY = 1

/** 将归一化最大采样步长换算为视线方向切片数。 */
export function terrainVolumeSliceCount(sampling) {
  const value = Number(sampling)
  const step = clamp(Number.isFinite(value) ? value : 0.01, 0.004, 0.03)
  return clamp(Math.ceil(1 / step) + 1, TERRAIN_VOLUME_MIN_SLICES, TERRAIN_VOLUME_MAX_SLICES)
}

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aSlope;
layout(location = 2) in float aElevation;
layout(location = 3) in vec2 aUv;

uniform float uWidth;
uniform float uHeight;
uniform float uScale;
uniform float uPanX;
uniform float uPanY;
uniform float uCosYaw;
uniform float uSinYaw;
uniform float uCosPitch;
uniform float uSinPitch;
uniform float uExaggeration;
uniform float uMinElevation;
uniform float uMaxElevation;

out vec2 vSlope;
out float vElevT;
out float vFogT;
out vec2 vUv;

void main() {
  float x = aPosition.x;
  float y = aPosition.y;
  float z = aPosition.z * uExaggeration;

  float rx = x * uCosYaw - y * uSinYaw;
  float ry = x * uSinYaw + y * uCosYaw;
  // Perspective must disappear in a true top-down view. Keeping a ry-dependent
  // scale at pitch=90 degrees turns horizontal circles into egg shapes.
  float perspectiveStrength = 0.35 * abs(uCosPitch);
  float perspective = 1.0 / (1.0 - ry * perspectiveStrength);

  float sx = uWidth * 0.5 + uPanX + rx * uScale * perspective;
  float sy = uHeight * 0.40 + uPanY + (ry * uSinPitch - z * uCosPitch) * uScale * perspective;

  vec2 ndc = vec2(sx / uWidth * 2.0 - 1.0, 1.0 - sy / uHeight * 2.0);

  // 用与 Canvas 渲染器相同的 order 作为深度，让 GPU 深度测试代替逐面排序。
  float order = ry + z * 0.3;
  float depth = clamp(0.5 - order * 0.5, 0.0001, 0.9999) * 2.0 - 1.0;
  gl_Position = vec4(ndc, depth, 1.0);

  vSlope = aSlope;
  vElevT = (aElevation - uMinElevation) / max(1.0, uMaxElevation - uMinElevation);
  vFogT = 1.0 / perspective;
  vUv = aUv;
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vSlope;
in float vElevT;
in float vFogT;
in vec2 vUv;

uniform sampler2D uColorMap;
uniform sampler2D uShadowMap;
uniform float uShadowEnabled;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uDiffuse;
uniform float uMinLight;
uniform float uMaxLight;
uniform float uZFactor;
uniform float uBrightness;
uniform vec3 uFogColor;
uniform float uFogStrength;
uniform float uInvMin;
uniform float uInvMax;

out vec4 fragColor;

void main() {
  vec3 base = texture(uColorMap, vec2(clamp(vElevT, 0.0, 1.0), 0.5)).rgb;

  // 与 terrainRendering.hillshade() 相同的方向光模型，但法线在片元阶段插值，
  // 因此放大后不会再出现逐面片的明暗台阶。
  vec2 slope = vSlope * uZFactor;
  vec3 normal = normalize(vec3(-slope.x, -slope.y, 1.0));
  // 自阴影只削弱直射分量；未开启时 mix 回 1.0，保持原有明暗。
  float shadow = mix(1.0, texture(uShadowMap, vUv).r, uShadowEnabled);
  float illumination = max(dot(normal, normalize(uLightDir)), 0.0) * shadow;
  float shade = clamp(uAmbient + uDiffuse * illumination, uMinLight, uMaxLight);

  vec3 lit = clamp(base * shade * uBrightness, 0.0, 1.0);

  float fog = 0.0;
  if (uFogStrength > 0.0) {
    float t = clamp((vFogT - uInvMin) / max(0.000001, uInvMax - uInvMin), 0.0, 1.0);
    fog = uFogStrength * pow(t, 1.35);
  }

  fragColor = vec4(mix(lit, uFogColor, fog), 1.0);
}
`

const MAX_VOLUME_STEPS = 1024

/**
 * Conservative upper bound for the number of cells crossed by a view ray.
 * Matching the Cesium marcher here prevents range/azimuth cells from being
 * skipped when the depth dimension happens to be much smaller.
 */
export function terrainVolumeMarchStepCount(volume = {}) {
  const rangeCells = Math.max(1, (Number(volume.width) || 2) - 1)
  const angleCells = Math.max(1, (Number(volume.height) || 2) - 1)
  const depthCells = Math.max(1, (Number(volume.depth) || 2) - 1)
  const crossedCells = Math.hypot(rangeCells, angleCells, depthCells)
  const strictNearest = volume.strictNearest === true
  const cellStep = strictNearest ? 0.48 : 0.72
  const maxSteps = strictNearest ? MAX_VOLUME_STEPS : 512
  return clamp(Math.ceil(crossedCells / cellStep), 64, maxSteps)
}

const VOLUME_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vNdc;
void main() {
  // Full-screen proxy: the fragment shader marches the view ray per pixel.
  vNdc = aPosition;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const VOLUME_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vNdc;

uniform sampler3D uVolumeTexture;
uniform sampler2D uHeightMap;
uniform sampler2D uColorLut;
uniform float uWidth;
uniform float uHeight;
uniform float uScale;
uniform float uPanX;
uniform float uPanY;
uniform float uCosYaw;
uniform float uSinYaw;
uniform float uCosPitch;
uniform float uSinPitch;
uniform float uExaggeration;
uniform float uHorizontalSpanM;
uniform vec2 uScreenMin;
uniform vec2 uScreenMax;
uniform float uSMin;
uniform float uSMax;
uniform float uSteps;
uniform vec4 uGeo;
uniform vec4 uTerrain;
uniform vec4 uWedge;
uniform vec4 uPath;
uniform vec2 uValue;
uniform vec2 uDb;
// x = 基础透明度，y = 体密度倍率，z = TL 色彩对比度倍率，w = 边缘锐度倍率。
uniform vec4 uAlpha;
uniform vec3 uClipInfo;
uniform float uFeatherM;
// 信号余量派生模式：x=启用, y=常数偏移(SL-NL-DT+AG), z=目标最小深度, w=最大深度
uniform vec4 uExcess;
// x=Pd 模式(0/1), y=σ, z=三色探测分级(0/1)
uniform vec3 uExcessMode;
uniform int uHasBottomDepth;
uniform int uStrictNearest;
uniform int uDebugNoTerrain;

out vec4 fragColor;

/** 标准正态累积分布 Φ(z)，与 utils/signalExcess.js 的近似式一致。 */
float normalCdf(float z) {
  float t = 1.0 / (1.0 + 0.2316419 * abs(z));
  float d = 0.3989422804014327 * exp(-z * z * 0.5);
  float cdf = 1.0 - d * t * (0.319381530
    + t * (-0.356563782
      + t * (1.781477937
        + t * (-1.821255978
          + t * 1.330274429))));
  return z >= 0.0 ? cdf : 1.0 - cdf;
}

float sampleTerrainElevation(vec2 uv) {
  ivec2 size = textureSize(uHeightMap, 0);
  vec2 texel = clamp(
    clamp(uv, vec2(0.0), vec2(1.0)) * vec2(size) - 0.5,
    vec2(0.0),
    vec2(size - 1)
  );
  ivec2 p0 = ivec2(floor(texel));
  ivec2 p1 = min(p0 + 1, size - 1);
  vec2 f = fract(texel);
  float h00 = texelFetch(uHeightMap, p0, 0).r;
  float h10 = texelFetch(uHeightMap, ivec2(p1.x, p0.y), 0).r;
  float h01 = texelFetch(uHeightMap, ivec2(p0.x, p1.y), 0).r;
  float h11 = texelFetch(uHeightMap, p1, 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

bool projectSample(float s, vec2 screen, out vec3 geoDepth) {
  float cx = uWidth * 0.5 + uPanX;
  float cy = uHeight * 0.40 + uPanY;
  float k = 0.35 * abs(uCosPitch);
  float sx = screen.x - cx;
  float sy = screen.y - cy;
  float denom = max(0.0001, 1.0 + k * sy * uSinPitch / max(0.0001, uScale));
  float d = (1.0 - k * s * uCosPitch) / denom;
  if (d <= 0.0) return false;
  float rx = sx * d / max(0.0001, uScale);
  float q = sy * d / max(0.0001, uScale);
  float ry = s * uCosPitch + q * uSinPitch;
  float z = s * uSinPitch - q * uCosPitch;
  float x = rx * uCosYaw + ry * uSinYaw;
  float y = -rx * uSinYaw + ry * uCosYaw;
  geoDepth = vec3(
    uGeo.x + x * uGeo.z / max(1e-9, uGeo.w),
    uGeo.y - y * uGeo.z,
    -z * uHorizontalSpanM / max(0.0001, uExaggeration)
  );
  return true;
}

float sampleBearing(float lon, float lat) {
  float srcLatRad = radians(uWedge.y);
  float latRad = radians(lat);
  float dLonRad = radians(lon - uWedge.x);
  float bearingY = sin(dLonRad) * cos(latRad);
  float bearingX = cos(srcLatRad) * sin(latRad)
    - sin(srcLatRad) * cos(latRad) * cos(dLonRad);
  return degrees(atan(bearingY, bearingX));
}

float sampleRangeM(float lon, float lat) {
  float cosSrcLat = max(0.01, cos(radians(uWedge.y)));
  float east = (lon - uWedge.x) * 111320.0 * cosSrcLat;
  float north = (lat - uWedge.y) * 110574.0;
  return length(vec2(east, north));
}

bool isClippedBearing(float bearing) {
  float compassDelta = mod(bearing - uClipInfo.y + 360.0, 360.0);
  return uClipInfo.x > 0.5 && compassDelta > 0.0001 && compassDelta < 180.0;
}

void main() {
  vec2 screen = vec2((vNdc.x * 0.5 + 0.5) * uWidth, (0.5 - vNdc.y * 0.5) * uHeight);
  if (screen.x < uScreenMin.x || screen.x > uScreenMax.x ||
      screen.y < uScreenMin.y || screen.y > uScreenMax.y) discard;

  float steps = max(8.0, uSteps);
  float span = max(1e-6, uSMax - uSMin);
  float ds = span / steps;
  float blueNoiseJitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  // Random per-pixel offsets turn nearest-neighbor range rings into a visible
  // stipple pattern. Sample cell centres in strict mode; retain de-correlation
  // only for the continuously interpolated display mode.
  float jitter = uStrictNearest == 1 ? 0.5 : blueNoiseJitter;
  ivec3 textureShape = textureSize(uVolumeTexture, 0);
  int angleRows = textureShape.y;
  bool hasClippedSample = false;
  float clippedS = uSMax;
  bool hasRangeOutsideSample = false;
  float rangeOutsideS = uSMax;

  // March from near (uSMax) to far (uSMin) and composite front-to-back like
  // Cesium's wedge renderer. A first-hit opaque shell made the acoustic body
  // look like a solid slab; accumulating small per-step alpha instead reads as
  // a translucent cloud and lets the seabed transition fade out naturally.
  vec3 accumColor = vec3(0.0);
  float accumAlpha = 0.0;
  float nearOrder = 0.0;
  bool hasNearDepth = false;
  float opacity = clamp(uAlpha.x, 0.0, 1.0);
  float density = clamp(uAlpha.y, 0.25, 8.0);
  float contrast = clamp(uAlpha.z, 0.5, 3.0);
  float edgeSharpness = clamp(uAlpha.w, 0.5, 4.0);
  if (opacity <= 0.003) discard;
  // Optical density per full ray length; keeps opacity stable across zoom/angle.
  const float STEP_DENSITY = 2.4;

  for (int i = 0; i < ${MAX_VOLUME_STEPS}; i++) {
    if (float(i) >= steps) break;
    float s = uSMax - (float(i) + jitter) * ds;

    vec3 geoDepth;
    if (!projectSample(s, screen, geoDepth)) continue;
    float lon = geoDepth.x;
    float lat = geoDepth.y;
    float depthM = geoDepth.z;

    float bearing = sampleBearing(lon, lat);
    if (isClippedBearing(bearing)) {
      clippedS = s;
      hasClippedSample = true;
      continue;
    }

    // The first retained sample after the discarded half is moved to the
    // mathematical clip plane. Without this bracket search, a nearest-neighbor
    // ray step leaves a jagged radial seam at oblique camera angles.
    if (uClipInfo.x > 0.5 && hasClippedSample) {
      float outsideS = clippedS;
      float insideS = s;
      for (int cutStep = 0; cutStep < 8; cutStep++) {
        float middleS = mix(outsideS, insideS, 0.5);
        vec3 middleGeoDepth;
        if (!projectSample(middleS, screen, middleGeoDepth)) {
          outsideS = middleS;
          continue;
        }
        if (isClippedBearing(sampleBearing(middleGeoDepth.x, middleGeoDepth.y))) {
          outsideS = middleS;
        } else {
          insideS = middleS;
        }
      }
      s = insideS;
      if (!projectSample(s, screen, geoDepth)) continue;
      lon = geoDepth.x;
      lat = geoDepth.y;
      depthM = geoDepth.z;
      bearing = sampleBearing(lon, lat);
      hasClippedSample = false;
    }

    float rangeM = sampleRangeM(lon, lat);
    if (rangeM > uPath.y) {
      rangeOutsideS = s;
      hasRangeOutsideSample = true;
      continue;
    }

    // Locate the cylindrical entry surface instead of coloring the first
    // arbitrary march sample after it. This keeps nearest depth/range indices
    // stable across adjacent pixels and removes contour-like side-wall noise.
    if (hasRangeOutsideSample) {
      float outsideS = rangeOutsideS;
      float insideS = s;
      for (int rangeStep = 0; rangeStep < 8; rangeStep++) {
        float middleS = mix(outsideS, insideS, 0.5);
        vec3 middleGeoDepth;
        if (!projectSample(middleS, screen, middleGeoDepth)
            || sampleRangeM(middleGeoDepth.x, middleGeoDepth.y) > uPath.y) {
          outsideS = middleS;
        } else {
          insideS = middleS;
        }
      }
      s = insideS;
      if (!projectSample(s, screen, geoDepth)) continue;
      lon = geoDepth.x;
      lat = geoDepth.y;
      depthM = geoDepth.z;
      bearing = sampleBearing(lon, lat);
      rangeM = sampleRangeM(lon, lat);
      hasRangeOutsideSample = false;
    }

    vec2 terrainUv = vec2(
      (lon - uTerrain.x) / max(1e-9, uTerrain.y - uTerrain.x),
      (uTerrain.w - lat) / max(1e-9, uTerrain.w - uTerrain.z)
    );
    if (terrainUv.x < 0.0 || terrainUv.x > 1.0 || terrainUv.y < 0.0 || terrainUv.y > 1.0) continue;
    float terrainElev = sampleTerrainElevation(terrainUv);
    float waterDepth = max(0.0, -terrainElev);
    if (uDebugNoTerrain == 0 && depthM >= waterDepth) continue;

    float angleSpan = max(0.001, uWedge.w - uWedge.z);
    float angleNorm = mod(bearing - uWedge.z + 720.0, 360.0) / angleSpan;
    if (angleNorm < 0.0 || angleNorm > 1.0) continue;
    float pathNorm = clamp((rangeM - uPath.x) / max(1.0, uPath.y - uPath.x), 0.0, 1.0);
    float firstCellM = (uPath.y - uPath.x) / max(1.0, float(textureShape.x - 1));
    if (rangeM <= max(uPath.x, firstCellM * 0.5)) {
      pathNorm = 0.0;
      angleNorm = 0.0;
    }
    if (depthM < uPath.z || depthM > uPath.w) continue;
    // Signal-excess mode only keeps the target depth band, matching the SE field.
    if (uExcess.x > 0.5 && (depthM < uExcess.z || depthM > uExcess.w)) continue;
    float depthNorm = (depthM - uPath.z) / max(1.0, uPath.w - uPath.z);

    int rangeIndex = clamp(
      int(floor(pathNorm * float(textureShape.x - 1) + 0.5)),
      0,
      textureShape.x - 1
    );
    int angleIndex = int(floor(angleNorm * float(angleRows) + 0.5)) % angleRows;
    int depthIndex = clamp(
      int(floor(depthNorm * float(textureShape.z - 1) + 0.5)),
      0,
      textureShape.z - 1
    );
    vec4 voxel;
    if (uStrictNearest == 1) {
      voxel = texelFetch(uVolumeTexture, ivec3(rangeIndex, angleIndex, depthIndex), 0);
    } else {
      voxel = texture(
        uVolumeTexture,
        clamp(vec3(pathNorm, angleNorm, depthNorm), vec3(0.001), vec3(0.999))
      );
    }

    // The acoustic bottom (G channel) can sit above the displayed seabed, which
    // made the body stop in mid-water and look like it was floating. Drape the
    // visual bottom onto the sampled seabed instead, capped at the data depth.
    // Where the terrain is deeper than the acoustic bottom, reuse the last valid
    // TL layer (the Canvas renderer's bottomTl fallback) and taper it so the
    // extended part reads as a soft seafloor contact rather than a solid column.
    float dataBottomM = uHasBottomDepth == 1
      ? mix(uPath.z, uPath.w, voxel.g)
      : uPath.w;
    float visualBottomM = dataBottomM;
    float bottomTaper = 1.0;
    if (uDebugNoTerrain == 0) {
      visualBottomM = min(waterDepth, uPath.w);
      if (depthM > dataBottomM) {
        float bottomNorm = clamp(
          (dataBottomM - uPath.z) / max(1.0, uPath.w - uPath.z), 0.0, 1.0
        );
        int bottomIndex = clamp(
          int(floor(bottomNorm * float(textureShape.z - 1) + 0.5)),
          0,
          textureShape.z - 1
        );
        if (uStrictNearest == 1) {
          voxel = texelFetch(uVolumeTexture, ivec3(rangeIndex, angleIndex, bottomIndex), 0);
        } else {
          voxel = texture(
            uVolumeTexture,
            clamp(vec3(pathNorm, angleNorm, bottomNorm), vec3(0.001), vec3(0.999))
          );
        }
        bottomTaper = mix(
          1.0, 0.35,
          smoothstep(dataBottomM, max(dataBottomM + 1.0, visualBottomM), depthM)
        );
      }
    }
    if (depthM >= visualBottomM) continue;

    float coverage = smoothstep(0.015, 0.92, voxel.a);
    vec3 volumeCoord = vec3(pathNorm, angleNorm, depthNorm);
    vec3 edgeWidth = min(
      vec3(0.12),
      vec3(1.5) / max(vec3(textureShape), vec3(1.0))
    );
    vec3 edgeLow = smoothstep(vec3(0.0), edgeWidth, volumeCoord);
    vec3 edgeHigh = smoothstep(vec3(0.0), edgeWidth, vec3(1.0) - volumeCoord);
    float angleEdge = angleSpan >= 359.5 ? 1.0 : edgeLow.y * edgeHigh.y;
    float rangeEdge = uStrictNearest == 1 ? 1.0 : edgeHigh.x;
    // Feather both depth ends like Cesium so the water-surface cap and the deep
    // cap are soft slices instead of hard discs.
    coverage *= min(min(rangeEdge, angleEdge), edgeLow.z * edgeHigh.z);
    // Feather the draped bottom into the seabed so the contact is soft and free
    // of z-fighting while still reaching the terrain.
    coverage *= bottomTaper * smoothstep(0.0, max(8.0, uFeatherM), visualBottomM - depthM);
    // Signal-excess band edges: keep only the target depth window but soften the
    // top/bottom so the switched-on SE body does not look like a hard slab.
    if (uExcess.x > 0.5) {
      float bandFeather = max(8.0, uFeatherM);
      coverage *= smoothstep(0.0, bandFeather, depthM - uExcess.z);
      coverage *= smoothstep(0.0, bandFeather, uExcess.w - depthM);
    }
    // 仅改变边界覆盖度，不参与 TL 数值及色带映射。
    coverage = pow(clamp(coverage, 0.0, 1.0), edgeSharpness);
    if (coverage <= 0.001) continue;
    float tl = mix(uValue.x, uValue.y, voxel.r);
    // Signal excess is a per-voxel transform of TL: SE = offset - TL, optionally
    // mapped to detection probability Pd = Φ(SE/σ). Derived in-shader so the
    // existing GPU TL texture can be reused without a second 3D texture.
    float value = tl;
    float detectionProbability = -1.0;
    if (uExcess.x > 0.5) {
      float se = uExcess.y - tl;
      detectionProbability = normalCdf(se / max(1e-6, uExcessMode.y)) * 100.0;
      if (uExcessMode.x > 0.5) {
        value = detectionProbability;
      } else {
        value = se;
      }
    }
    // uDb is a color-mapping range, not a visibility filter. Values above the
    // selected upper bound remain visible and use the last LUT color.
    float displayRatio = clamp((value - uDb.x) / max(1.0, uDb.y - uDb.x), 0.0, 1.0);
    if (uStrictNearest == 0) displayRatio = pow(displayRatio, 0.82);
    displayRatio = clamp((displayRatio - 0.5) * contrast + 0.5, 0.0, 1.0);
    vec3 color;
    if (uExcessMode.z > 0.5) {
      if (detectionProbability < 25.0) continue;
      color = detectionProbability < 50.0
        ? vec3(0.0)
        : detectionProbability <= 75.0 ? vec3(1.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    } else {
      color = texture(uColorLut, vec2(displayRatio, 0.5)).rgb;
    }

    // Remember the first contributing sample's projected depth so the terrain
    // depth buffer can still let foreground ridges occlude the acoustic body.
    if (!hasNearDepth) {
      float hitX = (lon - uGeo.x) * uGeo.w / max(1e-9, uGeo.z);
      float hitY = (uGeo.y - lat) / max(1e-9, uGeo.z);
      float hitZ = -depthM * uExaggeration / max(1.0, uHorizontalSpanM);
      nearOrder = hitX * uSinYaw + hitY * uCosYaw + hitZ * 0.3;
      hasNearDepth = true;
    }

    // Alpha is normalised by the marched span, so the total optical depth stays
    // constant regardless of zoom or camera angle.
    float stepAlpha = clamp(opacity * density * coverage * STEP_DENSITY * ds / span, 0.0, 1.0);
    accumColor += (1.0 - accumAlpha) * color * stepAlpha;
    accumAlpha += (1.0 - accumAlpha) * stepAlpha;
    if (accumAlpha >= 0.985) break;
  }
  if (accumAlpha <= 0.002) discard;
  // Terrain has already populated the depth buffer. Writing the near-entry
  // pseudo-depth keeps foreground relief in front while the composited body
  // stays visible through open water.
  gl_FragDepth = clamp(0.5 - nearOrder * 0.5, 0.0001, 0.9999);
  // Un-premultiply for straight-alpha blending.
  fragColor = vec4(accumColor / accumAlpha, accumAlpha);
}
`

const VOLUME_UNIFORM_NAMES = [
  'uVolumeTexture', 'uHeightMap', 'uColorLut',
  'uWidth', 'uHeight', 'uScale', 'uPanX', 'uPanY',
  'uCosYaw', 'uSinYaw', 'uCosPitch', 'uSinPitch',
  'uExaggeration', 'uHorizontalSpanM',
  'uScreenMin', 'uScreenMax', 'uSMin', 'uSMax', 'uSteps',
  'uGeo', 'uTerrain', 'uWedge', 'uPath', 'uValue', 'uDb', 'uAlpha',
  'uClipInfo', 'uFeatherM', 'uExcess', 'uExcessMode', 'uHasBottomDepth', 'uStrictNearest', 'uDebugNoTerrain',
]
const UNIFORM_NAMES = [
  'uWidth', 'uHeight', 'uScale', 'uPanX', 'uPanY',
  'uCosYaw', 'uSinYaw', 'uCosPitch', 'uSinPitch', 'uExaggeration',
  'uMinElevation', 'uMaxElevation',
  'uColorMap', 'uLightDir', 'uAmbient', 'uDiffuse', 'uMinLight', 'uMaxLight',
  'uZFactor', 'uBrightness', 'uFogColor', 'uFogStrength', 'uInvMin', 'uInvMax',
  'uShadowMap', 'uShadowEnabled',
]

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`地形着色器编译失败：${log || '未知错误'}`)
  }
  return shader
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`地形着色器链接失败：${log || '未知错误'}`)
  }
  return program
}

function colorChannel(value, fallback) {
  const number = Number(value)
  return clamp(Number.isFinite(number) ? number : fallback, 0, 255) / 255
}

/**
 * GPU 地形底图：逐片元光照 + 一维色带纹理。
 *
 * 投影公式与 terrainScene.createTerrainProjection 完全一致，因此 2D canvas
 * 上的声线、声场、AIS、参考轴等叠加层无需改动即可对齐。
 */
export class TerrainWebGLRenderer {
  constructor(canvas) {
    if (!canvas) throw new Error('缺少地形 WebGL canvas')
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('浏览器未提供 WebGL2 上下文')

    this.canvas = canvas
    this.gl = gl
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
    this.uniforms = {}
    gl.useProgram(this.program)
    for (const name of UNIFORM_NAMES) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name)
    }

    // GPU 体渲染：切片式三维纹理采样，失败时自动回退到 Canvas 声场体。
    this.volumeProgram = null
    this.volumeUniforms = {}
    try {
      this.volumeProgram = createProgram(gl, VOLUME_VERTEX_SHADER, VOLUME_FRAGMENT_SHADER)
      for (const name of VOLUME_UNIFORM_NAMES) {
        this.volumeUniforms[name] = gl.getUniformLocation(this.volumeProgram, name)
      }
    } catch (error) {
      console.warn('[terrain] GPU 体渲染着色器不可用，回退到 Canvas 声场：', error?.message ?? error)
      this.volumeProgram = null
    }
    this.volumeActive = false
    // Per-layer 3D textures (keyed by the volume descriptor object) so the
    // current field and every visible historical field can be ray-marched with
    // the GPU instead of falling back to the blocky Canvas mesh.
    this.volumeTextures = new Map()
    this.renderedVolumeIds = []
    this.heightTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture)
    // R32F terrain is sampled with explicit bilinear texelFetch in the volume shader,
    // avoiding both 8-bit elevation banding and float-linear extension requirements.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.heightGrid = null
    this.colorLutTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.colorLutTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.colorLutKey = null
    this.volumeGeometry = null
    this.volumeGeometryKey = null

    this.geometry = null
    this.colorKey = null
    this.disposed = false
    this.contextLost = false

    this.colorTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    // 自阴影掩膜纹理；默认 1×1 全白，关闭阴影时仍可安全采样。
    this.shadowMask = null
    this.shadowTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]),
    )

    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)

    this.onContextLost = event => {
      event.preventDefault()
      this.contextLost = true
    }
    canvas.addEventListener('webglcontextlost', this.onContextLost, false)
  }

  disposeGeometry() {
    const gl = this.gl
    if (!this.geometry) return
    gl.deleteVertexArray(this.geometry.vao)
    for (const buffer of this.geometry.buffers) gl.deleteBuffer(buffer)
    gl.deleteBuffer(this.geometry.indexBuffer)
    this.geometry = null
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost, false)
    this.disposeGeometry()
    this.disposeVolumeGeometry()
    if (this.colorTexture) this.gl.deleteTexture(this.colorTexture)
    if (this.shadowTexture) this.gl.deleteTexture(this.shadowTexture)
    if (this.volumeTextures) {
      for (const entry of this.volumeTextures.values()) this.gl.deleteTexture(entry.texture)
      this.volumeTextures.clear()
    }
    if (this.heightTexture) this.gl.deleteTexture(this.heightTexture)
    if (this.colorLutTexture) this.gl.deleteTexture(this.colorLutTexture)
    if (this.program) this.gl.deleteProgram(this.program)
    if (this.volumeProgram) this.gl.deleteProgram(this.volumeProgram)
    this.colorTexture = null
    this.shadowTexture = null
    this.volumeTextures = null
    this.heightTexture = null
    this.colorLutTexture = null
    this.shadowMask = null
    this.program = null
    this.volumeProgram = null
  }

  disposeVolumeGeometry() {
    const gl = this.gl
    if (!this.volumeGeometry) return
    gl.deleteVertexArray(this.volumeGeometry.vao)
    gl.deleteBuffer(this.volumeGeometry.buffer)
    this.volumeGeometry = null
  }

  buildGeometry(grid) {
    const gl = this.gl
    this.disposeGeometry()

    const segments = Math.max(1, Math.min(
      TERRAIN_MAX_MESH_SEGMENTS,
      grid.width - 1,
      grid.height - 1,
    ))
    const mesh = terrainMesh(grid, segments)
    if (!mesh.faces.length) return

    const b = grid.bounds
    const cosLat = Math.max(.1, Math.cos((b.north + b.south) * Math.PI / 360))
    const spanX = (b.east - b.west) * cosLat
    const spanY = b.north - b.south
    const span = Math.max(1e-9, Math.max(spanX, spanY))
    const horizontalSpanM = Math.max(1, span * 110574)
    const centerLon = (b.west + b.east) / 2
    const centerLat = (b.south + b.north) / 2

    const count = mesh.vertices.length
    const position = new Float32Array(count * 3)
    const slope = new Float32Array(count * 2)
    const elevation = new Float32Array(count)
    const uv = new Float32Array(count * 2)
    const lonSpan = Math.max(1e-9, b.east - b.west)
    const latSpan = Math.max(1e-9, b.north - b.south)

    mesh.vertices.forEach((vertex, index) => {
      position[index * 3] = (vertex.lon - centerLon) * cosLat / span
      position[index * 3 + 1] = (centerLat - vertex.lat) / span
      position[index * 3 + 2] = vertex.elevation / horizontalSpanM

      slope[index * 2] = Number.isFinite(vertex.slopeX) ? vertex.slopeX : 0
      slope[index * 2 + 1] = Number.isFinite(vertex.slopeY) ? vertex.slopeY : 0
      // 海面 ±0.x m 噪声按海陆掩膜夹到 0，避免色带在海岸处抖动。
      elevation[index] = vertex.sea
        ? Math.min(vertex.elevation, 0)
        : Math.max(vertex.elevation, 0)
      // 阴影掩膜纹理坐标：u 西→东，v 北→南，与 terrainShadowMask 的行列顺序一致。
      uv[index * 2] = (vertex.lon - b.west) / lonSpan
      uv[index * 2 + 1] = (b.north - vertex.lat) / latSpan
    })

    const indices = new Uint32Array(mesh.faces.length * 6)
    mesh.faces.forEach((face, index) => {
      const offset = index * 6
      indices[offset] = face[0]
      indices[offset + 1] = face[1]
      indices[offset + 2] = face[2]
      indices[offset + 3] = face[0]
      indices[offset + 4] = face[2]
      indices[offset + 5] = face[3]
    })

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)

    const buffers = []
    const addAttribute = (location, size, data) => {
      const buffer = gl.createBuffer()
      buffers.push(buffer)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
    }

    addAttribute(0, 3, position)
    addAttribute(1, 2, slope)
    addAttribute(2, 1, elevation)
    addAttribute(3, 2, uv)

    const indexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)

    gl.bindVertexArray(null)

    this.geometry = { grid, vao, buffers, indexBuffer, count: indices.length }
  }

  ensureColorLut(grid, controls) {
    const gl = this.gl
    const showBands = controls?.terrainBands === true
    const min = Number.isFinite(Number(grid.min)) ? Number(grid.min) : -1
    const max = Number.isFinite(Number(grid.max)) ? Number(grid.max) : 1
    const key = `${min}:${max}:${showBands ? 1 : 0}`
    if (this.colorKey === key) return

    const size = 1024
    const data = new Uint8Array(size * 4)
    const landSpan = Math.max(0, max)
    const waterSpan = Math.max(0, -Math.min(0, min))
    const landBand = showBands ? pickBandStep(landSpan, 12) : 0
    const waterBand = showBands ? pickBandStep(waterSpan, 12) : 0

    for (let index = 0; index < size; index++) {
      const ratio = index / (size - 1)
      const value = min + (max - min) * ratio
      const [r, g, b] = terrainColorAt(value, min, max, { landBand, waterBand })
      const offset = index * 4
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = 255
    }

    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8, size, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data,
    )
    this.colorKey = key
  }

  ensureShadowTexture(grid, azimuthDeg, altitudeDeg, exaggeration) {
    const mask = terrainShadowMask(grid, azimuthDeg, altitudeDeg, exaggeration)
    if (!mask) return false
    if (mask === this.shadowMask) return true
    const gl = this.gl
    const data = new Uint8Array(mask.values.length)
    for (let index = 0; index < mask.values.length; index++) {
      data[index] = Math.round(clamp(mask.values[index], 0, 1) * 255)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0, gl.RED, gl.UNSIGNED_BYTE, data,
    )
    this.shadowMask = mask
    return true
  }

  ensureHeightTexture(grid) {
    if (this.heightGrid === grid) return
    const gl = this.gl
    const width = Math.max(1, Number(grid.width) || 1)
    const height = Math.max(1, Number(grid.height) || 1)
    const data = new Float32Array(width * height)
    for (let index = 0; index < data.length; index++) {
      const value = Number(grid.values?.[index])
      data[index] = Number.isFinite(value) ? value : 0
    }
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data)
    this.heightGrid = grid
  }

  ensureVolumeColorLut(controls) {
    const gl = this.gl
    const stops = Array.isArray(controls?.colorStops) && controls.colorStops.length >= 2
      ? controls.colorStops
      : [[0, [255, 40, 0]], [1, [0, 0, 127]]]
    const key = JSON.stringify(stops)
    if (this.colorLutKey === key) return
    const size = 256
    const data = new Uint8Array(size * 4)
    for (let index = 0; index < size; index++) {
      const t = index / (size - 1)
      let color = stops[stops.length - 1][1]
      for (let segment = 0; segment < stops.length - 1; segment++) {
        const [start, startColor] = stops[segment]
        const [end, endColor] = stops[segment + 1]
        if (t > end && segment < stops.length - 2) continue
        const ratio = clamp((t - start) / Math.max(1e-6, end - start), 0, 1)
        color = startColor.map((channel, channelIndex) =>
          Math.round(channel + (endColor[channelIndex] - channel) * ratio))
        break
      }
      data[index * 4] = clamp(Number(color?.[0]) || 0, 0, 255)
      data[index * 4 + 1] = clamp(Number(color?.[1]) || 0, 0, 255)
      data[index * 4 + 2] = clamp(Number(color?.[2]) || 0, 0, 255)
      data[index * 4 + 3] = 255
    }
    gl.bindTexture(gl.TEXTURE_2D, this.colorLutTexture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    this.colorLutKey = key
  }

  ensureVolumeTexture(volume) {
    if (!volume?.data || !(volume.width > 0) || !(volume.height > 0) || !(volume.depth > 0)) return null
    if (!this.volumeTextures) this.volumeTextures = new Map()
    const gl = this.gl
    const meta = volume.wedgeMeta ?? {}
    const key = `${volume.width}x${volume.height}x${volume.depth}:${volume.textureFilter}:${volume.valueMin}:${volume.valueMax}:${meta.sourceLon},${meta.sourceLat},${meta.pathMinM},${meta.pathMaxM},${meta.angleMin},${meta.angleMax},${meta.depthMinM},${meta.depthMaxM}`
    let entry = this.volumeTextures.get(volume)
    if (!entry) {
      entry = { texture: gl.createTexture(), key: null, dataRef: null }
      this.volumeTextures.set(volume, entry)
    }
    if (entry.key === key && entry.dataRef === volume.data) return entry.texture
    gl.bindTexture(gl.TEXTURE_3D, entry.texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.RGBA8,
      volume.width, volume.height, volume.depth, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, volume.data,
    )
    // 与主三维体一致：严格最近邻时不做任何插值。平滑纹理已经包含一行
    // 360° 重复尾值，因此使用 CLAMP_TO_EDGE，避免尾行再次跨边界混合。
    const filter = volume.textureFilter === 'nearest' ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    entry.key = key
    entry.dataRef = volume.data
    return entry.texture
  }

  ensureVolumeGeometry() {
    if (this.volumeGeometry) return
    const gl = this.gl
    // Full-screen proxy quad in NDC; fragment shader marches only inside the
    // volume's projected screen AABB.
    const data = new Float32Array([
      -1, -1, 1, -1, 1, 1,
      -1, -1, 1, 1, -1, 1,
    ])
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0)
    gl.bindVertexArray(null)
    this.volumeGeometry = { vao, buffer, count: 6 }
    this.volumeGeometryKey = 'fullscreen'
  }

  renderVolume(grid, volume, controls, view, clip = null) {
    const gl = this.gl
    if (!this.volumeProgram || !volume) return false
    // TerrainPreviewMode computes alphaScale with the same 0..1 normalizer used
    // by the Cesium renderer. Prefer that shared runtime value so switching
    // views cannot leave the regional GPU pass one opacity update behind.
    const opacityValue = Number.isFinite(Number(controls?.alphaScale))
      ? Number(controls.alphaScale)
      : Number(controls?.opacity)
    const opacity = clamp(
      Number.isFinite(opacityValue) ? opacityValue : 1,
      0,
      1,
    )
    if (opacity <= 0) return false
    const volumeTexture = this.ensureVolumeTexture(volume)
    if (!volumeTexture) return false
    this.ensureHeightTexture(grid)
    this.ensureVolumeColorLut(controls)
    this.ensureVolumeGeometry()
    if (!this.volumeGeometry) return false

    // Only the active field (the one carrying the direction line) is clipped
    // when the body is cut in half; other visible fields stay whole.
    const clipVolume = clip === null ? controls?.clipGpuVolume === true : clip === true

    const meta = volume.wedgeMeta ?? {}
    const b = grid.bounds
    const u = this.volumeUniforms
    gl.useProgram(this.volumeProgram)

    const centerLon = (b.west + b.east) / 2
    const centerLat = (b.south + b.north) / 2
    const lonMin = Number.isFinite(Number(volume.lonMin)) ? Number(volume.lonMin) : b.west
    const lonMax = Number.isFinite(Number(volume.lonMax)) ? Number(volume.lonMax) : b.east
    const latMin = Number.isFinite(Number(volume.latMin)) ? Number(volume.latMin) : b.south
    const latMax = Number.isFinite(Number(volume.latMax)) ? Number(volume.latMax) : b.north
    const localXMin = (lonMin - centerLon) * view.cosLat / view.span
    const localXMax = (lonMax - centerLon) * view.cosLat / view.span
    const localYMin = (centerLat - latMax) / view.span
    const localYMax = (centerLat - latMin) / view.span
    const depthMin = Number(meta.depthMinM) || 0
    const depthMax = Math.max(depthMin + 1, Number(meta.depthMaxM) || depthMin + 1)
    const zTop = -depthMin / view.horizontalSpanM * view.exaggeration
    const zBottom = -depthMax / view.horizontalSpanM * view.exaggeration
    const k = 0.35 * Math.abs(view.cosPitch)
    let sxMin = Infinity, sxMax = -Infinity, syMin = Infinity, syMax = -Infinity
    let sMin = Infinity, sMax = -Infinity
    for (const x of [localXMin, localXMax]) {
      for (const y of [localYMin, localYMax]) {
        for (const z of [zBottom, zTop]) {
          const rx = x * view.cosYaw - y * view.sinYaw
          const ry = x * view.sinYaw + y * view.cosYaw
          const persp = 1 / Math.max(0.0001, 1 - ry * k)
          const sx = view.width * 0.5 + view.panX + rx * view.scale * persp
          const sy = view.height * 0.40 + view.panY + (ry * view.sinPitch - z * view.cosPitch) * view.scale * persp
          const s = ry * view.cosPitch + z * view.sinPitch
          if (sx < sxMin) sxMin = sx
          if (sx > sxMax) sxMax = sx
          if (sy < syMin) syMin = sy
          if (sy > syMax) syMax = sy
          if (s < sMin) sMin = s
          if (s > sMax) sMax = s
        }
      }
    }
    if (!(sMax > sMin)) return false

    gl.uniform1f(u.uWidth, view.width)
    gl.uniform1f(u.uHeight, view.height)
    gl.uniform1f(u.uScale, view.scale)
    gl.uniform1f(u.uPanX, view.panX)
    gl.uniform1f(u.uPanY, view.panY)
    gl.uniform1f(u.uCosYaw, view.cosYaw)
    gl.uniform1f(u.uSinYaw, view.sinYaw)
    gl.uniform1f(u.uCosPitch, view.cosPitch)
    gl.uniform1f(u.uSinPitch, view.sinPitch)
    gl.uniform1f(u.uExaggeration, view.exaggeration)
    gl.uniform1f(u.uHorizontalSpanM, view.horizontalSpanM)
    gl.uniform2f(u.uScreenMin, sxMin - 2, syMin - 2)
    gl.uniform2f(u.uScreenMax, sxMax + 2, syMax + 2)
    gl.uniform1f(u.uSMin, sMin)
    gl.uniform1f(u.uSMax, sMax)
    const stepCount = terrainVolumeMarchStepCount(volume)
    gl.uniform1f(u.uSteps, stepCount)
    gl.uniform4f(u.uGeo, centerLon, centerLat, view.span, view.cosLat)
    gl.uniform4f(u.uTerrain, b.west, b.east, b.south, b.north)
    gl.uniform4f(
      u.uWedge,
      Number(meta.sourceLon) || 0,
      Number(meta.sourceLat) || 0,
      Number.isFinite(Number(meta.angleMin)) ? Number(meta.angleMin) : 0,
      Number.isFinite(Number(meta.angleMax)) ? Number(meta.angleMax) : 360,
    )
    gl.uniform4f(
      u.uPath,
      Number.isFinite(Number(meta.pathMinM)) ? Number(meta.pathMinM) : 0,
      Number.isFinite(Number(meta.pathMaxM)) ? Number(meta.pathMaxM) : 1,
      depthMin,
      depthMax,
    )
    gl.uniform2f(u.uValue, Number(volume.valueMin) || 0, Number(volume.valueMax) || 1)
    gl.uniform2f(
      u.uDb,
      Number.isFinite(Number(controls?.dbMin)) ? Number(controls.dbMin) : 60,
      Number.isFinite(Number(controls?.dbMax)) ? Number(controls.dbMax) : 120,
    )
    const density = clamp(Number(controls?.density) || 3, 0.25, 8)
    const contrast = clamp(Number(controls?.contrast) || 2, 0.5, 3)
    const edgeSharpness = clamp(Number(controls?.edgeSharpness) || 1, 0.5, 4)
    gl.uniform4f(u.uAlpha, opacity, density, contrast, edgeSharpness)
    const internalAzimuth = Number(controls?.clipAzimuthDeg)
    const compassAzimuth = Number.isFinite(internalAzimuth)
      ? ((90 - internalAzimuth) % 360 + 360) % 360
      : 0
    gl.uniform3f(u.uClipInfo, clipVolume ? 1 : 0, compassAzimuth, 0)
    // Seabed contact feather. Keep it tight so the draped bottom actually
    // reaches the terrain; compositing already provides the soft falloff.
    const featherSpan = Math.max(1, depthMax - depthMin)
    gl.uniform1f(u.uFeatherM, Math.max(8, Math.min(60, featherSpan * 0.12)))
    // Signal-excess derivation uniforms (disabled => plain TL rendering).
    const excess = controls?.signalExcess
    if (excess?.enabled) {
      const low = Number.isFinite(Number(excess.low)) ? Number(excess.low) : depthMin
      const high = Number.isFinite(Number(excess.high)) ? Number(excess.high) : depthMax
      gl.uniform4f(
        u.uExcess, 1,
        Number.isFinite(Number(excess.offset)) ? Number(excess.offset) : 0,
        low, Math.max(low, high),
      )
      gl.uniform3f(
        u.uExcessMode,
        excess.pd === true ? 1 : 0,
        Math.max(1e-6, Number(excess.sigma) || 6),
        excess.threeColor === true ? 1 : 0,
      )
    } else {
      gl.uniform4f(u.uExcess, 0, 0, 0, 0)
      gl.uniform3f(u.uExcessMode, 0, 6, 0)
    }
    gl.uniform1i(u.uHasBottomDepth, volume.hasBottomDepth ? 1 : 0)
    const debug = globalThis.__acousticVolumeDebug ?? {}
    gl.uniform1i(u.uStrictNearest, volume.strictNearest === true ? 1 : 0)
    gl.uniform1i(u.uDebugNoTerrain, debug.disableTerrainClip === true ? 1 : 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_3D, volumeTexture)
    gl.uniform1i(u.uVolumeTexture, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture)
    gl.uniform1i(u.uHeightMap, 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.colorLutTexture)
    gl.uniform1i(u.uColorLut, 2)

    // Terrain has already populated the depth buffer. Volume fragments write
    // matching projected depths in the shader, so foreground relief remains
    // in front while the acoustic body is visible through open water.
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)
    gl.bindVertexArray(this.volumeGeometry.vao)
    gl.drawArrays(gl.TRIANGLES, 0, this.volumeGeometry.count)
    gl.bindVertexArray(null)
    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    return true
  }

  render(grid, camera, controls = {}, volume = null) {
    if (this.disposed) return
    if (this.contextLost || this.gl.isContextLost()) {
      throw new Error('地形 WebGL 上下文已丢失')
    }

    const gl = this.gl
    const canvas = this.canvas
    const rect = canvas.getBoundingClientRect()
    const width = rect.width
    const height = rect.height
    if (!(width > 0 && height > 0)) return false

    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    const pixelWidth = Math.max(1, Math.round(width * dpr))
    const pixelHeight = Math.max(1, Math.round(height * dpr))
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }

    gl.viewport(0, 0, pixelWidth, pixelHeight)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    if (!grid) return false
    if (!this.geometry || this.geometry.grid !== grid) this.buildGeometry(grid)
    if (!this.geometry) return false
    this.ensureColorLut(grid, controls)

    const b = grid.bounds
    const cosLat = Math.max(.1, Math.cos((b.north + b.south) * Math.PI / 360))
    const spanX = (b.east - b.west) * cosLat
    const spanY = b.north - b.south
    const span = Math.max(1e-9, Math.max(spanX, spanY))
    const horizontalSpanM = Math.max(1, span * 110574)

    const yaw = Number(camera?.yaw) || 0
    const pitch = Number.isFinite(Number(camera?.pitch)) ? Number(camera.pitch) : 0.68
    const zoom = Number.isFinite(Number(camera?.zoom)) ? Number(camera.zoom) : 1
    const panX = Number(camera?.panX) || 0
    const panY = Number(camera?.panY) || 0
    const exaggeration = normalizeExaggeration(controls?.terrainExaggeration)
    const scale = Math.min(width * .72, height * 1.2) * zoom
    const sinYaw = Math.sin(yaw)
    const cosYaw = Math.cos(yaw)
    const sinPitch = Math.sin(pitch)
    const cosPitch = Math.cos(pitch)

    // perspective 依赖旋转后的 ry 和俯仰角；正俯视时强度为 0。
    const halfX = spanX / (2 * span)
    const halfY = spanY / (2 * span)
    let invMin = Infinity
    let invMax = -Infinity
    for (const x of [-halfX, halfX]) {
      for (const y of [-halfY, halfY]) {
        const ry = x * sinYaw + y * cosYaw
        const perspectiveStrength = .35 * Math.abs(cosPitch)
        const inv = 1 / (1 - ry * perspectiveStrength)
        if (inv < invMin) invMin = inv
        if (inv > invMax) invMax = inv
      }
    }

    const showFog = controls?.terrainFog !== false
    const fogStrength = showFog
      ? clamp(Number.isFinite(Number(controls?.terrainFogStrength))
        ? Number(controls.terrainFogStrength) : .6, 0, 1)
      : 0
    const fog = Array.isArray(controls?.terrainFogColor) && controls.terrainFogColor.length === 3
      ? controls.terrainFogColor
      : [7, 19, 30]

    const lightAzimuthDeg = Number.isFinite(Number(controls?.lightAzimuthDeg))
      ? Number(controls.lightAzimuthDeg) : terrainLighting.hillshadeAzimuth
    const lightAltitudeDeg = Number.isFinite(Number(controls?.lightAltitudeDeg))
      ? Number(controls.lightAltitudeDeg) : terrainLighting.hillshadeAltitude
    const azimuth = lightAzimuthDeg * Math.PI / 180
    const altitude = lightAltitudeDeg * Math.PI / 180
    const min = Number.isFinite(Number(grid.min)) ? Number(grid.min) : -1
    const max = Number.isFinite(Number(grid.max)) ? Number(grid.max) : 1
    const shadowEnabled = controls?.terrainShadows === true
      && this.ensureShadowTexture(grid, lightAzimuthDeg, lightAltitudeDeg, exaggeration)

    const u = this.uniforms
    gl.useProgram(this.program)
    gl.uniform1f(u.uWidth, width)
    gl.uniform1f(u.uHeight, height)
    gl.uniform1f(u.uScale, scale)
    gl.uniform1f(u.uPanX, panX)
    gl.uniform1f(u.uPanY, panY)
    gl.uniform1f(u.uCosYaw, cosYaw)
    gl.uniform1f(u.uSinYaw, sinYaw)
    gl.uniform1f(u.uCosPitch, cosPitch)
    gl.uniform1f(u.uSinPitch, sinPitch)
    gl.uniform1f(u.uExaggeration, exaggeration)
    gl.uniform1f(u.uMinElevation, min)
    gl.uniform1f(u.uMaxElevation, max)

    gl.uniform3f(
      u.uLightDir,
      Math.sin(azimuth) * Math.cos(altitude),
      Math.cos(azimuth) * Math.cos(altitude),
      Math.sin(altitude),
    )
    gl.uniform1f(u.uAmbient, terrainLighting.ambient)
    gl.uniform1f(u.uDiffuse, terrainLighting.diffuse)
    gl.uniform1f(u.uMinLight, terrainLighting.minLight)
    gl.uniform1f(u.uMaxLight, terrainLighting.maxLight)
    gl.uniform1f(u.uZFactor, exaggeration)
    gl.uniform1f(u.uBrightness, clamp(
      Number.isFinite(Number(controls?.terrainBrightness)) ? Number(controls.terrainBrightness) : 1,
      0.5,
      4
    ))
    gl.uniform3f(
      u.uFogColor,
      colorChannel(fog[0], 0),
      colorChannel(fog[1], 0),
      colorChannel(fog[2], 0),
    )
    gl.uniform1f(u.uFogStrength, fogStrength)
    gl.uniform1f(u.uInvMin, invMin)
    gl.uniform1f(u.uInvMax, invMax)
    gl.uniform1f(u.uShadowEnabled, shadowEnabled ? 1 : 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture)
    gl.uniform1i(u.uColorMap, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture)
    gl.uniform1i(u.uShadowMap, 1)
    gl.activeTexture(gl.TEXTURE0)

    gl.bindVertexArray(this.geometry.vao)
    gl.drawElements(gl.TRIANGLES, this.geometry.count, gl.UNSIGNED_INT, 0)
    gl.bindVertexArray(null)

    // 地形之后绘制体，并关闭伪深度测试：避免不同拖拽角度下整块声场被
    // 地形深度误判而消失；海底以下仍由片元着色器按真实水深裁剪。
    const view = {
      width, height, scale, panX, panY, cosYaw, sinYaw, cosPitch, sinPitch,
      exaggeration, horizontalSpanM, span, cosLat, halfX, halfY,
    }
    // Accept a single volume (legacy) or a list of { id, volume, clip } entries.
    const entries = Array.isArray(volume)
      ? volume.map(item => (item && item.volume ? item : { volume: item })).filter(item => item.volume)
      : (volume ? [{ volume, clip: controls?.clipGpuVolume === true }] : [])
    // Release textures for fields that are no longer visible so a long session
    // with many archived fields does not leak 3D textures.
    if (this.volumeTextures) {
      const active = new Set(entries.map(entry => entry.volume))
      for (const [textureVolume, entry] of this.volumeTextures) {
        if (active.has(textureVolume)) continue
        gl.deleteTexture(entry.texture)
        this.volumeTextures.delete(textureVolume)
      }
    }
    this.volumeActive = false
    this.renderedVolumeIds = []
    for (const entry of entries) {
      if (this.renderVolume(
        grid,
        entry.volume,
        controls,
        view,
        entry.clip === undefined ? null : entry.clip === true,
      )) {
        this.volumeActive = true
        if (entry.id != null) this.renderedVolumeIds.push(entry.id)
      }
    }
    return true
  }
}

export function createTerrainWebGLRenderer(canvas) {
  try {
    return new TerrainWebGLRenderer(canvas)
  } catch (error) {
    console.warn('[terrain] WebGL 地形初始化失败，回退到 Canvas 渲染：', error)
    return null
  }
}
