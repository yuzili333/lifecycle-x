#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? 'output/hackathon-video')
const output = path.join(root, 'manifest', 'asset-manifest.csv')

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(absolute)))
    else if (entry.isFile()) files.push(absolute)
  }
  return files
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function csv(value) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const reviewedRawAssets = new Set([
  'P02-P03-P12_fields-skills_t08.mp4',
  'P04-P07_execution-report_t03.mp4',
  'P08-P11_followup-evidence-export_t03.mp4',
])

const excludedRawAssets = new Set([
  'P02-P03-P12_fields-skills_t02.mp4',
  'P02-P03-P12_fields-skills_t03.mp4',
  'P02-P03-P12_fields-skills_t04.mp4',
  'P02-P03-P12_fields-skills_t05.mp4',
  'P02-P03-P12_fields-skills_t07.mp4',
  'P04-P07_execution-report_t02.mp4',
  'P08-P11_followup-evidence-export_t02.mp4',
])

const excludedManifestAssets = new Set([
  'P02-P03-P12_fields-skills_t07_contact.png',
])

const reviewedFinalExports = new Set([
  '溯据_黑客松产品介绍_3min_master.mp4',
  '溯据_黑客松产品介绍_3min_submission.mp4',
])

function statusFor(relative, topLevelDirectory) {
  if (topLevelDirectory === 'raw') {
    const basename = path.basename(relative)
    if (relative.includes('_DIAGNOSTIC_') || excludedRawAssets.has(basename)) {
      return 'excluded-diagnostic'
    }
    if (relative.endsWith('_t01.mp4') || reviewedRawAssets.has(basename)) {
      return 'ready'
    }
    return 'pending-review'
  }
  if (
    topLevelDirectory === 'manifest' &&
    excludedManifestAssets.has(path.basename(relative))
  ) {
    return 'excluded-diagnostic'
  }
  if (topLevelDirectory === 'exports') {
    const basename = path.basename(relative)
    if (basename.includes('_REJECTED_')) return 'excluded-diagnostic'
    if (relative.includes(`${path.sep}archive${path.sep}`)) return 'archived'
    if (reviewedFinalExports.has(basename)) return 'ready'
    if (
      basename === '3minmaster.mov' ||
      basename === 'sujudatav04subtitle-polish.mov' ||
      basename === 'sujudatav05subtitle-safe.mov' ||
      basename === 'sujudatav06-slogan-final.mov' ||
      basename === 'sujudatav07-visual-slogan-final.mov'
    ) {
      return 'ready-intermediate'
    }
    return 'pending-review'
  }
  return 'ready'
}

const files = (await walk(root))
  .filter((file) => file !== output && !file.endsWith('.DS_Store'))
  .sort((left, right) => left.localeCompare(right, 'zh-CN'))

const rows = []
for (const file of files) {
  const relative = path.relative(root, file)
  const info = await stat(file)
  const topLevelDirectory = relative.split(path.sep)[0]
  rows.push([
    relative,
    topLevelDirectory,
    info.size,
    await sha256(file),
    statusFor(relative, topLevelDirectory),
  ])
}

const lines = [
  ['relative_path', 'category', 'size_bytes', 'sha256', 'status'],
  ...rows,
].map((row) => row.map(csv).join(','))

await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${lines.join('\n')}\n`, 'utf8')
process.stdout.write(`Wrote ${rows.length} entries to ${output}\n`)
