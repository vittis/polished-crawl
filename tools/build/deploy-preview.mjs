import { execFileSync } from 'node:child_process'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const sha = git('rev-parse', 'HEAD')
if (process.env.GITHUB_ACTIONS && (process.env.GITHUB_REF !== 'refs/heads/preview' || process.env.GITHUB_SHA !== sha)) {
  throw new Error('Preview deploys must build the pushed preview commit.')
}

if (process.env.GITHUB_ACTIONS && git('ls-remote', '--exit-code', 'origin', 'refs/heads/preview').split('\t')[0] !== sha) {
  throw new Error('Superseded preview commit. Use the deployment run for the current preview tip.')
}

const args = process.argv.slice(2)
if (args.some(arg => arg !== '--dry-run')) throw new Error('The preview deploy only accepts --dry-run.')
execFileSync('npm', ['run', 'deploy', '--', '--env', 'preview', '--message', `Preview ${sha}`, ...args], {
  stdio: 'inherit',
  env: { ...process.env, VITE_PREVIEW_SHA: sha, VITE_CF_BEACON_TOKEN: '', VITE_UMAMI_WEBSITE_ID: '' },
})
