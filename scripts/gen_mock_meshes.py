#!/usr/bin/env python3
"""
Generate placeholder STL meshes for the mock_6dof URDF.

Idempotent — re-running rewrites the same files. No external deps; emits
binary STL by hand. Each mesh is a simple cube or cylinder primitive
positioned in its link's local frame.

Usage (from repo root):
    python scripts/gen_mock_meshes.py
"""
from __future__ import annotations

import math
import struct
from pathlib import Path


Vec3 = tuple[float, float, float]
Tri = tuple[Vec3, Vec3, Vec3, Vec3]  # (normal, v1, v2, v3)


def write_binary_stl(path: Path, triangles: list[Tri]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        f.write(b"\0" * 80)  # 80-byte header
        f.write(struct.pack("<I", len(triangles)))
        for n, v1, v2, v3 in triangles:
            f.write(struct.pack("<3f", *n))
            f.write(struct.pack("<3f", *v1))
            f.write(struct.pack("<3f", *v2))
            f.write(struct.pack("<3f", *v3))
            f.write(b"\0\0")  # attribute byte count


def box(sx: float, sy: float, sz: float, cx: float = 0, cy: float = 0, cz: float = 0) -> list[Tri]:
    """Axis-aligned box centered on (cx, cy, cz). Triangles wound CCW from outside."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    p = [
        (cx - hx, cy - hy, cz - hz),
        (cx + hx, cy - hy, cz - hz),
        (cx + hx, cy + hy, cz - hz),
        (cx - hx, cy + hy, cz - hz),
        (cx - hx, cy - hy, cz + hz),
        (cx + hx, cy - hy, cz + hz),
        (cx + hx, cy + hy, cz + hz),
        (cx - hx, cy + hy, cz + hz),
    ]
    faces = [
        ((0, 0, -1), [0, 2, 1, 0, 3, 2]),
        ((0, 0, 1),  [4, 5, 6, 4, 6, 7]),
        ((0, -1, 0), [0, 1, 5, 0, 5, 4]),
        ((0, 1, 0),  [2, 3, 7, 2, 7, 6]),
        ((-1, 0, 0), [0, 4, 7, 0, 7, 3]),
        ((1, 0, 0),  [1, 2, 6, 1, 6, 5]),
    ]
    tris: list[Tri] = []
    for n, idx in faces:
        for i in range(0, 6, 3):
            tris.append((n, p[idx[i]], p[idx[i + 1]], p[idx[i + 2]]))
    return tris


def cylinder(radius: float, height: float, segments: int = 16, cz: float = 0) -> list[Tri]:
    """Cylinder along Z, centered at (0, 0, cz)."""
    tris: list[Tri] = []
    bottom_z = cz - height / 2
    top_z = cz + height / 2
    for i in range(segments):
        a0 = 2 * math.pi * i / segments
        a1 = 2 * math.pi * (i + 1) / segments
        x0, y0 = radius * math.cos(a0), radius * math.sin(a0)
        x1, y1 = radius * math.cos(a1), radius * math.sin(a1)
        nx, ny = math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2)
        tris.append(((nx, ny, 0), (x0, y0, bottom_z), (x1, y1, bottom_z), (x1, y1, top_z)))
        tris.append(((nx, ny, 0), (x0, y0, bottom_z), (x1, y1, top_z), (x0, y0, top_z)))
        tris.append(((0, 0, -1), (0, 0, bottom_z), (x1, y1, bottom_z), (x0, y0, bottom_z)))
        tris.append(((0, 0, 1), (0, 0, top_z), (x0, y0, top_z), (x1, y1, top_z)))
    return tris


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "robots" / "mock_6dof" / "meshes"

    write_binary_stl(out / "base.stl", cylinder(radius=0.10, height=0.05, cz=0.025))
    write_binary_stl(out / "link1.stl", box(0.06, 0.06, 0.30, cz=0.15))
    write_binary_stl(out / "link2.stl", box(0.06, 0.06, 0.40, cz=0.20))
    write_binary_stl(out / "link3.stl", box(0.05, 0.05, 0.30, cz=0.15))
    write_binary_stl(out / "link4.stl", box(0.05, 0.05, 0.05))
    write_binary_stl(out / "link5.stl", box(0.04, 0.04, 0.04))
    write_binary_stl(out / "link6.stl", box(0.04, 0.04, 0.05, cz=0.025))
    write_binary_stl(out / "tcp.stl", box(0.03, 0.03, 0.03, cz=0.015))

    print(f"wrote 8 meshes to {out}")


if __name__ == "__main__":
    main()
