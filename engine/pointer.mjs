// Writes a channel's engine.json: which build it points at, and every file a
// device keeps to play it with no connection (the build and its gamedata),
// with their sizes, so a download can say how far along it is.
//
//   node engine/pointer.mjs <dist> <channel> <commit> <version> <stamp>
//
// build.sh runs it after each build. Files are listed relative to <dist>.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { buildFiles } from '../packages/offline/src/manifest.ts'
import { recipe } from './recipe.mjs'

const [dist, channel, commit, version, stamp] = process.argv.slice(2)
if (!stamp) {
  console.error('usage: node engine/pointer.mjs <dist> <channel> <commit> <version> <stamp>')
  process.exit(1)
}

// the build sits under its commit and recipe (build.sh), its gamedata under the commit alone
const build = `${commit}-${recipe()}`
const paths = buildFiles(build, commit)
const icons = `gamedata/${commit}/status-icon-sizes.js`
if (existsSync(join(dist, icons))) paths.push(icons)
const files = paths.sort().map(path => {
  const body = readFileSync(join(dist, path))
  return [path, body.length, createHash('sha256').update(body).digest('hex')]
})

mkdirSync(join(dist, channel), { recursive: true })
writeFileSync(
  join(dist, channel, 'engine.json'),
  JSON.stringify({ channel, commit, build, version, stamp, gamedata: commit, recipe: recipe(), variants: ['jspi', 'asyncify'], files }) + '\n',
)
