"""Generate the packed global land mask used to hide AIS positions on land.

Format: ALM2 header + row-major run lengths (ULEB128), alternating ocean/land.
Example:
    python scripts/generate-ais-land-mask.py --source path/to/GEBCO.nc
"""

import argparse
import os
import struct

import h5py
import numpy as np

MAGIC = b"ALM2"
HEADER = struct.Struct("<4sIIffff")


def nearest_indices(axis, centers):
    indices = np.clip(np.searchsorted(axis, centers), 0, len(axis) - 1)
    previous = np.clip(indices - 1, 0, len(axis) - 1)
    return np.where(
        np.abs(axis[previous] - centers) < np.abs(axis[indices] - centers),
        previous,
        indices,
    )


def encode_rle(bits):
    encoded = bytearray()
    previous = 0
    run = 0
    for value in bits:
        if value == previous:
            run += 1
            continue
        write_varint(encoded, run)
        previous = value
        run = 1
    if run:
        write_varint(encoded, run)
    return encoded


def write_varint(target, value):
    while value >= 0x80:
        target.append((value & 0x7F) | 0x80)
        value >>= 7
    target.append(value)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=os.environ.get("GEBCO_NC_PATH"), required=False)
    parser.add_argument("--output", default="src/assets/ais-land-mask.bin")
    parser.add_argument("--width", type=int, default=18000)
    parser.add_argument("--height", type=int, default=9000)
    args = parser.parse_args()
    if not args.source:
        parser.error("--source or GEBCO_NC_PATH is required")

    lon_centers = -180.0 + (np.arange(args.width) + 0.5) * (360.0 / args.width)
    lat_centers = 90.0 - (np.arange(args.height) + 0.5) * (180.0 / args.height)

    with h5py.File(args.source, "r") as dataset:
        lon = dataset["lon"][:]
        lat = dataset["lat"][:]
        elevation = dataset["elevation"]
        fill_value = elevation.fillvalue
        columns = nearest_indices(lon, lon_centers)
        rows = nearest_indices(lat, lat_centers)
        land = np.zeros((args.height, args.width), dtype=np.uint8)
        for row_index, row in enumerate(rows):
            values = np.asarray(elevation[int(row), columns], dtype=np.float32)
            valid = np.isfinite(values) & (values != fill_value)
            land[row_index] = (valid & (values > 0)).astype(np.uint8)

    payload = encode_rle(land.ravel())
    header = HEADER.pack(
        MAGIC,
        args.width,
        args.height,
        -180.0,
        90.0,
        360.0 / args.width,
        180.0 / args.height,
    )
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "wb") as target:
        target.write(header)
        target.write(payload)
    print(
        f"Wrote {args.output}: {args.width}x{args.height}, "
        f"land cells={int(land.sum())}, payload={len(payload)} bytes"
    )


if __name__ == "__main__":
    main()
