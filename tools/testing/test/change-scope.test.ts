import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { changeScope } from '../change-scope.mjs'

describe('verification scope', () => {
  it('fails changed-test selection when the base cannot resolve', () => {
    const script = fileURLToPath(new URL('../test-since.mjs', import.meta.url))
    const run = spawnSync(process.execPath, [script, 'refs/invalid base'], { encoding: 'utf8' })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('Cannot find a common ancestor')
  })
  it('skips repository prose but verifies documents embedded in the app', () => {
    expect(changeScope(['README.md', 'AGENTS.md', 'project-notes/RUNBOOK.md']).code).toBe(false)
    expect(changeScope(['ABOUT.md'])).toMatchObject({ code: true, production: true })
  })
  it('keeps unit-only changes free of browser setup', () => {
    expect(changeScope(['packages/webtiles/test/reducer.test.ts'])).toEqual({ code: true, browser: 'none', production: false, deploy: false })
  })
  it('runs full raster checks for the pinned gamedata they load from the unit fixtures', () => {
    const prefix = 'packages/scene-webtiles/test/'
    expect(changeScope([prefix + 'fixtures/gamedata/commit/tileinfo-floor.js']).browser).toBe('full')
    expect(changeScope([prefix + 'fixtures/cdi-git-newgame-d1-cell.json']).browser).toBe('none')
  })
  it('widens for rendering, fixtures, CSS and shared configuration', () => {
    expect(changeScope(['apps/orbrun/src/styles.css']).browser).toBe('smoke')
    expect(changeScope(['apps/orbrun/src/servers.ts'])).toMatchObject({ browser: 'smoke', production: true })
    expect(changeScope(['apps/orbrun/src/release.ts']).production).toBe(true)
    for (const path of ['packages/render-2.5d/src/index.ts', 'packages/render-2d/src/index.ts', 'apps/orbrun/public/room/places/lair.json', 'apps/orbrun/testbed/fixture.ts'])
      expect(changeScope([path]).browser, path).toBe('full')
    expect(changeScope(['tsconfig.base.json'])).toEqual({ code: true, browser: 'full', production: true, deploy: true })
  })
  it('includes the real Git tests when deployment tooling changes', () => {
    expect(changeScope(['tools/build/deploy-guard.mjs'])).toMatchObject({ code: true, deploy: true, production: true })
  })
  it('selects the production tests that exercise the bundled audio worker and menu replay', () => {
    for (const name of ['audio/worker-client', 'audio/pack-worker', 'menu-backdrop', 'menu-demo', 'menu-replay'])
      expect(changeScope([`apps/orbrun/src/${name}.ts`]), name).toMatchObject({ browser: 'smoke', production: true })
  })
  it('never downgrades a wider gate and checks unknown paths conservatively', () => {
    expect(changeScope(['packages/scene/src/index.ts', 'apps/orbrun/src/hud.ts']).browser).toBe('full')
    expect(changeScope(['project-notes/new-script.mjs']).browser).toBe('full')
    expect(changeScope(['new-tool/script.mjs'])).toEqual({ code: true, browser: 'full', production: true, deploy: true })
  })
})
