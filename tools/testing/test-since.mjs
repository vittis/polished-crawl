import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [base, ...filters] = process.argv.slice(2)
if (!base) throw new Error('Usage: npm run test:since -- <base-ref> [test filters]')
// Vitest can succeed with zero tests if git diff cannot resolve the base.
const ancestor = spawnSync('git', ['merge-base', '--', 'HEAD', base], { encoding: 'utf8' })
if (ancestor.error) throw ancestor.error
if (ancestor.status !== 0) {
  console.error(`Cannot find a common ancestor for HEAD and ${base}. Check that the base ref exists locally.`)
  process.exit(1)
}
const commit = ancestor.stdout.trim()
console.log(`Selecting tests since ${base} (merge base ${commit}).`)
const vitest = fileURLToPath(import.meta.resolve('vitest/vitest.mjs'))
const result = spawnSync(process.execPath, [vitest, 'run', '--changed', commit, ...filters], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
