import { version } from '../package.json'

const REPOSITORY = 'https://github.com/vittis/polished-crawl'

// Preserve the shipped source tag until the first versioned GitHub Release.
const tag = version === '0.1.196' ? 'cloudflare-online-v1.200' : `v${version}`
const preview = import.meta.env?.VITE_PREVIEW_SHA ?? (typeof process === 'undefined' ? undefined : process.env.VITE_PREVIEW_SHA)
const ref = /^[a-f0-9]{40}$/.test(preview ?? '') ? preview : tag

export const SOURCE_URL = `${REPOSITORY}/tree/${ref}`
export const SOURCE_BLOB = `${REPOSITORY}/blob/${ref}/`
