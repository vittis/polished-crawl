import { execFileSync } from 'node:child_process'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const sha = git('rev-parse', 'HEAD')
const ciSha = process.env.WORKERS_CI_COMMIT_SHA
const ciWorker = process.env.WRANGLER_CI_OVERRIDE_NAME
if (process.env.WORKERS_CI && (process.env.WORKERS_CI_BRANCH !== 'preview' || ciSha !== sha)) {
  throw new Error('Preview deploys must build the pushed preview commit.')
}
if (ciWorker && ciWorker !== 'dcss-client-preview') {
  throw new Error(`Preview deploys must target dcss-client-preview, received ${ciWorker}.`)
}

const args = process.argv.slice(2)
if (args.some(arg => arg !== '--dry-run')) throw new Error('The preview deploy only accepts --dry-run.')
execFileSync('npm', ['run', 'deploy', '--', '--env', 'preview', '--message', `Preview ${sha}`, ...args], {
  stdio: 'inherit',
  env: { ...process.env, VITE_PREVIEW_SHA: sha, VITE_CF_BEACON_TOKEN: '', VITE_UMAMI_WEBSITE_ID: '' },
})
