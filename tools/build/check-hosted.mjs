import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

/** @param {string} ref */
export async function checkHosted(ref, preview = false, request = fetch) {
  const site = preview ? 'https://preview.polished-crawl.com' : 'https://polished-crawl.com'
  /** @param {string} url */
  const get = url => request(url, { redirect: 'error', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(10000) })
  const page = await get(site + '/?source=' + encodeURIComponent(ref))
  if (!page.ok || /\bnoindex\b/i.test(page.headers.get('x-robots-tag') ?? '') !== preview) {
    throw new Error('Unexpected homepage status or indexing header.')
  }
  const html = await page.text()
  if (!html.includes(`href="https://github.com/vittis/polished-crawl/tree/${ref}"`)) throw new Error('Hosted source link differs.')
  const entry = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="(\/assets\/[\w.-]+\.js)"/)?.[1]
  if (!entry) throw new Error('Missing app entry module.')
  const asset = await get(site + entry)
  if (!asset.ok || !/javascript/i.test(asset.headers.get('content-type') ?? '') || !(await asset.text()).trim()) {
    throw new Error('App entry module did not return JavaScript.')
  }
}

/** @param {string} ref @param {boolean} preview */
export async function waitForHosted(ref, preview) {
  for (let attempt = 1; ; attempt++) {
    try { await checkHosted(ref, preview); return }
    catch (error) {
      if (attempt === 12) throw error
      console.log(error instanceof Error ? error.message : error)
      await sleep(5000)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await waitForHosted(process.argv[2], true)
}
