"""Persistent JSON-lines reader for a local GEBCO NetCDF 4 / HDF5 grid."""
import json
import sys

import h5py
import numpy as np


def axis_window(axis, minimum, maximum, requested):
    """选择覆盖请求范围的采样窗口；返回窗口、输出节点数与高端索引。"""
    first = int(np.searchsorted(axis, minimum, side="right")) - 1
    last = int(np.searchsorted(axis, maximum, side="left"))
    first = max(0, min(len(axis) - 1, first))
    last = max(first, min(len(axis) - 1, last))
    count = max(2, min(512, int(requested)))
    stride = max(1, int(np.ceil((last - first) / (count - 1))))
    start = max(0, last - stride * (count - 1))
    return slice(start, last + 1, stride), count, last


def read_window(elevation, lat, lon, lat_window, lon_window, last_lat_index, last_lon_index):
    """读取窗口内的高程，并补齐请求范围的高端格点。"""
    lat_base = np.arange(lat_window.start, lat_window.stop, lat_window.step, dtype=np.int64)
    lon_base = np.arange(lon_window.start, lon_window.stop, lon_window.step, dtype=np.int64)
    values = np.asarray(elevation[lat_window, lon_window], dtype=np.float32)
    src_lat = np.asarray(lat[lat_base], dtype=np.float64)
    src_lon = np.asarray(lon[lon_base], dtype=np.float64)

    if lon_base[-1] != last_lon_index:
        extra_col = np.asarray(elevation[lat_window, last_lon_index], dtype=np.float32)
        values = np.concatenate([values, extra_col.reshape(-1, 1)], axis=1)
        src_lon = np.append(src_lon, float(lon[last_lon_index]))
    if lat_base[-1] != last_lat_index:
        extra_row = np.asarray(elevation[last_lat_index, lon_base], dtype=np.float32)
        if lon_base[-1] != last_lon_index:
            extra_row = np.append(extra_row, float(elevation[last_lat_index, last_lon_index]))
        values = np.concatenate([values, extra_row.reshape(1, -1)], axis=0)
        src_lat = np.append(src_lat, float(lat[last_lat_index]))
    return values, src_lat, src_lon


def build_payload(request_id, lat, lon, elevation, west, east, south, north, resolution):
    """把窗口重采样到请求边界，保证返回 bounds 与前端选区完全一致。"""
    lat_window, count, last_lat = axis_window(lat, south, north, resolution)
    lon_window, _, last_lon = axis_window(lon, west, east, resolution)
    values, src_lat, src_lon = read_window(
        elevation, lat, lon, lat_window, lon_window, last_lat, last_lon
    )

    fill_value = elevation.fillvalue
    values = values.astype(np.float64, copy=False)
    if fill_value is not None:
        values[values == float(fill_value)] = np.nan

    target_lat = np.linspace(south, north, count)
    target_lon = np.linspace(west, east, count)
    along_lon = np.empty((src_lat.size, count), dtype=np.float64)
    for row in range(src_lat.size):
        along_lon[row] = np.interp(target_lon, src_lon, values[row])
    result = np.empty((count, count), dtype=np.float64)
    for col in range(count):
        result[:, col] = np.interp(target_lat, src_lat, along_lon[:, col])

    # 行方向翻转为“北 → 南”，与前端纬度轴一致。
    rows = result[::-1]
    serialized = [None if not np.isfinite(value) else float(value) for value in rows.ravel()]
    return {
        "id": request_id,
        "width": int(count),
        "height": int(count),
        "values": serialized,
        "bounds": {
            "west": float(west), "east": float(east),
            "south": float(south), "north": float(north),
        },
        "source": "GEBCO_2026_sub_ice",
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: gebco_subset_server.py GEBCO.nc")
    with h5py.File(sys.argv[1], "r") as dataset:
        lon = dataset["lon"][:]
        lat = dataset["lat"][:]
        elevation = dataset["elevation"]
        for raw in sys.stdin:
            request_id = None
            try:
                request = json.loads(raw)
                request_id = request.get("id")
                payload = build_payload(
                    request_id, lat, lon, elevation,
                    float(request["west"]), float(request["east"]),
                    float(request["south"]), float(request["north"]),
                    request.get("resolution", 96),
                )
            except Exception as error:
                payload = {"id": request_id, "error": f"{type(error).__name__}: {error}"}
            print(json.dumps(payload, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
