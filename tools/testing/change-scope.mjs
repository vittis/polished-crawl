import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Conservative CI routing. Unknown paths run every gate; never silently skip new tooling.
 * @param {string[]} paths
 */
export function changeScope(paths) {
  const scope = { code: false, browser: 'none', production: false, deploy: false }
  const full = () => Object.assign(scope, { code: true, browser: 'full', production: true, deploy: true })
  for (const path of paths) {
    // ABOUT/INSTALL/STEAM/CHANGELOG are built into the site and are NOT docs-only.
    if (/^project-notes\/.*\.(?:md|json|png|jpg)$/.test(path) || /^(README|CONTRIBUTING|AGENTS)\.md$/.test(path)) continue
    scope.code = true
    if (/^(tools\/testing\/|tests\/browser\/|\.github\/|(?:package(?:-lock)?\.json|.*config\.[^/]+)$)/.test(path)) { full(); continue }
    if (/^tools\/build\//.test(path) || path === 'apps/orbrun/test/deploy-guard.test.ts') {
      scope.deploy = true; scope.production = true; continue
    }
    // The spell and scenery raster fixtures import the pinned tile tables as raw text.
    if (path.startsWith('packages/scene-webtiles/test/fixtures/gamedata/')) { scope.browser = 'full'; continue }
    if (/^(apps\/[^/]+\/test\/|packages\/[^/]+\/test\/)/.test(path)) continue
    if (/^packages\/(render-2(?:\.5)?d|scene(?:-webtiles)?)\//.test(path) || /^apps\/orbrun\/(testbed|public\/room|src\/room)\//.test(path)) {
      scope.browser = 'full'; continue
    }
    if (/^apps\/orbrun\/src\/(?:audio\/|(?:main|menu(?:-backdrop|-demo|-replay)?|site|servers|count|analytics|markdown|release)\.ts$)/.test(path)) scope.production = true
    if (/^apps\/orbrun\/src\//.test(path) || /^packages\/(webtiles|gamedata)\//.test(path)) {
      if (scope.browser === 'none') scope.browser = 'smoke'
      continue
    }
    if (/^packages\/(offline|vault)\//.test(path)) continue
    if (/^apps\/orbrun\/(worker\/|public\/|site\/|[^/]+$)/.test(path) || /^(ABOUT|INSTALL|STEAM|CHANGELOG)\.md$/.test(path)) {
      scope.production = true
      if (scope.browser === 'none') scope.browser = 'smoke'
      continue
    }
    full()
  }
  return scope
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base = 'HEAD', head] = process.argv.slice(2)
  // Include both sides of renames so moving code into a docs path cannot hide it.
  const diff = execFileSync('git', ['diff', '--merge-base', '--name-only', '--no-renames', '-z', '--end-of-options', base, ...(head ? [head] : []), '--'], { encoding: 'utf8' })
  const untracked = head ? '' : execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  const paths = [...new Set((diff + untracked).split('\0').filter(Boolean))]
  const scope = changeScope(paths)
  const commands = []
  if (scope.code) commands.push('npm run verify')
  if (scope.deploy) commands.push('npm run test:deploy')
  if (scope.browser !== 'none') commands.push(scope.browser === 'full' ? 'npm run verify:render' : 'npm run verify:browser')
  if (scope.production) commands.push('npm run verify:production')
  console.log(JSON.stringify({ base, head: head ?? 'working tree', paths, ...scope, commands }, null, 2))
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(scope).map(([key, value]) => `${key}=${value}\n`).join(''))
}
