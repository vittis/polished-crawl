import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, vi } from 'vitest'
import { publish } from '../../build/publish-release.mjs'
import { checkCandidate } from '../../build/release-candidate.mjs'
import { checkHosted } from '../../build/check-hosted.mjs'

test('only the tested merge parent and identical tree qualify', ({ onTestFinished }) => {
  const dir = mkdtempSync(join(tmpdir(), 'crawl-candidate-'))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'main')
  git('commit', '--allow-empty', '-m', 'base')
  git('switch', '-c', 'preview')
  git('commit', '--allow-empty', '-m', 'tested')
  const tested = git('rev-parse', 'HEAD')
  assert.throws(() => checkCandidate(tested, dir), /merge commit/)
  git('switch', 'main')
  git('merge', '--no-ff', 'preview', '-m', 'batch')
  checkCandidate(tested, dir)
  assert.throws(() => checkCandidate(git('rev-parse', 'HEAD^1'), dir), /tested preview SHA/)
  writeFileSync(join(dir, 'other'), 'untested merge resolution')
  git('add', 'other')
  git('commit', '--amend', '--no-edit')
  assert.throws(() => checkCandidate(tested, dir), /changed the tested tree/)
})

test('an HTML fallback for a missing entry asset fails the hosted probe', async () => {
  const ref = 'polished-crawl-v1.0.0'
  const html = `<a href="https://github.com/vittis/polished-crawl/tree/${ref}"></a><script type="module" crossorigin src="/assets/main-123.js"></script>`
  const serve = (mime: string): typeof fetch => async url => String(url).includes('/assets/') ? new Response('body', { headers: { 'content-type': mime } }) : new Response(html)
  await checkHosted(ref, false, serve('application/javascript'))
  await assert.rejects(checkHosted(ref, false, serve('text/html')), /JavaScript/)
})

test.for(['0.1.1', '0.1.1-hotfix.1'])('publication of %s resumes after each external write and respects rollback', async (version, { onTestFinished }) => {
  const dir = mkdtempSync(join(tmpdir(), 'crawl-publish-'))
  const priorCwd = process.cwd()
  onTestFinished(() => { process.chdir(priorCwd); rmSync(dir, { recursive: true, force: true }) })
  process.chdir(dir)
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '--bare', '-b', 'main', 'remote.git')
  mkdirSync('work')
  process.chdir('work')
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('remote', 'add', 'origin', join(dir, 'remote.git'))
  git('commit', '--allow-empty', '-m', 'inherited Orbrun release')
  git('tag', '-a', 'v0.1.1', '-m', 'Orbrun 0.1.1')
  const upstreamSha = git('rev-parse', 'HEAD')
  git('push', 'origin', 'refs/tags/v0.1.1')
  const hotfix = version !== '0.1.1'
  const tag = 'polished-crawl-v' + version
  if (hotfix) {
    git('tag', '-a', 'polished-crawl-v0.1.1', '-m', 'Original Polished Crawl release')
    git('push', 'origin', 'refs/tags/polished-crawl-v0.1.1')
  }
  mkdirSync('apps/orbrun/dist', { recursive: true })
  writeFileSync('.gitignore', 'dist/\n')
  writeFileSync('apps/orbrun/package.json', JSON.stringify({ version: '0.1.1', ...(hotfix && { hotfixRelease: version }) }))
  writeFileSync('package-lock.json', '{"packages":{"apps/orbrun":{"version":"0.1.1"}}}')
  writeFileSync('CHANGELOG.md', `## ${version} — 2026-11-26\n\n- Test notes.\n`)
  writeFileSync('apps/orbrun/dist/index.html', `<a href="https://github.com/vittis/polished-crawl/tree/${tag}">Source</a>`)
  git('add', '.')
  git('commit', '-m', 'release')
  git('push', 'origin', 'main')
  const sha = git('rev-parse', 'HEAD')
  const vars = { GITHUB_REPOSITORY: 'vittis/polished-crawl', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha,
    RELEASE_ENABLED: 'true', CLOUDFLARE_ACCOUNT_ID: 'fixture', CLOUDFLARE_API_TOKEN: 'cfat_fixture', GH_TOKEN: 'fixture',
    GITHUB_STEP_SUMMARY: join(dir, 'summary') }
  for (const [key, val] of Object.entries(vars)) vi.stubEnv(key, val)
  onTestFinished(() => { vi.unstubAllEnvs() })
  const previous = { id: '00000000-0000-0000-0000-000000000001', version: '00000000-0000-0000-0000-000000000002' }
  let active: typeof previous & { tag?: string, message?: string } = previous
  let deploys = 0, writes = 0
  let release: { body: string; name: string; tag_name: string; make_latest?: string } | undefined
  const services: NonNullable<Parameters<typeof publish>[0]> = {
    getDeployment: () => active,
    deploy(tag, source) {
      deploys++
      if (deploys === 1) throw new Error('upload unavailable')
      active = { id: 'new-deployment', version: 'new-version', tag, message: 'GitHub Actions release ' + source }
    },
    confirmHosted: async () => { throw new Error('edge still stale') },
    request: async (_url, init) => {
      if (init?.method !== 'POST') return release ? Response.json(release) : new Response(null, { status: 404 })
      writes++
      release = { ...JSON.parse(String(init.body)), html_url: 'https://example.invalid/release' }
      throw new Error('response lost after creating release')
    },
  }
  await assert.rejects(publish(services), /upload unavailable/)
  assert.equal(git('rev-parse', `refs/tags/${tag}^{commit}`), sha)
  assert.equal(git('--git-dir', join(dir, 'remote.git'), 'rev-parse', 'refs/tags/v0.1.1^{commit}'), upstreamSha)
  if (hotfix) assert.equal(git('rev-parse', 'refs/tags/polished-crawl-v0.1.1^{commit}'), upstreamSha)
  await assert.rejects(publish(services), /edge still stale/)
  const served = active
  active = { ...previous, id: 'rollback-deployment' }
  await assert.rejects(publish(services), /rollback/)
  active = served
  // Main advanced after deployment. Metadata-only completion must still work.
  git('commit', '--allow-empty', '-m', 'next batch')
  git('push', 'origin', 'main')
  git('switch', '--detach', sha)
  services.confirmHosted = async () => {}
  await assert.rejects(publish(services), /response lost/)
  await publish(services)
  assert.equal(writes, 1)
  assert.equal(deploys, 2)
  assert.equal(release?.body, '- Test notes.')
  assert.equal(release?.name, 'Polished Crawl ' + version)
  assert.equal(release?.tag_name, tag)
  assert.equal(release?.make_latest, hotfix ? 'true' : undefined)
})
