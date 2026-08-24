#!/usr/bin/env python3
"""Render a fixed-height, non-obscuring subtitle strip from an SRT file."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


@dataclass(frozen=True)
class Cue:
    index: int
    start: float
    end: float
    lines: tuple[str, ...]


TIME_RE = re.compile(
    r"(?P<h>\d{2}):(?P<m>\d{2}):(?P<s>\d{2}),(?P<ms>\d{3})"
)


def parse_time(value: str) -> float:
    match = TIME_RE.fullmatch(value.strip())
    if not match:
        raise ValueError(f"Invalid SRT timestamp: {value}")
    parts = {key: int(number) for key, number in match.groupdict().items()}
    return parts["h"] * 3600 + parts["m"] * 60 + parts["s"] + parts["ms"] / 1000


def parse_srt(path: Path) -> list[Cue]:
    cues: list[Cue] = []
    for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8").strip()):
        rows = [row.rstrip() for row in block.splitlines()]
        if len(rows) < 3 or " --> " not in rows[1]:
            raise ValueError(f"Invalid SRT block: {block!r}")
        start_text, end_text = rows[1].split(" --> ", 1)
        cues.append(
            Cue(
                index=int(rows[0]),
                start=parse_time(start_text),
                end=parse_time(end_text),
                lines=tuple(row for row in rows[2:] if row),
            )
        )
    return cues


def render_strip(cue: Cue, output: Path, font_path: Path) -> None:
    width, height = 1920, 72
    image = Image.new("RGB", (width, height), "#0F1724")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width, 1), fill="#376E70")

    font_size = 25 if len(cue.lines) == 1 else 23
    font = ImageFont.truetype(str(font_path), font_size)
    spacing = 2
    boxes = [draw.textbbox((0, 0), line, font=font) for line in cue.lines]
    line_heights = [box[3] - box[1] for box in boxes]
    total_height = sum(line_heights) + spacing * max(0, len(cue.lines) - 1)
    y = (height - total_height) / 2

    for line, box, line_height in zip(cue.lines, boxes, line_heights):
        line_width = box[2] - box[0]
        x = (width - line_width) / 2
        draw.text(
            (x, y - box[1]),
            line,
            font=font,
            fill="#E6EDF6",
            stroke_width=1,
            stroke_fill="#0A101B",
        )
        y += line_height + spacing

    image.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--srt", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--font",
        type=Path,
        default=Path(
            "/System/Library/AssetsV2/com_apple_MobileAsset_Font8/"
            "86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData/PingFang.ttc"
        ),
    )
    args = parser.parse_args()

    cues = parse_srt(args.srt)
    if not cues:
        raise ValueError("SRT contains no cues")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    concat_lines = ["ffconcat version 1.0"]
    for cue in cues:
        filename = f"caption-{cue.index:03d}.png"
        render_strip(cue, args.output_dir / filename, args.font)
        concat_lines.append(f"file '{filename}'")
        concat_lines.append(f"duration {cue.end - cue.start:.3f}")
    concat_lines.append(f"file 'caption-{cues[-1].index:03d}.png'")
    (args.output_dir / "captions.ffconcat").write_text(
        "\n".join(concat_lines) + "\n", encoding="utf-8"
    )
    print(f"Rendered {len(cues)} subtitle cards through {cues[-1].end:.3f}s")


if __name__ == "__main__":
    main()
