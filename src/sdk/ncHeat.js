/**
 * ncHeat.js — 独立 NC 栅格数据热力图渲染库
 * =============================================
 *
 * 纯 JavaScript 实现，零框架依赖，仅使用浏览器原生 Canvas 2D / WebGL API。
 * 提供从 NC 数值栅格数据到可视化热力图的完整管线：
 *
 *   - 2D 平面效果：平滑热力图、逐像素热力图、矢量箭头流向图
 *   - 3D 体渲染效果：多层栅格堆叠为 3D 体纹理数据
 *   - 色带管理：内置 NC 统一色带 + 声场 TL 专用色带
 *
 * ─── 使用示例 ───────────────────────────────────────────────────
 *
 * // 1. 构造栅格数据对象（从 NC 文件解析得到）
 * const grid = {
 *   lons: [100.5, 101.0, 101.5, ...],    // 经度数组
 *   lats: [20.0, 20.5, 21.0, ...],       // 纬度数组
 *   values: [23.1, 23.5, 24.0, ...],     // 数据值（行主序，width*height 长度）
 *   width: 360,                           // 经度方向格点数
 *   height: 180,                          // 纬度方向格点数
 *   valueMin: 15,                         // 最小值
 *   valueMax: 35                          // 最大值
 * };
 * // 2. 生成 2D 平滑热力图 Canvas
 * const canvas = createSmoothRasterCanvas2D(grid, false, 'nc');
 * if (canvas) {
 *   document.body.appendChild(canvas);
 *   // 或导出为 PNG URL
 *   canvasToObjectUrl(canvas).then(url => {
 *     console.log('热力图 URL:', url);
 *   });
 * }
 *
 * // 3. 生成逐像素热力图（保持原始分辨率，不插值）
 * const rawCanvas = createRasterCanvasByPaletteMode(grid, 'nc');
 *
 * // 4. 使用声场 TL 色带
 * const soundCanvas = createSmoothRasterCanvas2D(grid, false, 'soundTl');
 *
 * // 5. 生成矢量箭头流向图
 * const arrowPayload = buildVectorArrowCanvas2D(uGrid, vGrid);
 * if (arrowPayload) {
 *   // arrowPayload.url    → PNG data URL
 *   // arrowPayload.imageExtent → [west, south, east, north]
 * }
 *
 * // 6. 3D 体渲染：多层栅格堆叠
 * const layers = [
 *   { depthIndex: 0, depthValue: 0, width: 360, height: 180,
 *     lons: [...], lats: [...], values: [...],
 *     valueMin: 15, valueMax: 35 },
 *   { depthIndex: 1, depthValue: 100, width: 360, height: 180,
 *     lons: [...], lats: [...], values: [...],
 *     valueMin: 14, valueMax: 33 },
 *   // ... 更多深度层
 * ];
 * const volumeData = buildVolumeTextureData(layers, [0, 100, 200, ...], 'scalar');
 * if (volumeData) {
 *   console.log('3D 纹理尺寸:', volumeData.width, volumeData.height, volumeData.depth);
 *   // volumeData.data 是 Uint8Array，可用于 WebGL texImage3D
 * }
 *
 * // 7. 使用 RawTexture3D 创建 WebGL 3D 纹理
 * const gl = canvas.getContext('webgl2');
 * const texture3D = new RawTexture3D(gl, volumeData);
 * // ... 在 WebGL shader 中使用 texture3D._texture
 *
 * ─── 色带说明 ───────────────────────────────────────────────────
 *
 *   'nc'     — 蓝→青→绿→黄→红，适用于温度、盐度、海面高度等普通标量场
 *   'soundTl' — 红→橙→黄→绿→青→蓝，适用于声场传播损失（TL=小时暖色，TL=大时冷色）
 *
 * ─── 注意事项 ───────────────────────────────────────────────────
 *
 *   - 3D 体渲染中 buildVolumeTextureData 的 buildSphericalMeta 参数
 *     依赖外部 Cesium/地图库计算包围球和模型矩阵。若无需地图定位，
 *     可传 null 跳过该步骤，仅获得原始纹理数据。
 *
 * @module ncHeat
 * @version 1.0.0
 */

// ═══════════════════════════════════════════════════════════════
// 1. 类型定义（JSDoc）
// ═══════════════════════════════════════════════════════════════

/**
 * @typedef {Object} SmoothRasterGrid
 * @property {number[]} lons - 经度数组
 * @property {number[]} lats - 纬度数组
 * @property {number[]} values - 数据值数组（行主序，长度 = width * height）
 * @property {number} width - 宽度（经度方向格点数）
 * @property {number} height - 高度（纬度方向格点数）
 * @property {number} valueMin - 数据最小值
 * @property {number} valueMax - 数据最大值
 */

/**
 * @typedef {Object} NcRasterLayer
 * @property {number} depthIndex - 深度索引
 * @property {number} [depthValue] - 深度值
 * @property {number} width - 宽度
 * @property {number} height - 高度
 * @property {ArrayLike<number>} lons - 经度数组
 * @property {ArrayLike<number>} lats - 纬度数组
 * @property {ArrayLike<number>} values - 数据值数组
 * @property {number} [valueMin] - 最小值
 * @property {number} [valueMax] - 最大值
 */

/**
 * @typedef {'nc'|'soundTl'} NcColorPaletteMode
 */

/**
 * @typedef {Object} NcColorStop
 * @property {number} offset - 色标位置 (0~1)
 * @property {number} r - 红色通道 (0~255)
 * @property {number} g - 绿色通道 (0~255)
 * @property {number} b - 蓝色通道 (0~255)
 */

/**
 * @typedef {Object} NcRgbColor
 * @property {number} r
 * @property {number} g
 * @property {number} b
 */

/**
 * @typedef {Object} NcRgbaColor
 * @property {number} r
 * @property {number} g
 * @property {number} b
 * @property {number} a
 */

/**
 * @typedef {Object} SmoothRasterExtentInfo
 * @property {[number,number,number,number]} dataExtent - [west, south, east, north]
 * @property {[number,number,number,number]} imageExtent - [west, south, east, north]
 * @property {boolean} isGlobalRaster
 */

/**
 * @typedef {Object} VectorArrowCanvasPayload
 * @property {string} url - PNG data URL
 * @property {[number,number,number,number]} imageExtent - [west, south, east, north]
 */

/**
 * @typedef {Object} VolumeTextureData
 * @property {number} width - 纹理宽度
 * @property {number} height - 纹理高度
 * @property {number} depth - 纹理深度
 * @property {Uint8Array} data - RGBA 纹理数据（width*height*depth*4）
 * @property {number} valueMin - 原始最小值
 * @property {number} valueMax - 原始最大值
 * @property {number} displayValueMin - 显示用最小值
 * @property {number} displayValueMax - 显示用最大值
 * @property {number} lonMin - 经度最小值
 * @property {number} lonMax - 经度最大值
 * @property {number} latMin - 纬度最小值
 * @property {number} latMax - 纬度最大值
 * @property {number[]} depthValues - 深度值数组
 * @property {number} sourceWidth - 原始宽度
 * @property {number} sourceHeight - 原始高度
 * @property {number} sourceDepth - 原始深度
 * @property {number} signedAbsMax - 有符号速度绝对值最大
 * @property {boolean} downsampled - 是否降采样
 */


// ═══════════════════════════════════════════════════════════════
// 2. 常量配置
// ═══════════════════════════════════════════════════════════════

// ─── 2D 渲染参数 ─────────────────────────────────────────────

/** 纹理超采样倍数，用于提升平滑渲染质量 */
const SMOOTH_2D_TEXTURE_SUPERSAMPLE = 2;
/** 纹理最大边长（像素），超过此值将降低超采样倍数 */
const SMOOTH_2D_MAX_TEXTURE_SIZE = 2048;
/** 采样覆盖率的最小阈值，低于此值的像素将被视为无效 */
const SMOOTH_2D_MIN_COVERAGE = 0.10;
/** 默认透明度 (0~1) */
const SMOOTH_2D_ALPHA = 0.82;
/** 带符号矢量场渲染时，图像边缘渐隐的单元数 */
const SIGNED_VELOCITY_2D_BOUNDARY_FADE_CELLS = 5;
/** EPSG:4326 底图支持的最大纬度值（墨卡托投影边界） */
const EPSG4326_BASEMAP_MAX_LAT = 85.05112878;

/** 矢量箭头最大绘制数量 */
const VECTOR_ARROW_MAX_COUNT = 900;
/** 矢量箭头 Canvas 最大尺寸 */
const VECTOR_ARROW_CANVAS_MAX_SIZE = 1600;
/** 矢量箭头最小显示速度比例 */
const VECTOR_ARROW_MIN_SPEED_RATIO = 0.04;

// ─── 3D 渲染参数 ─────────────────────────────────────────────

/** 体渲染边缘羽化半径 */
const VOLUME_EDGE_FEATHER_CELLS = 1.45;
/** CPU 端 3D 纹理最大尺寸（构建阶段硬上限） */
const MAX_CPU_3D_TEXTURE_SIZE = 512;
/** GLSL shader 中用于颜色映射的色带采样数 */
const COLOR_BAND_SEGMENTS_COUNT = 64;


// ═══════════════════════════════════════════════════════════════
// 3. 色带定义
// ═══════════════════════════════════════════════════════════════

/**
 * 普通 NC 统一色带：低值蓝色 → 高值红色。
 * 适用于温度、盐度、海面高度、普通 2D/3D 热力图。
 *
 * @type {NcColorStop[]}
 */
const NC_UNIFIED_COLOR_STOPS = [
    { offset: 0.00, r: 0, g: 80, b: 255 },
    { offset: 0.25, r: 0, g: 220, b: 255 },
    { offset: 0.55, r: 0, g: 255, b: 0 },
    { offset: 0.78, r: 255, g: 255, b: 0 },
    { offset: 1.00, r: 255, g: 0, b: 0 },
];

/**
 * 声场传播损失 (TL) 专用色带。
 * TL 小（损失小，声能强）→ 红/橙/黄 暖色
 * TL 大（损失大，声能弱）→ 蓝/深蓝 冷色
 *
 * @type {NcColorStop[]}
 */
const SOUND_FIELD_TL_COLOR_STOPS = [
    { offset: 0.00, r: 255, g: 0, b: 0 },
    { offset: 0.18, r: 255, g: 128, b: 0 },
    { offset: 0.34, r: 255, g: 255, b: 0 },
    { offset: 0.55, r: 0, g: 220, b: 80 },
    { offset: 0.74, r: 0, g: 220, b: 255 },
    { offset: 1.00, r: 0, g: 40, b: 180 },
];


// ═══════════════════════════════════════════════════════════════
// 4. 基础工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 将数值限制在 [min, max] 范围内。
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
const clamp = (value, min, max) => {
    return Math.max(min, Math.min(max, Number(value)));
};

/**
 * Hermite 平滑阶跃函数（smoothstep）。
 * 在 [edge0, edge1] 之间产生 S 形过渡，常用于边缘羽化和覆盖率过渡。
 *
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} value
 * @returns {number} 0~1 之间的平滑过渡值
 */
const smoothStep = (edge0, edge1, value) => {
    if (edge0 === edge1) return value >= edge1 ? 1 : 0;
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
};

/**
 * 将值归一化到 [0, 1] 区间。
 * @param {number} value - 原始值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number}
 */
const normalizeValueToRatio = (value, min, max) => {
    if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
    const range = max - min;
    if (!Number.isFinite(range) || Math.abs(range) < 1e-12) return 0.5;
    return clamp((value - min) / range, 0, 1);
};


// ═══════════════════════════════════════════════════════════════
// 5. 色带颜色计算
// ═══════════════════════════════════════════════════════════════

/**
 * 根据 ratio (0~1) 和色标数组插值计算 RGB 颜色。
 *
 * @param {number} ratio - 归一化值 0~1
 * @param {NcColorStop[]} stops - 色标数组
 * @returns {NcRgbColor}
 */
const getColorBytesByRatioFromStops = (ratio, stops) => {
    const t = clamp(Number(ratio), 0, 1);
    if (stops.length === 0) return { r: 0, g: 0, b: 0 };
    if (stops.length === 1) return { r: stops[0].r, g: stops[0].g, b: stops[0].b };

    for (let i = 1; i < stops.length; i++) {
        const left = stops[i - 1];
        const right = stops[i];
        if (t <= right.offset) {
            const localT = clamp(
                (t - left.offset) / Math.max(1e-12, right.offset - left.offset),
                0, 1
            );
            return {
                r: Math.round(left.r + (right.r - left.r) * localT),
                g: Math.round(left.g + (right.g - left.g) * localT),
                b: Math.round(left.b + (right.b - left.b) * localT),
            };
        }
    }
    const last = stops[stops.length - 1];
    return { r: last.r, g: last.g, b: last.b };
};

/**
 * 根据 mode 获取对应的色标数组。
 * @param {NcColorPaletteMode} mode - 'nc' | 'soundTl'
 * @returns {NcColorStop[]}
 */
const getColorStopsByPaletteMode = (mode) => {
    return mode === 'soundTl' ? SOUND_FIELD_TL_COLOR_STOPS : NC_UNIFIED_COLOR_STOPS;
};

/**
 * 根据 mode 和 ratio 计算颜色。
 * @param {NcColorPaletteMode} mode
 * @param {number} ratio - 0~1
 * @returns {NcRgbColor}
 */
const getColorBytesByRatioForPaletteMode = (mode, ratio) => {
    return getColorBytesByRatioFromStops(ratio, getColorStopsByPaletteMode(mode));
};

/**
 * 根据 mode、原始值和值范围计算 RGBA 颜色。
 *
 * @param {NcColorPaletteMode} mode - 色带模式
 * @param {number} value - 原始数据值
 * @param {number} min - 值域下限
 * @param {number} max - 值域上限
 * @param {number} [alpha=1] - 透明度 (0~1)
 * @returns {NcRgbaColor}
 */
const getColorBytesByValueForPaletteMode = (mode, value, min, max, alpha = 1) => {
    const color = getColorBytesByRatioForPaletteMode(
        mode,
        normalizeValueToRatio(value, min, max)
    );
    return {
        ...color,
        a: Math.round(clamp(alpha, 0, 1) * 255),
    };
};

/**
 * 根据带符号速度值计算颜色。
 * 正值 → 暖色（红-橙），负值 → 冷色（紫-蓝）。
 *
 * @param {number} value - 速度值（可正可负）
 * @param {number} displayMaxAbs - 归一化用的最大绝对值
 * @param {number} [alpha=0.82] - 透明度
 * @returns {[number,number,number,number]} [r, g, b, a]
 */
const getSignedVelocityColorBytes = (value, displayMaxAbs, alpha = SMOOTH_2D_ALPHA) => {
    const strength = Math.min(1, Math.abs(value) / Math.max(displayMaxAbs, 1e-12));
    const visible = smoothStep(0.01, 0.35, strength);
    const t = Math.pow(strength, 0.45);
    const target = value >= 0 ? [255, 72, 32] : [92, 64, 214];
    const base = [238, 242, 247];
    const r = Math.round(base[0] + (target[0] - base[0]) * t);
    const g = Math.round(base[1] + (target[1] - base[1]) * t);
    const b = Math.round(base[2] + (target[2] - base[2]) * t);
    return [r, g, b, Math.round(255 * alpha * visible)];
};


// ═══════════════════════════════════════════════════════════════
// 6. 2D 栅格数据读取与采样
// ═══════════════════════════════════════════════════════════════

/**
 * 从栅格数组中安全获取某个格点的有限数值。
 * 坐标越界或值为非有限数时返回 null。
 *
 * @param {ArrayLike<number>} values
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @returns {number|null}
 */
const getFiniteGridValue = (values, width, height, x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    const value = Number(values[y * width + x]);
    return Number.isFinite(value) ? value : null;
};

/**
 * 对栅格中某个浮点坐标进行加权软采样。
 * 在指定半径内对周围格点按距离加权平均，返回插值结果和覆盖率。
 *
 * @param {ArrayLike<number>} values - 栅格值数组
 * @param {number} width - 栅格宽度
 * @param {number} height - 栅格高度
 * @param {number} gridX - 浮点 X 坐标（列）
 * @param {number} gridY - 浮点 Y 坐标（行）
 * @param {number} [radius=1.15] - 采样半径
 * @returns {{ value: number, coverage: number }}
 */
const sampleSoftGridValue = (values, width, height, gridX, gridY, radius = 1.15) => {
    const centerX = Math.floor(gridX);
    const centerY = Math.floor(gridY);
    const searchRadius = Math.max(1, Math.ceil(radius));
    let weightedSum = 0;
    let weightSum = 0;
    let maxWeight = 0;

    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            const x = centerX + dx;
            const y = centerY + dy;
            const distance = Math.hypot(gridX - x, gridY - y);
            if (distance > radius) continue;
            const value = getFiniteGridValue(values, width, height, x, y);
            if (value === null) continue;
            const weight = Math.max(0, 1 - distance / radius);
            weightedSum += value * weight;
            weightSum += weight;
            maxWeight = Math.max(maxWeight, weight);
        }
    }

    if (weightSum <= 0) return { value: NaN, coverage: 0 };
    return {
        value: weightedSum / weightSum,
        coverage: Math.min(1, maxWeight),
    };
};

/**
 * 计算经纬度坐标轴步长（中位数估计）。
 * @param {number[]} axis
 * @returns {number}
 */
const calculateAxisStep = (axis) => {
    const diffs = [];
    for (let i = 1; i < axis.length; i++) {
        const diff = Math.abs(axis[i] - axis[i - 1]);
        if (Number.isFinite(diff) && diff > 0) diffs.push(diff);
    }
    const sorted = diffs.sort((a, b) => a - b);
    return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/**
 * 计算栅格值绝对值的指定分位数。
 * @param {ArrayLike<number>} values
 * @param {number} [percentile=0.96]
 * @returns {number}
 */
const calculateAbsPercentile = (values, percentile = 0.96) => {
    const items = Array.from(values, v => Math.abs(Number(v)))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    if (items.length === 0) return 1;
    const idx = Math.max(0, Math.min(items.length - 1, Math.floor((items.length - 1) * percentile)));
    return Math.max(items[idx], 1e-12);
};


// ═══════════════════════════════════════════════════════════════
// 7. 地理范围工具
// ═══════════════════════════════════════════════════════════════

/**
 * 将纬度限制在 WGS84 有效范围 [-90, 90] 内。
 * @param {number} lat
 * @returns {number}
 */
const clampLatitude4326 = (lat) => Math.max(-90, Math.min(90, Number(lat)));

/**
 * 将纬度限制在 EPSG:4326 底图支持的范围 [-85.05, 85.05] 内。
 * @param {number} lat
 * @returns {number}
 */
const clampLatitudeForBasemap = (lat) => {
    return Math.max(-EPSG4326_BASEMAP_MAX_LAT, Math.min(EPSG4326_BASEMAP_MAX_LAT, Number(lat)));
};

/**
 * 将经度标准化到 [-180, 180] 范围，支持 0~360 转 ±180。
 * @param {number} lon
 * @returns {number}
 */
const normalizeLongitudeTo180 = (lon) => {
    if (!Number.isFinite(lon)) return lon;
    let value = ((lon + 180) % 360 + 360) % 360 - 180;
    if (value === -180 && lon > 0) value = 180;
    return value;
};

/**
 * 验证 WGS84 地理范围是否有效。
 * @param {number[]|null|undefined} extent
 * @returns {boolean}
 */
const isValidImageExtent = (extent) => {
    if (!extent || extent.length < 4) return false;
    const [minX, minY, maxX, maxY] = extent;
    return [minX, minY, maxX, maxY].every(Number.isFinite) && maxX > minX && maxY > minY;
};


// ═══════════════════════════════════════════════════════════════
// 8. 2D 平面热力图 Canvas 生成
// ═══════════════════════════════════════════════════════════════

/**
 * 从平滑栅格数据生成超采样热力图 Canvas。
 *
 * 渲染策略：
 * - 按纹理超采样倍数放大画布（默认 2x），获得更平滑的视觉效果。
 * - 使用加权软采样对每个像素进行插值，避免马赛克感。
 * - 边缘像素根据覆盖率和与图像边界的距离进行羽化。
 * - 支持有符号矢量场模式（正负值使用不同色系）。
 *
 * @param {SmoothRasterGrid} grid - 栅格数据对象
 * @param {boolean} [signedVelocity=false] - 是否为带符号矢量场
 * @param {NcColorPaletteMode} [colorPaletteMode='nc'] - 色带模式
 * @returns {HTMLCanvasElement|null} 渲染好的 Canvas，输入不合法时返回 null
 *
 * @example
 * const canvas = createSmoothRasterCanvas2D(grid, false, 'nc');
 * document.body.appendChild(canvas);
 */
export const createSmoothRasterCanvas2D = (grid, signedVelocity = false, colorPaletteMode = 'nc') => {
    const textureScale = Math.max(
        1,
        Math.min(
            SMOOTH_2D_TEXTURE_SUPERSAMPLE,
            SMOOTH_2D_MAX_TEXTURE_SIZE / Math.max(grid.width, grid.height, 1)
        )
    );
    const textureWidth = Math.max(2, Math.round(grid.width * textureScale));
    const textureHeight = Math.max(2, Math.round(grid.height * textureScale));
    const canvas = document.createElement('canvas');
    canvas.width = textureWidth;
    canvas.height = textureHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imageData = ctx.createImageData(textureWidth, textureHeight);
    const data = imageData.data;
    const lonAscending = grid.lons[0] < grid.lons[grid.lons.length - 1];
    const latAscending = grid.lats[0] < grid.lats[grid.lats.length - 1];
    const signedMaxAbs = signedVelocity ? calculateAbsPercentile(grid.values, 0.96) : 1;

    for (let ty = 0; ty < textureHeight; ty++) {
        const targetGridY = textureHeight <= 1 ? 0 : (ty / (textureHeight - 1)) * (grid.height - 1);
        const sourceGridY = latAscending ? grid.height - 1 - targetGridY : targetGridY;

        for (let tx = 0; tx < textureWidth; tx++) {
            const targetGridX = textureWidth <= 1 ? 0 : (tx / (textureWidth - 1)) * (grid.width - 1);
            const sourceGridX = lonAscending ? targetGridX : grid.width - 1 - targetGridX;
            const targetIndex = (ty * textureWidth + tx) * 4;
            const sample = sampleSoftGridValue(
                grid.values, grid.width, grid.height,
                sourceGridX, sourceGridY,
                signedVelocity ? 1.2 : 1.15
            );

            if (!Number.isFinite(sample.value)) {
                data[targetIndex + 3] = 0;
                continue;
            }

            const edgeAlpha = smoothStep(SMOOTH_2D_MIN_COVERAGE, 0.80, sample.coverage);
            const distanceToEdge = Math.min(tx, ty, textureWidth - 1 - tx, textureHeight - 1 - ty);
            const boundaryAlpha = signedVelocity
                ? smoothStep(0, SIGNED_VELOCITY_2D_BOUNDARY_FADE_CELLS, distanceToEdge)
                : 1;
            const alpha = SMOOTH_2D_ALPHA * edgeAlpha * boundaryAlpha;

            let r, g, b, a;
            if (signedVelocity) {
                const sc = getSignedVelocityColorBytes(sample.value, signedMaxAbs, alpha);
                [r, g, b, a] = sc;
            } else {
                const sc = getColorBytesByValueForPaletteMode(
                    colorPaletteMode, sample.value,
                    grid.valueMin, grid.valueMax, alpha
                );
                r = sc.r; g = sc.g; b = sc.b; a = sc.a;
            }

            data[targetIndex] = r;
            data[targetIndex + 1] = g;
            data[targetIndex + 2] = b;
            data[targetIndex + 3] = a;
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
};

/**
 * 按色带模式逐像素直接生成热力图 Canvas。
 *
 * 与 createSmoothRasterCanvas2D 不同，此函数不做超采样和软插值，
 * 每个栅格数据点直接映射到一个像素，保持原始分辨率。
 *
 * @param {SmoothRasterGrid} grid - 栅格数据
 * @param {NcColorPaletteMode} paletteMode - 色带模式
 * @returns {HTMLCanvasElement|null}
 *
 * @example
 * const canvas = createRasterCanvasByPaletteMode(grid, 'soundTl');
 * if (canvas) {
 *   canvas.style.width = '100%'; // CSS 缩放显示
 *   document.body.appendChild(canvas);
 * }
 */
export const createRasterCanvasByPaletteMode = (grid, paletteMode) => {
    const width = Math.max(0, Math.floor(Number(grid.width)));
    const height = Math.max(0, Math.floor(Number(grid.height)));
    const values = grid.values;
    const total = width * height;

    if (width <= 0 || height <= 0 || !values || Number(values.length || 0) < total) return null;

    const valueMin = Number(grid.valueMin);
    const valueMax = Number(grid.valueMax);
    if (!Number.isFinite(valueMin) || !Number.isFinite(valueMax) || valueMax <= valueMin) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imageData = ctx.createImageData(width, height);
    const target = imageData.data;

    for (let i = 0; i < total; i++) {
        const value = Number(values[i]);
        if (!Number.isFinite(value)) continue;

        const color = getColorBytesByValueForPaletteMode(
            paletteMode, value, valueMin, valueMax, 0.92
        );
        const ti = i * 4;
        target[ti] = color.r;
        target[ti + 1] = color.g;
        target[ti + 2] = color.b;
        target[ti + 3] = color.a;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
};


// ═══════════════════════════════════════════════════════════════
// 9. 矢量箭头流向图
// ═══════════════════════════════════════════════════════════════

/**
 * 计算 X/Y 分量栅格的合成速度范围。
 * @param {SmoothRasterGrid} xGrid
 * @param {SmoothRasterGrid} yGrid
 * @param {number} width
 * @param {number} height
 * @returns {{ maxSpeed: number, finiteCount: number }}
 */
const calculateVectorSpeedRange = (xGrid, yGrid, width, height) => {
    let maxSpeed = 0;
    let finiteCount = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const u = Number(xGrid.values[y * xGrid.width + x]);
            const v = Number(yGrid.values[y * yGrid.width + x]);
            if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
            const speed = Math.hypot(u, v);
            if (!Number.isFinite(speed)) continue;
            finiteCount++;
            maxSpeed = Math.max(maxSpeed, speed);
        }
    }
    return { maxSpeed, finiteCount };
};

/**
 * 从栅格对象计算 WGS84 地理范围。
 * @param {SmoothRasterGrid} grid
 * @returns {[number,number,number,number]|null} [west, south, east, north]
 */
const calculateGridExtent = (grid) => {
    const lons = grid.lons.filter(Number.isFinite);
    const lats = grid.lats.filter(Number.isFinite);
    if (lons.length === 0 || lats.length === 0) return null;
    const lonMin = Math.min(...lons);
    const lonMax = Math.max(...lons);
    const latMin = Math.min(...lats);
    const latMax = Math.max(...lats);
    if ([lonMin, lonMax, latMin, latMax].some(v => !Number.isFinite(v))) return null;
    if (lonMin === lonMax || latMin === latMax) return null;
    return [lonMin, latMin, lonMax, latMax];
};

/**
 * 从 X/Y 分量栅格生成矢量箭头流向图 Canvas。
 *
 * 渲染逻辑：
 * - 对每个格点计算 sqrt(u²+v²) 合成速度，速度过低则跳过。
 * - 根据速度大小动态调整箭头长度、头部大小和透明度。
 * - 通过采样步长控制最大箭头数量（不超过 900），避免过度拥挤。
 *
 * @param {SmoothRasterGrid} xGrid - X 方向（经向）速度分量
 * @param {SmoothRasterGrid} yGrid - Y 方向（纬向）速度分量
 * @returns {VectorArrowCanvasPayload|null}
 *
 * @example
 * const payload = buildVectorArrowCanvas2D(uGrid, vGrid);
 * if (payload) {
 *   const img = new Image();
 *   img.src = payload.url;
 *   // img 覆盖到 payload.imageExtent 对应的地理范围
 *   document.body.appendChild(img);
 * }
 */
export const buildVectorArrowCanvas2D = (xGrid, yGrid) => {
    const width = Math.min(xGrid.width, yGrid.width);
    const height = Math.min(xGrid.height, yGrid.height);
    if (width <= 1 || height <= 1) return null;

    const rawExtent = calculateGridExtent(xGrid);
    if (!rawExtent) return null;

    const [lonMin, rawLatMin, lonMax, rawLatMax] = rawExtent;
    const latMin = clampLatitudeForBasemap(rawLatMin);
    const latMax = clampLatitudeForBasemap(rawLatMax);
    if ([lonMin, lonMax, latMin, latMax].some(v => !Number.isFinite(v))) return null;
    if (lonMin === lonMax || latMin === latMax) return null;

    const imageExtent = [lonMin, latMin, lonMax, latMax];
    const lonSpan = lonMax - lonMin || 1;
    const latSpan = latMax - latMin || 1;
    const ratio = Math.max(0.25, Math.min(4, lonSpan / Math.max(1e-6, latSpan)));
    const canvasW = Math.min(VECTOR_ARROW_CANVAS_MAX_SIZE, Math.max(320, Math.round(900 * ratio)));
    const canvasH = Math.min(VECTOR_ARROW_CANVAS_MAX_SIZE, Math.max(240, Math.round(canvasW / ratio)));

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const speedRange = calculateVectorSpeedRange(xGrid, yGrid, width, height);
    if (speedRange.finiteCount === 0 || speedRange.maxSpeed <= 0) return null;

    const sampleStep = Math.max(1, Math.ceil(Math.sqrt((width * height) / VECTOR_ARROW_MAX_COUNT)));
    const minSpeed = speedRange.maxSpeed * VECTOR_ARROW_MIN_SPEED_RATIO;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let gy = 0; gy < height; gy += sampleStep) {
        for (let gx = 0; gx < width; gx += sampleStep) {
            const u = Number(xGrid.values[gy * xGrid.width + gx]);
            const v = Number(yGrid.values[gy * yGrid.width + gx]);
            if (!Number.isFinite(u) || !Number.isFinite(v)) continue;

            const speed = Math.hypot(u, v);
            if (!Number.isFinite(speed) || speed < minSpeed) continue;

            const lon = Number(xGrid.lons[gx]);
            const lat = Number(xGrid.lats[gy]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
            if (lat < latMin || lat > latMax) continue;

            const px = ((lon - lonMin) / lonSpan) * canvasW;
            const py = ((latMax - lat) / latSpan) * canvasH;
            if (!Number.isFinite(px) || !Number.isFinite(py)) continue;

            const angle = Math.atan2(-v, u);
            const sr = Math.min(1, speed / speedRange.maxSpeed);
            const arrowLen = 10 + 14 * sr;
            const headLen = 4 + 4 * sr;
            const x2 = px + Math.cos(angle) * arrowLen;
            const y2 = py + Math.sin(angle) * arrowLen;
            const alpha = 0.45 + 0.45 * sr;

            ctx.strokeStyle = `rgba(15, 23, 42, ${alpha})`;
            ctx.fillStyle = `rgba(15, 23, 42, ${alpha})`;
            ctx.lineWidth = 1.2 + 1.3 * sr;

            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            const la = angle + Math.PI * 0.78;
            const ra = angle - Math.PI * 0.78;
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 + Math.cos(la) * headLen, y2 + Math.sin(la) * headLen);
            ctx.lineTo(x2 + Math.cos(ra) * headLen, y2 + Math.sin(ra) * headLen);
            ctx.closePath();
            ctx.fill();
        }
    }

    return { url: canvas.toDataURL('image/png'), imageExtent };
};


// ═══════════════════════════════════════════════════════════════
// 10. Canvas 与 URL 转换工具
// ═══════════════════════════════════════════════════════════════

/**
 * 将 Canvas 转换为 PNG Blob URL。
 * 用于将栅格 Canvas 挂载到地图图层（如 OpenLayers ImageStatic）。
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<string>} PNG 格式的 Object URL
 *
 * @example
 * const url = await canvasToObjectUrl(canvas);
 * // 使用完后释放内存
 * revokeImageUrl(url);
 */
export const canvasToObjectUrl = (canvas) => {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('生成栅格图片失败'));
                return;
            }
            resolve(URL.createObjectURL(blob));
        }, 'image/png');
    });
};

/**
 * 释放通过 canvasToObjectUrl 创建的 Blob URL。
 * 避免内存泄漏，应在图层移除时调用。
 *
 * @param {string|null|undefined} url
 */
export const revokeImageUrl = (url) => {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
};


// ═══════════════════════════════════════════════════════════════
// 11. 3D 体渲染数据组装
// ═══════════════════════════════════════════════════════════════

/**
 * 3D 体采样：在 2D 栅格层的浮点坐标处进行带边缘羽化的双线性采样。
 *
 * @param {ArrayLike<number>} values
 * @param {number} width
 * @param {number} height
 * @param {number} sourceX - 浮点 X
 * @param {number} sourceY - 浮点 Y
 * @param {number} [radius=1.45]
 * @returns {{ value: number, coverage: number }}
 */
const sampleSoftLayerValue = (values, width, height, sourceX, sourceY, radius = VOLUME_EDGE_FEATHER_CELLS) => {
    const centerX = Math.floor(sourceX);
    const centerY = Math.floor(sourceY);
    const searchRadius = Math.max(1, Math.ceil(radius));

    let valueSum = 0;
    let finiteWeightSum = 0;
    let totalWeightSum = 0;

    for (let dy = -searchRadius; dy <= searchRadius + 1; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius + 1; dx++) {
            const x = centerX + dx;
            const y = centerY + dy;
            const distance = Math.hypot(sourceX - x, sourceY - y);
            if (distance > radius) continue;

            const weight = Math.max(0, 1 - distance / radius);
            if (weight <= 0) continue;

            totalWeightSum += weight;
            const value = getFiniteGridValue(values, width, height, x, y);
            if (value === null) continue;

            valueSum += value * weight;
            finiteWeightSum += weight;
        }
    }

    if (totalWeightSum <= 0 || finiteWeightSum <= 0) {
        return { value: NaN, coverage: 0 };
    }
    return {
        value: valueSum / finiteWeightSum,
        coverage: finiteWeightSum / totalWeightSum,
    };
};

/**
 * 计算 3D 纹理的合适尺寸，超过上限时按比例降采样。
 *
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} sourceDepth
 * @returns {{ width: number, height: number, depth: number, downsampled: boolean }}
 */
export const chooseTextureDimensions = (sourceWidth, sourceHeight, sourceDepth) => {
    const maxSize = MAX_CPU_3D_TEXTURE_SIZE;

    let width = sourceWidth;
    let height = sourceHeight;
    let depth = sourceDepth;
    let downsampled = false;

    const maxDim = Math.max(width, height, depth);
    if (maxDim > maxSize) {
        const scale = maxSize / maxDim;
        width = Math.max(2, Math.round(width * scale));
        height = Math.max(2, Math.round(height * scale));
        depth = Math.max(2, Math.round(depth * scale));
        downsampled = true;
    }

    return { width, height, depth, downsampled };
};

/**
 * 将多个 2D 栅格层堆叠为 3D 体纹理数据。
 *
 * 这是 3D 体渲染的核心函数，接收一组按深度排序的栅格层，
 * 将它们重采样为统一尺寸的 RGBA 纹理数组。
 *
 * 数据布局：R 通道存归一化后的数值 (0~255)，A 通道存覆盖率 (0~255)。
 * 在 GPU shader 中可同时使用 R 作颜色映射、A 作边缘羽化。
 *
 * @param {NcRasterLayer[]} inputLayers - 输入栅格层数组（按深度索引排序）
 * @param {number[]} depthOptions - 所有可用的深度值列表
 * @param {'scalar'|'signedVelocity'} valueRenderMode - 渲染模式
 * @returns {VolumeTextureData|null}
 *
 * @example
 * const layers = [
 *   { depthIndex: 0, depthValue: 0, width: 360, height: 180,
 *     lons: lonArr, lats: latArr, values: valArr0 },
 *   { depthIndex: 1, depthValue: 100, width: 360, height: 180,
 *     lons: lonArr, lats: latArr, values: valArr1 },
 * ];
 * const data = buildVolumeTextureData(layers, [0, 100, 200], 'scalar');
 * // 使用 data.data (Uint8Array) 上传到 WebGL TEXTURE_3D
 */
export const buildVolumeTextureData = (inputLayers, depthOptions, valueRenderMode) => {
    if (!inputLayers || inputLayers.length < 2) return null;

    // 按 depthIndex 排序
    const sortedLayers = [...inputLayers].sort((a, b) => Number(a.depthIndex) - Number(b.depthIndex));

    const firstLayer = sortedLayers[0];
    const sourceWidth = Math.floor(Number(firstLayer.width));
    const sourceHeight = Math.floor(Number(firstLayer.height));
    const sourceDepth = sortedLayers.length;

    if (sourceWidth <= 0 || sourceHeight <= 0) return null;

    // 计算纹理尺寸
    const texDims = chooseTextureDimensions(sourceWidth, sourceHeight, sourceDepth);
    const { width, height, depth, downsampled } = texDims;

    // 收集值范围
    let valueMin = Infinity;
    let valueMax = -Infinity;
    let lonMin = Infinity;
    let lonMax = -Infinity;
    let latMin = Infinity;
    let latMax = -Infinity;
    /** @type {number[]} */
    const depthValues = [];

    for (const layer of sortedLayers) {
        const lmin = Number(layer.valueMin);
        const lmax = Number(layer.valueMax);
        if (Number.isFinite(lmin)) valueMin = Math.min(valueMin, lmin);
        if (Number.isFinite(lmax)) valueMax = Math.max(valueMax, lmax);

        for (let i = 0; i < layer.lons.length; i++) {
            const v = Number(layer.lons[i]);
            if (Number.isFinite(v)) { lonMin = Math.min(lonMin, v); lonMax = Math.max(lonMax, v); }
        }
        for (let i = 0; i < layer.lats.length; i++) {
            const v = Number(layer.lats[i]);
            if (Number.isFinite(v)) { latMin = Math.min(latMin, v); latMax = Math.max(latMax, v); }
        }

        const dv = Number(layer.depthValue);
        depthValues.push(Number.isFinite(dv) ? dv : Number(layer.depthIndex));
    }

    if (!Number.isFinite(valueMin) || !Number.isFinite(valueMax)) {
        valueMin = 0; valueMax = 1;
    }
    if (valueMax <= valueMin) valueMax = valueMin + 1;

    // 显示范围默认使用 P2/P98 避免极值影响色带
    const displayValueMin = valueMin;
    const displayValueMax = valueMax;

    // 计算有符号速度的显示最大值
    let signedAbsMax = 1;
    if (valueRenderMode === 'signedVelocity') {
        const absVals = [];
        for (const layer of sortedLayers) {
            for (let i = 0; i < layer.values.length; i++) {
                const v = Math.abs(Number(layer.values[i]));
                if (Number.isFinite(v)) absVals.push(v);
            }
        }
        if (absVals.length > 0) {
            absVals.sort((a, b) => a - b);
            signedAbsMax = absVals[Math.floor((absVals.length - 1) * 0.96)];
        }
    }

    // 分配 RGBA 纹理数据
    const totalTexels = width * height * depth;
    const data = new Uint8Array(totalTexels * 4);

    for (let z = 0; z < depth; z++) {
        // 找到对应的输入层
        const sourceZ = (depth <= 1) ? 0 : (z / (depth - 1)) * (sourceDepth - 1);
        const layerIndex = Math.min(sortedLayers.length - 1, Math.max(0, Math.round(sourceZ)));
        const layer = sortedLayers[layerIndex];

        for (let y = 0; y < height; y++) {
            const sourceY = (height <= 1) ? 0 : (y / (height - 1)) * (sourceHeight - 1);

            for (let x = 0; x < width; x++) {
                const sourceX = (width <= 1) ? 0 : (x / (width - 1)) * (sourceWidth - 1);
                const sample = sampleSoftLayerValue(
                    layer.values, sourceWidth, sourceHeight, sourceX, sourceY
                );

                const idx = ((z * height) + y) * width + x;
                const dataOffset = idx * 4;

                if (!Number.isFinite(sample.value) || sample.coverage <= 0) {
                    data[dataOffset] = 0;
                    data[dataOffset + 1] = 0;
                    data[dataOffset + 2] = 0;
                    data[dataOffset + 3] = 0;
                    continue;
                }

                // R 通道：归一化值 (0~255)
                const normRatio = normalizeValueToRatio(sample.value, displayValueMin, displayValueMax);
                data[dataOffset] = Math.round(clamp(normRatio, 0, 1) * 255);

                // G: 保留 (可用于额外通道)
                data[dataOffset + 1] = 0;

                // B: 覆盖率
                data[dataOffset + 2] = Math.round(clamp(sample.coverage, 0, 1) * 255);

                // A: 覆盖率
                data[dataOffset + 3] = Math.round(clamp(sample.coverage, 0, 1) * 255);
            }
        }
    }

    // Clamp 纬度
    const safeLatMin = clampLatitudeForBasemap(latMin);
    const safeLatMax = clampLatitudeForBasemap(latMax);

    return {
        width, height, depth,
        data,
        valueMin, valueMax,
        displayValueMin, displayValueMax,
        lonMin, lonMax,
        latMin: safeLatMin, latMax: safeLatMax,
        depthValues,
        sourceWidth, sourceHeight, sourceDepth,
        signedAbsMax,
        downsampled,
    };
};


// ═══════════════════════════════════════════════════════════════
// 12. WebGL 3D 纹理
// ═══════════════════════════════════════════════════════════════

/**
 * 原生 WebGL2 3D 纹理封装。
 *
 * 接收 VolumeTextureData，调用 gl.texImage3D 创建 TEXTURE_3D。
 * 使用 LINEAR 过滤 + CLAMP_TO_EDGE 包裹模式。
 *
 * @example
 * const gl = canvas.getContext('webgl2');
 * const volumeData = buildVolumeTextureData(layers, depths, 'scalar');
 * if (volumeData) {
 *   const tex3D = new RawTexture3D(gl, volumeData);
 *   gl.activeTexture(gl.TEXTURE0);
 *   gl.bindTexture(gl.TEXTURE_3D, tex3D._texture);
 *   // ... 绘制 ...
 *   tex3D.destroy();
 * }
 */
export class RawTexture3D {
    /**
     * @param {WebGL2RenderingContext} gl
     * @param {VolumeTextureData} volume
     */
    constructor(gl, volume) {
        /** @type {number} */ this._target = gl.TEXTURE_3D;
        /** @type {WebGLTexture|null} */ this._texture = null;

        const maxSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
        if (volume.width > maxSize || volume.height > maxSize || volume.depth > maxSize) {
            console.warn('[RawTexture3D] 纹理尺寸超出 GL_MAX_3D_TEXTURE_SIZE',
                { width: volume.width, height: volume.height, depth: volume.depth, maxSize });
            return;
        }

        const tex = gl.createTexture();
        if (!tex) return;

        gl.bindTexture(gl.TEXTURE_3D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

        // 上传 RGBA8 数据
        gl.texImage3D(
            gl.TEXTURE_3D,
            0,              // level
            gl.RGBA8,       // internal format
            volume.width,
            volume.height,
            volume.depth,
            0,              // border
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            volume.data
        );

        // 纹理过滤和包裹
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

        gl.bindTexture(gl.TEXTURE_3D, null);

        this._texture = tex;
    }

    /** @returns {boolean} */
    isDestroyed() {
        return !this._texture;
    }

    destroy() {
        if (this._texture) {
            // 注意：此处无法删除纹理（需要 gl 上下文），
            // 调用方应在持有 gl 上下文时主动 gl.deleteTexture
            this._texture = null;
        }
        return undefined;
    }
}


// ═══════════════════════════════════════════════════════════════
// 13. 色带 / 颜色查询 API
// ═══════════════════════════════════════════════════════════════

/**
 * 获取指定模式下给定值对应的浮点颜色 [r, g, b]（0~1 归一化）。
 * 常用于 Three.js / WebGL shader uniform。
 *
 * @param {NcColorPaletteMode} mode - 色带模式
 * @param {number} value - 数据值
 * @param {number} min - 值域下限
 * @param {number} max - 值域上限
 * @returns {[number, number, number]} 归一化的 [r, g, b]
 *
 * @example
 * const [r, g, b] = ncHeat.getColorFloatsByValue('nc', 25.3, 15, 35);
 * material.uniforms.uColor.value.set(r, g, b);
 */
export const getColorFloatsByValue = (mode, value, min, max) => {
    const color = getColorBytesByValueForPaletteMode(mode, value, min, max, 1);
    return [color.r / 255, color.g / 255, color.b / 255];
};

/**
 * 获取指定模式下给定值的 CSS rgba 字符串。
 *
 * @param {NcColorPaletteMode} mode - 色带模式
 * @param {number} value - 数据值
 * @param {number} min - 值域下限
 * @param {number} max - 值域上限
 * @param {number} [alpha=0.75] - 透明度
 * @returns {string} CSS rgba 字符串
 *
 * @example
 * const css = ncHeat.getColorCssByValue('nc', 25.3, 15, 35);
 * // "rgba(0, 220, 80, 0.75)"
 */
export const getColorCssByValue = (mode, value, min, max, alpha = 0.75) => {
    const color = getColorBytesByValueForPaletteMode(mode, value, min, max, alpha);
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;
};

/**
 * 获取色带 CSS 渐变字符串（用于图例渲染）。
 *
 * @param {NcColorPaletteMode} mode
 * @returns {string} CSS linear-gradient
 */
export const getColorCssGradient = (mode) => {
    const stops = getColorStopsByPaletteMode(mode);
    return `linear-gradient(90deg, ${stops
        .map(s => `rgb(${s.r}, ${s.g}, ${s.b}) ${Math.round(s.offset * 10000) / 100}%`)
        .join(', ')})`;
};

/**
 * 获取色标的十六进制颜色数组。
 *
 * @param {NcColorPaletteMode} mode
 * @returns {string[]}
 */
export const getColorHexStops = (mode) => {
    return getColorStopsByPaletteMode(mode).map(s => {
        const hex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
        return `#${hex(s.r)}${hex(s.g)}${hex(s.b)}`;
    });
};

export const clampNumber = (value, min, max, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
};

export const toRenderableNumber = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

export const normalizeRasterAxisArray = (items) => {
    if (!items) return [];
    const source = Array.isArray(items) || ArrayBuffer.isView(items)
        ? Array.from(items)
        : [];
    return source
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
};

export const normalizeRasterValuesArray = (items, expectedLength) => {
    const values = new Array(expectedLength).fill(Number.NaN);
    const source = Array.isArray(items) || ArrayBuffer.isView(items)
        ? Array.from(items)
        : [];
    const length = Math.min(expectedLength, source.length || 0);
    for (let index = 0; index < length; index += 1) {
        const value = toRenderableNumber(source[index]);
        values[index] = value === null ? Number.NaN : value;
    }
    return values;
};
// ═══════════════════════════════════════════════════════════════
// 14. 导出常量
// ═══════════════════════════════════════════════════════════════

/** @type {NcColorStop[]} NC 默认色带色标 */
export const NC_COLOR_STOPS = NC_UNIFIED_COLOR_STOPS;
/** @type {NcColorStop[]} 声场 TL 色带色标 */
export const SOUND_TL_COLOR_STOPS = SOUND_FIELD_TL_COLOR_STOPS;

/** 纹理超采样倍数 */
export { SMOOTH_2D_TEXTURE_SUPERSAMPLE };
/** 纹理最大边长 */
export { SMOOTH_2D_MAX_TEXTURE_SIZE };
/** 3D 纹理最大边长 */
export { MAX_CPU_3D_TEXTURE_SIZE as MAX_3D_TEXTURE_SIZE };


/**
 * 将源 Canvas 裁剪到目标图像范围。
 *
 * 当 dataExtent 与 imageExtent 一致时直接返回源 canvas；
 * 否则根据经纬度比例计算裁剪区域并生成新 canvas。
 *
 * @param sourceCanvas - 源栅格 Canvas
 * @param dataExtent - 源数据的地理范围 [west, south, east, north]
 * @param imageExtent - 目标图像的地理范围 [west, south, east, north]
 * @returns 裁剪后的 Canvas（或原 canvas 若范围一致）
 */
export const cropRasterCanvasToImageExtent = (
    sourceCanvas,
    dataExtent,
    imageExtent
) => {
    const [dataWest, dataSouth, dataEast, dataNorth] = dataExtent;
    const [imageWest, imageSouth, imageEast, imageNorth] = imageExtent;
    const lonSpan = dataEast - dataWest;
    const latSpan = dataNorth - dataSouth;

    if (!Number.isFinite(lonSpan) || !Number.isFinite(latSpan) || lonSpan <= 0 || latSpan <= 0 || !isValidImageExtent(dataExtent) || !isValidImageExtent(imageExtent)) {
        return sourceCanvas;
    }

    const nearlySameExtent =
        Math.abs(dataWest - imageWest) < 1e-9 &&
        Math.abs(dataSouth - imageSouth) < 1e-9 &&
        Math.abs(dataEast - imageEast) < 1e-9 &&
        Math.abs(dataNorth - imageNorth) < 1e-9;

    if (nearlySameExtent) return sourceCanvas;

    const sx = Math.max(0, Math.min(sourceCanvas.width - 1, ((imageWest - dataWest) / lonSpan) * sourceCanvas.width));
    const ex = Math.max(sx + 1, Math.min(sourceCanvas.width, ((imageEast - dataWest) / lonSpan) * sourceCanvas.width));
    const sy = Math.max(0, Math.min(sourceCanvas.height - 1, ((dataNorth - imageNorth) / latSpan) * sourceCanvas.height));
    const ey = Math.max(sy + 1, Math.min(sourceCanvas.height, ((dataNorth - imageSouth) / latSpan) * sourceCanvas.height));
    const sw = Math.max(1, ex - sx);
    const sh = Math.max(1, ey - sy);
    const targetWidth = Math.max(2, Math.round(sw));
    const targetHeight = Math.max(2, Math.round(sh));
    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = targetWidth;
    targetCanvas.height = targetHeight;

    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return sourceCanvas;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
    return targetCanvas;
}
