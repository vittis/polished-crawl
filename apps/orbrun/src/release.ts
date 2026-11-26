import { version } from '../package.json'
import { releaseTag } from './release-tag'

const REPOSITORY = 'https://github.com/vittis/polished-crawl'

const preview = import.meta.env?.VITE_PREVIEW_SHA ?? (typeof process === 'undefined' ? undefined : process.env.VITE_PREVIEW_SHA)
const ref = /^[a-f0-9]{40}$/.test(preview ?? '') ? preview : releaseTag(version)

export const SOURCE_URL = `${REPOSITORY}/tree/${ref}`
export const SOURCE_BLOB = `${REPOSITORY}/blob/${ref}/`
