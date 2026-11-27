export function releaseId(app: { version: string; hotfixRelease?: string }): string {
  return app.hotfixRelease ?? app.version
}

export function releaseTag(version: string): string {
  return `polished-crawl-v${version}`
}
