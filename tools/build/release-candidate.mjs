import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** @param {string} tested */
export function checkCandidate(tested, cwd = process.cwd()) {
  if (!/^[0-9a-f]{40}$/.test(tested)) throw new Error('Choose a successful Deploy preview push run for this repository.')
  /** @param {...string} args */
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const parents = git('show', '-s', '--format=%P', 'HEAD').split(' ')
  if (parents.length !== 2 || parents[1] !== tested) throw new Error('Main must be a merge commit of the tested preview SHA.')
  if (git('rev-parse', 'HEAD^{tree}') !== git('rev-parse', tested + '^{tree}')) {
    throw new Error('The merge changed the tested tree. Integrate main into preview and test again.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) checkCandidate(process.argv[2])
