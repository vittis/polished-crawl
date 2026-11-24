import { describe, expect, it } from 'vitest'
import { releaseNotes } from '../../build/release-notes.mjs'

const metadata = {
  appVersion: '0.1.187',
  lockVersion: '0.1.187',
  changelog: '# What’s new\r\n\r\n## 0.1.187 — 2026-11-23\r\n\r\n- A new feature.\r\n\r\n## 0.1.186 — 2026-11-22\r\n\r\n- An older change.\r\n',
}

describe('GitHub release notes', () => {
  it('takes only the current release section from the in-app changelog', () => {
    expect(releaseNotes('0.1.187', metadata)).toBe('- A new feature.')
  })

  it('rejects missing versions, inconsistent metadata, and stale or empty notes', () => {
    expect(() => releaseNotes('v0.1.187', metadata)).toThrow('MAJOR.MINOR.PATCH')
    expect(() => releaseNotes('0.1.186', metadata)).toThrow('apps/orbrun')
    expect(() => releaseNotes('0.1.187', { ...metadata, lockVersion: '0.1.186' })).toThrow('package-lock.json')
    expect(() => releaseNotes('0.1.187', { ...metadata, changelog: metadata.changelog.replace('0.1.187', '0.1.185') })).toThrow('Start CHANGELOG.md')
    expect(() => releaseNotes('0.1.187', { ...metadata, changelog: metadata.changelog.replace('- A new feature.', '') })).toThrow('Add release notes')
  })
})
