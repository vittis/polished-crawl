/**
 * The site as a search engine sees it: which addresses are pages worth
 * finding, what each is called, and which are the app's own state (a
 * login, a game, a spectate) and stay out of the index.
 *
 * Read by three sides that must agree: the build, which writes every page
 * but the home page (the app) as a web page of its own, and the sitemap
 * beside them (../site-pages.ts); the Worker, which answers an address that
 * is none of these with a 404 (../worker/index.ts); and the app, which names
 * its tab after the page it is on (servers.ts setRoute). Nothing here
 * touches the DOM.
 */

/** the official deployment: canonical addresses, the sitemap and the social cards name it */
export const SITE_URL = 'https://dcss-client.vittis.workers.dev'

export interface Page {
  /** This address opens the app’s shared document modal. */
  modal?: boolean
  /** the address, as parseRoute reads it */
  path: string
  /** the tab and the search result's headline; the name and the rest are set apart by a hyphen, as a game's tab is (servers.ts gameTitle) */
  title: string
  /** the search result's snippet: under ~155 characters, so it is not cut */
  description: string
  /** the repository's document the page reads (menu.ts ABOUT_DOCS), from the repository root */
  doc?: string
  /** the heading it has on the About page and in a breadcrumb */
  name: string
  /** the document's sections listed at its head, to jump to (a changelog's releases are not worth it) */
  contents?: boolean
}

export const HOME: Page = {
  path: '/',
  name: 'Polished Crawl',
  title: 'Polished Crawl - Dungeon Crawl Stone Soup',
  description:
    'Play Dungeon Crawl Stone Soup in a 2.5D dungeon with keyboard, gamepad or touch controls. Online WebTiles play and anonymous spectating.',
}

export const PAGES: Page[] = [
  HOME,
  {
    path: '/about',
    modal: true,
    name: 'About',
    doc: 'ABOUT.md',
    contents: true,
    title: 'About Polished Crawl - DCSS in 2.5D',
    description:
      'See what Polished Crawl adds to Dungeon Crawl Stone Soup WebTiles, including 2.5D rendering, combat effects, and gamepad and touch controls.',
  },
  {
    path: '/about/new',
    modal: true,
    name: 'What’s new',
    doc: 'CHANGELOG.md',
    title: 'What’s new in Polished Crawl',
    description: 'Polished Crawl’s release notes, newest first: what changed in the 2.5D client for Dungeon Crawl Stone Soup.',
  },
  {
    path: '/about/steam',
    name: 'Add to Steam',
    doc: 'STEAM.md',
    contents: true,
    title: 'Add Polished Crawl to Steam on the Steam Deck',
    description:
      'Add Polished Crawl, the 2.5D Dungeon Crawl Stone Soup client, to your Steam Deck library with artwork and controller support.',
  },
  {
    path: '/about/install',
    name: 'Add to Home Screen',
    doc: 'INSTALL.md',
    contents: true,
    title: 'Add Polished Crawl to your phone or tablet’s home screen',
    description:
      'Install Polished Crawl on your phone, tablet or computer. Play Dungeon Crawl Stone Soup in 2.5D on public servers; online gameplay needs a connection.',
  },
]

/** Screens that belong to no server, including the former Health bars settings link. */
export const MENU_PATH = /^(settings(\/(?:[a-z]+|health-bars))?|settings\/controls\/gamepad|play|watch(\/add)?|whats-new)$/

export const OFFLINE_SERVER_ID = 'offline'

type ServerPath =
  | { verb: 'play'; server: string; game: string; username?: string }
  | { verb: 'login' | 'register' | 'watch'; server: string; username?: string }

/** Current links name the user in the fragment. Legacy links include the name in the path. */
export function parseServerPath(parts: string[]): ServerPath | null {
  const [first, server, ...rest] = parts
  if (!server) return null
  const verb = first.toLowerCase()
  if (verb === 'play' && (rest.length === 1 || rest.length === 2)) {
    return { verb, server, game: rest[rest.length - 1], username: rest.length === 2 ? rest[0] : undefined }
  }
  if (verb === 'watch' && server.toLowerCase() === OFFLINE_SERVER_ID) return null
  if ((verb === 'login' || verb === 'register' || verb === 'watch') && rest.length <= 1) {
    return { verb, server, username: rest[0] }
  }
  return null
}

export const VERSIONS_PATH = 'versions'
export const RC_PATH = 'rc'
export const MORGUES_PATH = 'morgues'

type PlayMenuPath =
  | { path: typeof VERSIONS_PATH; server: string }
  | { path: typeof RC_PATH; server: string; gameId?: string }
  | { path: typeof MORGUES_PATH; server: string; morgue?: string }

export function parsePlayMenuPath(parts: string[]): PlayMenuPath | null {
  // Keep existing RC, versions and morgue bookmarks.
  const [screen, server, detail, ...extra] = parts[0]?.toLowerCase() === 'accounts' ? parts.slice(1) : parts
  if (!server || extra.length) return null
  const offline = server.toLowerCase() === OFFLINE_SERVER_ID
  switch (screen.toLowerCase()) {
    case VERSIONS_PATH:
      return !offline && !detail ? { path: VERSIONS_PATH, server } : null
    case RC_PATH:
      if (offline) return detail ? null : { path: RC_PATH, server }
      return detail ? { path: RC_PATH, server, gameId: detail } : null
    case MORGUES_PATH:
      if (!detail) return { path: MORGUES_PATH, server }
      return /^\d{8}-\d{6}$/.test(detail) ? { path: MORGUES_PATH, server, morgue: detail } : null
    default:
      return null
  }
}

function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean)
}

export function decodeRoutePart(part: string): string {
  try { return decodeURIComponent(part) } catch { return part }
}

/** Split before decoding so an encoded slash stays inside its name. */
export function routeSegments(pathname: string): string[] {
  return segments(pathname).map(decodeRoutePart)
}

/** addresses that were pages once, and the page each is now: a link from before still lands */
export const MOVED: Record<string, string> = {
  '/about/orbrun': '/about',
}

/** The page at an address, trailing slash or not; null for the app's own state and for nothing at all. */
export function pageAt(pathname: string): Page | null {
  const p = '/' + segments(pathname).join('/').toLowerCase()
  return PAGES.find((page) => page.path === p) ?? null
}

/**
 * What an address is: a page to be found (`page`), a screen of the app
 * that means nothing to a search engine (`app`: settings, a login, a game,
 * a spectate), or none of the app's addresses at all (`none`), which
 * parseRoute would read as the home screen.
 */
export function addressKind(pathname: string): 'page' | 'app' | 'none' {
  const page = pageAt(pathname)
  if (page) return page.modal ? 'app' : 'page'
  if (pathname === '/connection-check' || pathname === '/connection-check.html') return 'app'
  const parts = routeSegments(pathname)
  if (MENU_PATH.test(parts.join('/').toLowerCase())) return 'app'
  return parts.join('/').toLowerCase() === 'offline' || parseServerPath(parts) || parsePlayMenuPath(parts) ? 'app' : 'none'
}

/** The tab's title at an address that is not a game: its page's, or the home screen's. */
export function titleAt(pathname: string): string {
  return (pageAt(pathname) ?? HOME).title
}
