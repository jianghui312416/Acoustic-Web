"""Serve the built dist and the local GEBCO terrain API on one port.

This script is copied into dist/ by `npm run package:dist`. The target computer
only needs Python with h5py/numpy; it does not need Node or the source project.

    python serve_dist.py --nc "D:\JD功能开发\HYdata\GEBCO_2026_sub_ice.nc"

Then open http://127.0.0.1:8080 in a browser.
"""
import argparse
import json
import os
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    import h5py
    import numpy as np
except ImportError as error:
    raise SystemExit("需要 Python 依赖，请先执行：pip install h5py numpy") from error

DEFAULT_NC_PATH = r"D:\JD功能开发\HYdata\GEBCO_2026_sub_ice.nc"


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


class GebcoGrid:
    def __init__(self, path):
        self.dataset = h5py.File(path, "r")
        self.lon = self.dataset["lon"][:]
        self.lat = self.dataset["lat"][:]
        self.elevation = self.dataset["elevation"]
        self.fill_value = self.elevation.fillvalue
        self.lock = threading.Lock()

    def subset(self, west, east, south, north, resolution):
        lat_window, count, last_lat = axis_window(self.lat, south, north, resolution)
        lon_window, _, last_lon = axis_window(self.lon, west, east, resolution)
        with self.lock:
            values, src_lat, src_lon = read_window(
                self.elevation, self.lat, self.lon,
                lat_window, lon_window, last_lat, last_lon,
            )

        values = values.astype(np.float64, copy=False)
        if self.fill_value is not None:
            values[values == float(self.fill_value)] = np.nan

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
        serialized = [
            None if not np.isfinite(value) else float(value)
            for value in rows.ravel()
        ]
        return {
            "width": int(count),
            "height": int(count),
            "values": serialized,
            "bounds": {
                "west": float(west), "east": float(east),
                "south": float(south), "north": float(north),
            },
            "source": "GEBCO_2026_sub_ice",
        }

    def close(self):
        self.dataset.close()


class AppHandler(SimpleHTTPRequestHandler):
    grid = None
    server_version = "AcousticFieldDeploy/1.0"

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".wasm": "application/wasm",
        ".bin": "application/octet-stream",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self.send_json(200, {"ok": True})
        if parsed.path == "/api/gebco":
            return self.handle_gebco(parsed)
        return super().do_GET()

    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_gebco(self, parsed):
        try:
            query = parse_qs(parsed.query)
            params = {
                name: float(query[name][0])
                for name in ("west", "east", "south", "north")
                if name in query
            }
            resolution = int(float(query.get("resolution", ["96"])[0]))
            if (
                len(params) != 4
                or params["west"] >= params["east"]
                or params["south"] >= params["north"]
            ):
                return self.send_json(400, {"error": "无效的 GEBCO 选区参数"})
            payload = self.grid.subset(
                params["west"],
                params["east"],
                params["south"],
                params["north"],
                max(2, min(512, resolution)),
            )
            self.send_json(200, payload)
        except Exception as error:
            self.send_json(503, {"error": f"{type(error).__name__}: {error}"})

    def log_message(self, fmt, *args):
        print(f"[dist] {self.address_string()} {fmt % args}", flush=True)


def find_nc_path(explicit):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        explicit,
        os.environ.get("GEBCO_NC_PATH"),
        os.path.join(script_dir, "GEBCO_2026_sub_ice.nc"),
        os.path.join(script_dir, "..", "GEBCO_2026_sub_ice.nc"),
        DEFAULT_NC_PATH,
    ]
    tried = []
    for candidate in candidates:
        if not candidate:
            continue
        path = os.path.abspath(candidate)
        if path in tried:
            continue
        tried.append(path)
        if os.path.exists(path):
            return path
    raise SystemExit(
        "找不到 GEBCO 文件，请用 --nc 指定路径，例如：\n"
        '  python serve_dist.py --nc "D:\\JD功能开发\\HYdata\\GEBCO_2026_sub_ice.nc"\n'
        "已尝试：\n  " + "\n  ".join(tried)
    )


def find_dist_dir(explicit):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [explicit, script_dir, os.path.join(script_dir, "..", "dist")]
    for candidate in candidates:
        if candidate and os.path.exists(os.path.join(candidate, "index.html")):
            return os.path.abspath(candidate)
    raise SystemExit("找不到前端 dist/index.html，请把本脚本放在 dist 目录内运行")


def main():
    parser = argparse.ArgumentParser(description="Serve dist + local GEBCO on one port")
    parser.add_argument("--nc", help="GEBCO 2026 NetCDF 文件路径")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--dist", help="dist 目录（默认自动查找）")
    args = parser.parse_args()

    nc_path = find_nc_path(args.nc)
    dist_dir = find_dist_dir(args.dist)
    grid = GebcoGrid(nc_path)
    AppHandler.grid = grid
    handler = partial(AppHandler, directory=dist_dir)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    server.daemon_threads = True

    print(f"[dist] 前端目录：{dist_dir}", flush=True)
    print(f"[dist] GEBCO 文件：{nc_path}", flush=True)
    print(f"[dist] 本机访问：http://127.0.0.1:{args.port}", flush=True)
    print(f"[dist] 局域网访问：http://<本机IP>:{args.port}", flush=True)
    print(f"[dist] 地形接口：http://127.0.0.1:{args.port}/api/gebco", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        grid.close()


if __name__ == "__main__":
    main()
