import { createHash } from 'node:crypto'
import { stageEngine } from '../../../engine/package.mjs'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertDeployable } from '../../../tools/build/deploy-guard.mjs'
import { prepareDeployment } from '../../../tools/build/deploy-build.mjs'

let temporary: string[] = []
let template: string
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim()
const identity = (cwd: string) => {
  git(cwd, 'config', 'user.name', 'Deployment test')
  git(cwd, 'config', 'user.email', 'deploy-test@example.invalid')
}
const commit = (cwd: string, name: string, content = name) => {
  writeFileSync(join(cwd, name), content)
  git(cwd, 'add', name)
  git(cwd, 'commit', '-m', name)
  return git(cwd, 'rev-parse', 'HEAD')
}
beforeAll(() => {
  template = mkdtempSync(join(tmpdir(), 'orbrun-deploy-template-'))
  const dir = template
  git(dir, 'init', '--bare', '--initial-branch=main', 'remote.git')
  git(dir, 'init', '--initial-branch=main', 'publisher')
  const publisher = join(dir, 'publisher'), repo = join(dir, 'repo')
  identity(publisher)
  commit(publisher, '.gitignore', 'dist/\n')
  commit(publisher, 'features.txt', 'original feature\n')
  git(publisher, 'remote', 'add', 'origin', join(dir, 'remote.git'))
  git(publisher, 'push', 'origin', 'main')
  git(dir, 'clone', join(dir, 'remote.git'), 'repo')
  identity(repo)
})
afterAll(() => { if (template) rmSync(template, { recursive: true, force: true }) })

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'orbrun-deploy-guard-'))
  temporary.push(dir)
  // Copy the committed baseline, including independent Git object files. Every
  // test still fetches/pushes against its own real, mutable bare remote.
  cpSync(template, dir, { recursive: true })
  const publisher = join(dir, 'publisher'), repo = join(dir, 'repo')
  for (const checkout of [publisher, repo]) git(checkout, 'remote', 'set-url', 'origin', join(dir, 'remote.git'))
  const advance = () => {
    const head = commit(publisher, 'features.txt', 'new popup feature\n')
    git(publisher, 'push', 'origin', 'main')
    return head
  }
  return { dir, publisher, repo, advance }
}

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true })
  temporary = []
})

describe('production deployment guard with real Git remotes', () => {
  it('fetches past a stale tracking ref and refuses the old feature set before building', () => {
    const { repo, advance } = fixture()
    const old = git(repo, 'rev-parse', 'origin/main'), latest = advance()
    expect(git(repo, 'rev-parse', 'origin/main')).toBe(old)
    const build = vi.fn()
    expect(() => assertDeployable(repo)).toThrow('does not include latest origin/main')
    expect(git(repo, 'rev-parse', 'origin/main')).toBe(latest)
    expect(build).not.toHaveBeenCalled()
  })

  it('allows a clean feature branch that includes current main', () => {
    const { repo } = fixture()
    git(repo, 'switch', '-c', 'corridor')
    const head = commit(repo, 'corridor.txt')
    expect(assertDeployable(repo)).toBe(head)
  })

  it('refuses a diverged branch even when it has its own newer commits', () => {
    const { repo, advance } = fixture()
    commit(repo, 'corridor.txt')
    advance()
    expect(() => assertDeployable(repo)).toThrow('does not include latest origin/main')
  })

  it('allows deployment after latest main is merged, preserving both features', () => {
    const { repo, advance } = fixture()
    commit(repo, 'corridor.txt')
    advance()
    git(repo, 'fetch', 'origin')
    git(repo, 'merge', '--no-edit', 'origin/main')
    expect(assertDeployable(repo)).toBe(git(repo, 'rev-parse', 'HEAD'))
    expect(readFileSync(join(repo, 'features.txt'), 'utf8')).toContain('new popup feature')
    expect(readFileSync(join(repo, 'corridor.txt'), 'utf8')).toBe('corridor.txt')
  })

  it.each(['unstaged', 'staged', 'untracked'])('refuses %s changes that could remove committed features', state => {
    const { repo } = fixture()
    const name = state === 'untracked' ? 'extra.txt' : 'features.txt'
    writeFileSync(join(repo, name), 'different source')
    if (state === 'staged') git(repo, 'add', name)
    expect(() => assertDeployable(repo)).toThrow('commit or stash')
  })

  it('fails closed when fetching fails, even with a valid cached origin/main', () => {
    const { repo, dir } = fixture()
    expect(git(repo, 'rev-parse', 'origin/main')).toBe(git(repo, 'rev-parse', 'HEAD'))
    git(repo, 'remote', 'set-url', 'origin', join(dir, 'missing.git'))
    expect(() => assertDeployable(repo)).toThrow('could not fetch origin/main')
  })

  it('allows detached CI checkouts of current main', () => {
    const { repo } = fixture()
    git(repo, 'checkout', '--detach')
    expect(assertDeployable(repo)).toBe(git(repo, 'rev-parse', 'HEAD'))
  })

  it('rebuilds ignored assets instead of reusing an earlier dist', () => {
    const { repo } = fixture()
    mkdirSync(join(repo, 'dist'))
    writeFileSync(join(repo, 'dist/index.html'), 'stale build')
    prepareDeployment({ cwd: repo, packOffline: false, build: () => writeFileSync(join(repo, 'dist/index.html'), 'current features') })
    expect(readFileSync(join(repo, 'dist/index.html'), 'utf8')).toBe('current features')
  })

  it('reuses app output until inputs change or an output is removed', () => {
    const { repo } = fixture(), dist = join(repo, 'apps/orbrun/dist')
    const build = vi.fn(() => { mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, 'index.html'), 'built') })
    prepareDeployment({ cwd: repo, packOffline: false, build })
    prepareDeployment({ cwd: repo, packOffline: false, build })
    expect(build).toHaveBeenCalledTimes(1)
    writeFileSync(join(repo, 'features.txt'), 'changed')
    prepareDeployment({ cwd: repo, packOffline: false, build })
    expect(build).toHaveBeenCalledTimes(2)
    rmSync(join(dist, 'index.html'))
    prepareDeployment({ cwd: repo, packOffline: false, build })
    expect(build).toHaveBeenCalledTimes(3)
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', process.env.VITE_UMAMI_WEBSITE_ID ? '' : '94db1cb1-74f4-4a40-ad6c-962362670409')
    try {
      prepareDeployment({ cwd: repo, packOffline: false, build })
      expect(build).toHaveBeenCalledTimes(4)
      vi.stubEnv('VITE_CF_BEACON_TOKEN', process.env.VITE_CF_BEACON_TOKEN ? '' : 'test-beacon-token')
      prepareDeployment({ cwd: repo, packOffline: false, build })
      expect(build).toHaveBeenCalledTimes(5)
      vi.stubEnv('VITE_PREVIEW_SHA', 'a'.repeat(40))
      prepareDeployment({ cwd: repo, packOffline: false, build })
      expect(build).toHaveBeenCalledTimes(6)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('stops when building fails', () => {
    const { repo } = fixture()
    expect(() => prepareDeployment({ cwd: repo, packOffline: false, build: () => { throw new Error('build failed') } })).toThrow('build failed')
  })

  it('leaves local Worker development usable with uncommitted changes', () => {
    const { repo } = fixture(), build = vi.fn()
    writeFileSync(join(repo, 'features.txt'), 'work in progress')
    prepareDeployment({ cwd: repo, packOffline: false, command: 'dev', build })
    expect(build).toHaveBeenCalledOnce()
  })
})


it('stages only the tested pair, splits large files and keeps the prior pair when verification fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'crawl-engine-pair-'))
  temporary.push(root)
  const source = join(root, 'source'), target = join(root, 'published')
  const partBytes = 24 * 1024 * 1024
  const commit = 'a'.repeat(40), recipe = 'b'.repeat(16), build = commit + '-' + recipe
  const runtime = 'builds/' + build + '/'
  const artwork = 'gamedata/' + commit + '/'
  const data = runtime + 'crawl.data'
  const names = ['crawl.js', 'crawl.wasm', 'asyncify/crawl.js', 'asyncify/crawl.wasm',
    'crawl.data', 'prewarm/manifest.json', 'prewarm/prewarm.bin'].map(name => runtime + name)
  names.push(artwork + 'enums.js')
  for (const atlas of ['floor', 'wall', 'feat', 'main', 'player', 'gui', 'icons']) {
    names.push(artwork + atlas + '.png', artwork + 'tileinfo-' + atlas + '.js')
  }
  const files = names.map(name => {
    const bytes = name === data ? Buffer.alloc(partBytes + 5, 42) : Buffer.from(name)
    mkdirSync(dirname(join(source, name)), { recursive: true })
    writeFileSync(join(source, name), bytes)
    return [name, bytes.length, createHash('sha256').update(bytes).digest('hex')]
  })
  for (const channel of ['stable', 'trunk']) {
    mkdirSync(join(source, channel))
    writeFileSync(join(source, channel, 'engine.json'), JSON.stringify({
      channel, commit, recipe, build, gamedata: commit, version: '0.34', variants: ['jspi', 'asyncify'], files,
    }))
  }
  mkdirSync(target)
  writeFileSync(join(target, 'old-build'), 'retired')
  stageEngine(source, target)
  expect(existsSync(join(target, 'old-build'))).toBe(false)
  expect(existsSync(join(target, data))).toBe(false)
  expect(readFileSync(join(target, data + '.part0')).length).toBe(partBytes)
  expect(readFileSync(join(target, data + '.part1'))).toEqual(Buffer.alloc(5, 42))
  const oldManifest = readFileSync(join(target, 'stable/engine.json'))
  writeFileSync(join(source, data), 'broken')
  expect(() => stageEngine(source, target)).toThrow('mismatch')
  expect(readFileSync(join(target, 'stable/engine.json'))).toEqual(oldManifest)
  expect(readFileSync(join(target, 'trunk/engine.json'))).toEqual(readFileSync(join(source, 'trunk/engine.json')))
})
