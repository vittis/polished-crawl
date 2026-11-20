(() => {
  const website = document.currentScript.dataset.websiteId
  const hostname = 'polished-crawl.com'
  if (location.hostname !== hostname || navigator.globalPrivacyControl || navigator.doNotTrack === '1') return

  const publicPages = new Set(document.currentScript.dataset.publicPages.split(','))
  const screens = new Set(['play', 'watch', 'login', 'register', 'accounts', 'settings', 'whats-new'])
  const events = new Set(['play_clicked', 'login_succeeded', 'game_started'])

  function send(name) {
    const path = location.pathname
    const screen = path.split('/')[1]
    // Old links can embed player names in the path. Titles, referrers, queries
    // and fragments can contain player data too, so build the payload from scratch.
    const url = publicPages.has(path) ? path : screens.has(screen) ? '/' + screen : '/other'
    const payload = { website, hostname, url }
    if (name) payload.name = name
    void fetch('https://gateway.umami.is/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'event', payload }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
    }).catch(() => {})
  }

  window.addEventListener('polished-crawl:analytics', ({ detail }) => {
    if (events.has(detail)) send(detail)
  })
  send()
})()
