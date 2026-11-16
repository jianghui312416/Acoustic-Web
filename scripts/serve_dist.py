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


def axis_slice(axis, minimum, maximum, requested):
    first = int(np.searchsorted(axis, minimum, side="left"))
    last = int(np.searchsorted(axis, maximum, side="right")) - 1
    first = max(0, min(len(axis) - 1, first))
    last = max(first, min(len(axis) - 1, last))
    count = max(2, min(512, int(requested)))
    stride = max(1, (last - first) // (count - 1))
    end = min(last, first + stride * (count - 1))
    return slice(first, end + 1, stride)


class GebcoGrid:
    def __init__(self, path):
        self.dataset = h5py.File(path, "r")
        self.lon = self.dataset["lon"][:]
        self.lat = self.dataset["lat"][:]
        self.elevation = self.dataset["elevation"]
        self.fill_value = self.elevation.fillvalue
        self.lock = threading.Lock()

    def subset(self, west, east, south, north, resolution):
        xs = axis_slice(self.lon, west, east, resolution)
        ys = axis_slice(self.lat, south, north, resolution)
        with self.lock:
            values = np.asarray(self.elevation[ys, xs][::-1], dtype=np.float32)
        serialized = [
            None if value == self.fill_value else float(value)
            for value in values.ravel()
        ]
        return {
            "width": int(values.shape[1]),
            "height": int(values.shape[0]),
            "values": serialized,
            "bounds": {
                "west": float(self.lon[xs.start]),
                "east": float(self.lon[xs.stop - 1]),
                "south": float(self.lat[ys.start]),
                "north": float(self.lat[ys.stop - 1]),
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
