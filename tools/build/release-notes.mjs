import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * @param {string | undefined} version
 * @param {{appVersion: string, lockVersion: string, changelog: string}} metadata
 */
export function releaseNotes(version, { appVersion, lockVersion, changelog }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) {
    throw new Error('Specify a release version as MAJOR.MINOR.PATCH.')
  }
  if (version !== appVersion || version !== lockVersion) {
    throw new Error(`Requested ${version}, but apps/orbrun uses ${appVersion} and package-lock.json uses ${lockVersion}.`)
  }
  const [, latest = ''] = changelog.replace(/\r\n/g, '\n').split(/^## /m, 2)
  const [heading, ...body] = latest.split('\n')
  const match = /^(\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/.exec(heading)
  if (match?.[1] !== version) {
    throw new Error(`Start CHANGELOG.md with a release section headed "## ${version} — YYYY-MM-DD".`)
  }
  const notes = body.join('\n').trim()
  if (!notes) throw new Error(`Add release notes for ${version} to CHANGELOG.md.`)
  return notes
}

/** @param {string | undefined} version @param {URL} root */
export function readReleaseNotes(version, root) {
  /** @param {string} path */
  const read = path => readFileSync(new URL(path, root), 'utf8')
  return releaseNotes(version, {
    appVersion: JSON.parse(read('apps/orbrun/package.json')).version,
    lockVersion: JSON.parse(read('package-lock.json')).packages['apps/orbrun'].version,
    changelog: read('CHANGELOG.md'),
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(readReleaseNotes(process.argv[2], new URL('../../', import.meta.url)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
