"""Persistent JSON-lines reader for a local GEBCO NetCDF 4 / HDF5 grid."""
import json
import sys

import h5py
import numpy as np


def axis_slice(axis, minimum, maximum, requested):
    first = int(np.searchsorted(axis, minimum, side="left"))
    last = int(np.searchsorted(axis, maximum, side="right")) - 1
    first = max(0, min(len(axis) - 1, first))
    last = max(first, min(len(axis) - 1, last))
    count = max(2, min(512, int(requested)))
    stride = max(1, (last - first) // (count - 1))
    end = min(last, first + stride * (count - 1))
    return slice(first, end + 1, stride)


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
                resolution = request.get("resolution", 96)
                xs = axis_slice(lon, float(request["west"]), float(request["east"]), resolution)
                ys = axis_slice(lat, float(request["south"]), float(request["north"]), resolution)
                values = np.asarray(elevation[ys, xs][::-1], dtype=np.float32)
                fill_value = elevation.fillvalue
                serialized_values = [None if value == fill_value else float(value) for value in values.ravel()]
                payload = {
                    "id": request_id,
                    "width": int(values.shape[1]),
                    "height": int(values.shape[0]),
                    "values": serialized_values,
                    "bounds": {
                        "west": float(lon[xs.start]), "east": float(lon[xs.stop - 1]),
                        "south": float(lat[ys.start]), "north": float(lat[ys.stop - 1]),
                    },
                    "source": "GEBCO_2026_sub_ice",
                }
            except Exception as error:
                payload = {"id": request_id, "error": f"{type(error).__name__}: {error}"}
            print(json.dumps(payload, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
