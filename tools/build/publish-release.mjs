import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readReleaseNotes } from './release-notes.mjs'
import { assertDeployable } from './deploy-guard.mjs'
import { waitForHosted } from './check-hosted.mjs'

/** @param {string} program @param {...string} args */
const run = (program, ...args) => execFileSync(program, args, { encoding: 'utf8' }).trim()
/** @param {...string} args */
const git = (...args) => run('git', ...args)
const worker = 'dcss-client'
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

/** @typedef {{ id: string, version: string, tag?: string, message?: string }} Deployment */
/** @returns {Deployment} */
function activeDeployment() {
  /** @param {...string} args */
  const query = (...args) => JSON.parse(run('node_modules/.bin/wrangler', ...args, '--name', worker, '--json'))
  const deployment = query('deployments', 'status')
  const [traffic] = deployment.versions
  if (deployment.versions.length !== 1 || traffic.percentage !== 100 || !uuid.test(deployment.id) || !uuid.test(traffic.version_id)) {
    throw new Error('Expected one production Worker version serving 100%. Inspect Cloudflare before publishing.')
  }
  const version = query('versions', 'view', traffic.version_id)
  return { id: deployment.id, version: traffic.version_id, tag: version.annotations?.['workers/tag'], message: version.annotations?.['workers/message'] }
}

// A Cloudflare rollback creates a new deployment ID, even when it restores the
// very same version. Only the original deployment may be replaced on retry.
/** @param {Deployment} active @param {Deployment} previous @param {string} tag @param {string} sha @param {boolean} published */
function releaseStep(active, previous, tag, sha, published) {
  if (!uuid.test(previous.id) || !uuid.test(previous.version)) throw new Error('Missing rollback information on the source tag.')
  if (active.tag === tag && active.message === 'GitHub Actions release ' + sha) return 'verify'
  if (published || active.tag === tag || active.id !== previous.id || active.version !== previous.version) {
    throw new Error('Production changed since this tag was reserved. Inspect deployment history for a rollback or another release.')
  }
  return 'deploy'
}

/** @param {string} tag @param {string} sha */
function deployWorker(tag, sha) {
  execFileSync('npm', ['run', 'deploy', '--', '--env=', '--tag', tag, '--message', 'GitHub Actions release ' + sha], { stdio: 'inherit' })
}

export async function publish({ getDeployment = activeDeployment, deploy = deployWorker, confirmHosted = waitForHosted, request = fetch } = {}) {
  const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha, GITHUB_STEP_SUMMARY: summary, GH_TOKEN: token } = process.env
  if (repo !== 'vittis/polished-crawl' || process.env.GITHUB_REF !== 'refs/heads/main' || git('rev-parse', 'HEAD') !== sha ||
      process.env.RELEASE_ENABLED !== 'true' || !process.env.CLOUDFLARE_ACCOUNT_ID ||
      !/^cfat_[a-zA-Z0-9_-]+$/.test(process.env.CLOUDFLARE_API_TOKEN ?? '') || !token || !summary || !sha) {
    throw new Error('Production publish requires the enabled main environment and its scoped credentials.')
  }
  const version = JSON.parse(readFileSync('apps/orbrun/package.json', 'utf8')).version
  const notes = readReleaseNotes(version, pathToFileURL(process.cwd() + '/'))
  const tag = 'v' + version
  if (!readFileSync('apps/orbrun/dist/index.html', 'utf8').includes(`href="https://github.com/${repo}/tree/${tag}"`)) {
    throw new Error('Packaged source link does not match the prepared release tag.')
  }
  /** @param {string} line */
  const record = line => {
    console.log(line)
    appendFileSync(summary, line + '\n\n')
  }
  const requireCurrentMain = () => {
    assertDeployable(process.cwd())
    if (git('rev-parse', 'origin/main') !== sha) throw new Error('Main advanced. Only an already-live release may be finalized.')
  }
  const releases = `https://api.github.com/repos/${repo}/releases`
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }
  const response = await request(releases + '/tags/' + tag, { headers, signal: AbortSignal.timeout(15000) })
  if (!response.ok && response.status !== 404) throw new Error('GitHub release lookup failed: HTTP ' + response.status)
  const existing = response.ok ? await response.json() : null
  const title = 'Polished Crawl ' + tag
  if (existing && (existing.tag_name !== tag || existing.draft || existing.prerelease || existing.name !== title ||
      existing.body?.replace(/\r\n/g, '\n').trim() !== notes)) throw new Error('Existing GitHub Release differs from the prepared release.')

  let active = getDeployment()
  const ref = 'refs/tags/' + tag
  const remote = git('ls-remote', '--refs', 'origin', ref)
  let previous
  if (remote) {
    git('fetch', '--no-tags', 'origin', ref)
    if (git('rev-parse', 'FETCH_HEAD^{commit}') !== sha || git('cat-file', '-t', 'FETCH_HEAD') !== 'tag') {
      throw new Error('Release tag already exists with a different source or format.')
    }
    previous = JSON.parse(git('cat-file', '-p', 'FETCH_HEAD').split('\n\n').slice(1).join('\n\n'))
  } else {
    if (existing || active.tag === tag) throw new Error('Release already exists without its expected source tag.')
    requireCurrentMain()
    previous = { id: active.id, version: active.version }
    git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'tag', '-a', tag, sha, '-m', JSON.stringify(previous))
    git('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', ref)
  }
  record(`Source ${sha}. Rollback Worker version ${previous.version} (deployment ${previous.id}).`)
  if (releaseStep(active, previous, tag, sha, Boolean(existing)) === 'deploy') {
    requireCurrentMain()
    if (releaseStep(getDeployment(), previous, tag, sha, Boolean(existing)) === 'deploy') deploy(tag, sha)
  }
  await confirmHosted(tag, false)
  active = getDeployment()
  if (releaseStep(active, previous, tag, sha, Boolean(existing)) !== 'verify') throw new Error('Cloudflare has not confirmed this release.')
  record(`[Production](https://polished-crawl.com/) served ${tag} and its entry module. Worker version ${active.version} (deployment ${active.id}).`)
  if (existing) { record(existing.html_url); return }
  const created = await request(releases, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ tag_name: tag, target_commitish: sha, name: title, body: notes }),
  })
  if (!created.ok) throw new Error('GitHub Release creation returned HTTP ' + created.status + '. Rerun to reconcile.')
  record((await created.json()).html_url)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await publish()
