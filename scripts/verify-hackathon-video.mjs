#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const [, , ...inputs] = process.argv;

if (inputs.length === 0) {
  console.error("Usage: node scripts/verify-hackathon-video.mjs <video> [video...]");
  process.exit(2);
}

const expected = {
  codec: "h264",
  width: 1920,
  height: 1080,
  fps: 30,
  audioCodec: "aac",
  maxDurationSeconds: 180,
  targetDurationSeconds: 179.8,
};

function probe(file) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels,bit_rate",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `ffprobe failed with status ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

function parseRate(value) {
  const [numerator, denominator = "1"] = String(value ?? "0/1").split("/").map(Number);
  return denominator === 0 ? 0 : numerator / denominator;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

let failed = false;

for (const input of inputs) {
  const file = path.resolve(input);
  try {
    const metadata = probe(file);
    const fileStat = await stat(file);
    const video = metadata.streams?.find((stream) => stream.codec_type === "video");
    const audio = metadata.streams?.find((stream) => stream.codec_type === "audio");
    const duration = Number(metadata.format?.duration ?? 0);
    const fps = parseRate(video?.r_frame_rate);
    const issues = [];

    if (!video) issues.push("missing video stream");
    if (!audio) issues.push("missing audio stream");
    if (video?.codec_name !== expected.codec) issues.push(`video codec ${video?.codec_name ?? "unknown"}, expected h264`);
    if (video?.width !== expected.width || video?.height !== expected.height) {
      issues.push(`dimensions ${video?.width ?? 0}x${video?.height ?? 0}, expected 1920x1080`);
    }
    if (Math.abs(fps - expected.fps) > 0.01) issues.push(`frame rate ${fps.toFixed(3)}, expected 30`);
    if (audio?.codec_name !== expected.audioCodec) issues.push(`audio codec ${audio?.codec_name ?? "unknown"}, expected aac`);
    if (duration > expected.maxDurationSeconds + 0.01) issues.push(`duration ${duration.toFixed(3)}s exceeds 180s`);
    if (duration < 175) issues.push(`duration ${duration.toFixed(3)}s is unexpectedly short`);

    const summary = {
      file,
      sizeBytes: fileStat.size,
      durationSeconds: duration,
      targetDeltaSeconds: duration - expected.targetDurationSeconds,
      video: video
        ? {
            codec: video.codec_name,
            width: video.width,
            height: video.height,
            fps,
            pixelFormat: video.pix_fmt,
            bitRate: Number(video.bit_rate ?? 0) || null,
          }
        : null,
      audio: audio
        ? {
            codec: audio.codec_name,
            sampleRate: Number(audio.sample_rate ?? 0) || null,
            channels: audio.channels ?? null,
            bitRate: Number(audio.bit_rate ?? 0) || null,
          }
        : null,
      sha256: await sha256(file),
      status: issues.length === 0 ? "pass" : "fail",
      issues,
    };

    console.log(JSON.stringify(summary, null, 2));
    if (issues.length > 0) failed = true;
  } catch (error) {
    failed = true;
    console.error(JSON.stringify({ file, status: "error", error: error.message }, null, 2));
  }
}

process.exit(failed ? 1 : 0);

