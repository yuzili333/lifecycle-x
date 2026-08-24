#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const subtitlePath = path.resolve(
  process.argv[2] ??
    'output/hackathon-video/subtitles/溯据_黑客松产品介绍_zh-CN.srt',
)

function parseTimestamp(value) {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/)
  if (!match) throw new Error(`Invalid timestamp: ${value}`)

  const [, hours, minutes, seconds, milliseconds] = match
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(milliseconds)
  )
}

const source = fs.readFileSync(subtitlePath, 'utf8').trim()
const blocks = source.split(/\r?\n\r?\n/)
let previousEnd = 0
const errors = []

for (const [index, block] of blocks.entries()) {
  const [sequence, timing, ...lines] = block.split(/\r?\n/)
  const expectedSequence = String(index + 1)
  if (sequence !== expectedSequence) {
    errors.push(`Cue ${expectedSequence}: sequence is ${sequence}`)
  }

  const timingMatch = timing?.match(/^(.+) --> (.+)$/)
  if (!timingMatch) {
    errors.push(`Cue ${expectedSequence}: invalid timing line`)
    continue
  }

  const start = parseTimestamp(timingMatch[1])
  const end = parseTimestamp(timingMatch[2])
  if (start < previousEnd) errors.push(`Cue ${expectedSequence}: overlaps previous cue`)
  if (end <= start) errors.push(`Cue ${expectedSequence}: non-positive duration`)
  if (end > 180_000) errors.push(`Cue ${expectedSequence}: ends after 180 seconds`)
  previousEnd = end

  if (lines.length === 0 || lines.length > 2) {
    errors.push(`Cue ${expectedSequence}: expected one or two subtitle lines`)
  }

  for (const line of lines) {
    const hanCharacters = line.match(/\p{Script=Han}/gu)?.length ?? 0
    if (hanCharacters > 18) {
      errors.push(
        `Cue ${expectedSequence}: ${hanCharacters} Chinese characters in “${line}”`,
      )
    }
  }
}

const result = {
  file: subtitlePath,
  cues: blocks.length,
  endSeconds: previousEnd / 1_000,
  maxChineseCharactersPerLine: 18,
  status: errors.length === 0 ? 'pass' : 'fail',
  errors,
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (errors.length > 0) process.exitCode = 1
