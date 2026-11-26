import { isAndroid } from './back'
import { h } from './dom'
import { ownWindow } from './quit'

interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const HIDDEN_KEY = 'orbrun.installPromotionHidden'

/** Keep the browser's one-use event for the life of the page, even while home is off screen. */
export function createMobileInstall(): HTMLElement | undefined {
  const { userAgent, maxTouchPoints } = navigator
  const appleMobile = /\b(iPhone|iPad|iPod)\b/.test(userAgent) || (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1)
  const safari = appleMobile && /Version\/.*Safari\//.test(userAgent)
  const android = isAndroid()
  if (!window.isSecureContext || ownWindow() || (!safari && !android)) return

  let deferred: InstallPromptEvent | undefined
  // Chrome's menu can install the app before Chrome offers the native prompt.
  let manual = safari || (/\bChrome\//.test(userAgent) && !/\bwv\b/.test(userAgent))
  let suppressed = false
  try { suppressed = localStorage.getItem(HIDDEN_KEY) === '1' } catch { /* storage may be unavailable */ }

  const instructions = safari
    ? 'In Safari, tap Share, then Add to Home Screen. Turn on Open as Web App if offered, then tap Add.'
    : 'In your browser’s menu, look for Install app, Install and create shortcut, or Add to Home screen.'
  const manualCopy = h('p', { class: 'install-promotion-manual' }, instructions)
  const promptCopy = h('p', { class: 'install-promotion-native' }, 'Launch Polished Crawl from your home screen.')
  const install = h('button', { type: 'button', class: 'install-promotion-action', onclick: requestInstall }, 'Install')
  const dismiss = h('button', { type: 'button', class: 'install-promotion-dismiss', 'aria-label': 'Dismiss install prompt', onclick: hidePromotion }, '×')
  const panel = h('section', { class: 'install-promotion', 'aria-labelledby': 'install-promotion-title' },
    h('h2', { id: 'install-promotion-title' }, 'Install as app'), manualCopy, promptCopy, install, dismiss)

  function update() {
    const hide = suppressed || ownWindow() || (!deferred && !manual)
    if (hide && panel.contains(document.activeElement)) {
      panel.parentElement?.querySelector<HTMLElement>('[data-focus="about"]')?.focus({ preventScroll: true })
    } else if (!deferred && document.activeElement === install) dismiss.focus({ preventScroll: true })
    panel.hidden = hide
    manualCopy.hidden = !!deferred
    promptCopy.hidden = install.hidden = !deferred
  }

  function hidePromotion() {
    suppressed = true
    deferred = undefined
    try { localStorage.setItem(HIDDEN_KEY, '1') } catch { /* keep the preference for this page */ }
    update()
  }

  async function requestInstall() {
    const event = deferred
    if (!event) return
    deferred = undefined
    try {
      await event.prompt()
      hidePromotion()
    } catch {
      manual = true
      update()
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    if (suppressed) return
    deferred = event as InstallPromptEvent
    update()
  })
  window.addEventListener('appinstalled', hidePromotion)
  window.matchMedia('(display-mode: browser)').addEventListener('change', update)
  update()
  return panel
}
