import type { EngineInfo, EngineVariant } from './channels.js'

// Logical files larger than this are hosted in parts and verified after reassembly.
export const PART_BYTES = 24 * 1024 * 1024

const runtimeFiles = ['crawl.js', 'crawl.wasm', 'asyncify/crawl.js', 'asyncify/crawl.wasm',
  'crawl.data', 'prewarm/manifest.json', 'prewarm/prewarm.bin']
const atlases = ['floor', 'wall', 'feat', 'main', 'player', 'gui', 'icons']
const artFiles = ['enums.js', ...atlases.flatMap(name => [name + '.png', 'tileinfo-' + name + '.js'])]

export function buildFiles(build: string, artwork: string): string[] {
  return [
    ...runtimeFiles.map(name => `builds/${build}/${name}`),
    ...artFiles.map(name => `gamedata/${artwork}/${name}`),
  ]
}

/** The publisher and the installer enforce the same on-disk and URL contract. */
export function validateManifest(info: EngineInfo, channel: string) {
  if (info?.channel !== channel || !/^[0-9a-f]{40}$/.test(info.commit) ||
      !/^[0-9a-f]{16}$/.test(info.recipe ?? '') || info.build !== info.commit + '-' + info.recipe ||
      info.gamedata !== info.commit || !info.version || !Array.isArray(info.files) ||
      !info.variants?.includes('asyncify') || !info.variants.includes('jspi')) {
    throw new Error('Invalid offline build manifest.')
  }
  const engine = 'builds/' + info.build + '/'
  const artwork = 'gamedata/' + info.gamedata + '/'
  const paths = new Set<string>()
  for (const [path, size, digest] of info.files) {
    if (!(path.startsWith(engine) || path.startsWith(artwork)) ||
        path.split('/').some(s => !/^[\w.-]+$/.test(s) || s === '..' || s === '.') ||
        !Number.isSafeInteger(size) || size < 0 || !/^[0-9a-f]{64}$/.test(digest ?? '') || paths.has(path)) {
      throw new Error('Invalid offline build file.')
    }
    paths.add(path)
  }
  if (buildFiles(info.build!, info.gamedata).some(path => !paths.has(path))) {
    throw new Error('Incomplete offline build manifest.')
  }
}

/** Only the chosen runtime and the artwork read by the shared game renderer belong on the device. */
export function selectVariant(info: EngineInfo, variant: EngineVariant): EngineInfo {
  const prefix = 'builds/' + info.build + '/'
  const keep = new Set([...artFiles, 'status-icon-sizes.js'].map(name => 'gamedata/' + info.gamedata + '/' + name))
  for (const name of runtimeFiles) {
    if (name.startsWith('asyncify/') && variant === 'jspi') continue
    if ((name === 'crawl.js' || name === 'crawl.wasm') && variant === 'asyncify') continue
    keep.add(prefix + name)
  }
  return { ...info, variant, files: info.files.filter(([path]) => keep.has(path)) }
}
