/**
 * Google Analytics 4 utility
 * Measurement ID is injected via VITE_GA_MEASUREMENT_ID env variable.
 */

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID

export function initGA() {
  if (!GA_ID) return

  // Load gtag.js
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(script)

  // Initialize dataLayer
  window.dataLayer = window.dataLayer || []
  window.gtag = function () { window.dataLayer.push(arguments) }
  window.gtag('js', new Date())
  window.gtag('config', GA_ID, { send_page_view: true })
}

/**
 * Track a custom event.
 * @param {string} eventName
 * @param {object} [params]
 */
export function trackEvent(eventName, params = {}) {
  if (!GA_ID || typeof window.gtag !== 'function') return
  window.gtag('event', eventName, params)
}
