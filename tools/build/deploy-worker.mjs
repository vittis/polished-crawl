import { spawnSync } from 'node:child_process'

const env = { ...process.env }
if (env.CLOUDFLARE_API_TOKEN) {
  const values = [...new Set(env.CLOUDFLARE_API_TOKEN.trim().split(/\s+/))]
  if (values.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(values[0])) {
    throw new Error(`CLOUDFLARE_API_TOKEN must contain one API token (${values.length} distinct fields found).`)
  }
  env.CLOUDFLARE_API_TOKEN = values[0]
}

const result = spawnSync('wrangler', ['deploy', ...process.argv.slice(2)], { stdio: 'inherit', env })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
