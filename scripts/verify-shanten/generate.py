"""Generate reference shanten fixtures for src/lib/shanten using the `mahjong` package.

Usage (from this folder):
    python -m venv .venv
    .venv/Scripts/python -m pip install -r requirements.txt   (Windows; .venv/bin/python elsewhere)
    .venv/Scripts/python generate.py

Writes fixtures.json: random legal hands drawn from a shuffled 136-tile wall
(so at most 4 copies of any tile), each with mahjong.shanten.Shanten's result.
"""

import json
import random
from importlib.metadata import version
from pathlib import Path

from mahjong.shanten import Shanten

SEED = 20261124
COUNTS = {13: 20_000, 14: 5_000}
OUT = Path(__file__).with_name("fixtures.json")


def random_hand(rng: random.Random, size: int) -> list[int]:
    wall = [tile for tile in range(34) for _ in range(4)]
    counts = [0] * 34
    for tile in rng.sample(wall, size):
        counts[tile] += 1
    return counts


def main() -> None:
    rng = random.Random(SEED)
    hands = []
    for size, n in COUNTS.items():
        for _ in range(n):
            counts = random_hand(rng, size)
            assert sum(counts) == size and max(counts) <= 4
            hands.append({"c": "".join(map(str, counts)), "s": Shanten.calculate_shanten(counts)})
    OUT.write_text(
        json.dumps(
            {
                "generator": "scripts/verify-shanten/generate.py",
                "reference": f"mahjong {version('mahjong')} Shanten.calculate_shanten",
                "seed": SEED,
                "format": "c = 34 tile counts as digits (0-8 man, 9-17 pin, 18-26 sou, 27-33 honors); s = shanten",
                "hands": hands,
            },
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    dist: dict[int, int] = {}
    for h in hands:
        dist[h["s"]] = dist.get(h["s"], 0) + 1
    print(f"wrote {len(hands)} hands to {OUT.name}; shanten distribution: {dict(sorted(dist.items()))}")


if __name__ == "__main__":
    main()
