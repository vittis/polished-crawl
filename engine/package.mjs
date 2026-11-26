// Stage only the two tested manifests and their files. Retain full files in engine/dist for smoke tests.
import { PART_BYTES, validateManifest } from '../packages/offline/src/manifest.ts'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

// Publish a verified pair together. A failed checksum leaves the previous output intact.
export function stageEngine(dist, target, split = true) {
  mkdirSync(dirname(target), { recursive: true })
  const staging = mkdtempSync(target + '-stage-')
  const next = join(staging, 'next')
  const previous = join(staging, 'previous')
  try {
    writePair(dist, next, split)
    if (existsSync(target)) renameSync(target, previous)
    try { renameSync(next, target) }
    catch (error) {
      if (existsSync(previous)) renameSync(previous, target)
      throw error
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function writePair(dist, target, split) {
  for (const channel of ['stable', 'trunk']) {
    const manifest = readFileSync(join(dist, channel, 'engine.json'))
    const info = JSON.parse(manifest)
    validateManifest(info, channel)
    for (const [path, size, sha] of info.files) {
      const body = readFileSync(join(dist, path))
      if (body.length !== size || createHash('sha256').update(body).digest('hex') !== sha) throw new Error('Engine asset mismatch: ' + path)
      const file = join(target, path)
      mkdirSync(dirname(file), { recursive: true })
      if (!split || size <= PART_BYTES) writeFileSync(file, body)
      else for (let start = 0; start < size; start += PART_BYTES)
        writeFileSync(file + '.part' + start / PART_BYTES, body.subarray(start, start + PART_BYTES))
    }
    mkdirSync(join(target, channel), { recursive: true })
    writeFileSync(join(target, channel, 'engine.json'), manifest)
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === '--archive') stageEngine('engine/dist', process.argv[3], false)
  else stageEngine('engine/dist', 'apps/orbrun/dist/engine')
}
