import app from '../package.json'
import { releaseId, releaseTag } from './release-tag'

const REPOSITORY = 'https://github.com/vittis/polished-crawl'

const preview = import.meta.env?.VITE_PREVIEW_SHA ?? (typeof process === 'undefined' ? undefined : process.env.VITE_PREVIEW_SHA)
export const RELEASE_ID = releaseId(app)
const ref = /^[a-f0-9]{40}$/.test(preview ?? '') ? preview : releaseTag(RELEASE_ID)

export const SOURCE_URL = `${REPOSITORY}/tree/${ref}`
export const SOURCE_BLOB = `${REPOSITORY}/blob/${ref}/`
