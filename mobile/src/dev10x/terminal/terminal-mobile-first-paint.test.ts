import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const terminalHtmlSource = readFileSync(
  new URL('./terminal-webview-html.ts', import.meta.url),
  'utf8'
)
const sessionSource = readFileSync(
  new URL('../../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url),
  'utf8'
)

describe('mobile terminal first paint', () => {
  it('measures a phone viewport before the first terminal subscription', () => {
    expect(terminalHtmlSource).toContain('function measureInitialViewport')
    expect(terminalHtmlSource).toContain("probeSurface.setAttribute('aria-hidden', 'true')")
    expect(terminalHtmlSource).toContain('probeTerm.open(probeSurface)')
    expect(terminalHtmlSource).toContain('initialViewportProbe.term.dispose()')

    const firstLoadStart = sessionSource.indexOf(
      'if (handle === activeHandleRef.current && !terminalUnsubsRef.current.has(handle))'
    )
    const firstLoadEnd = sessionSource.indexOf('\n      }', firstLoadStart)
    const firstLoadHandler = sessionSource.slice(firstLoadStart, firstLoadEnd)
    expect(firstLoadHandler).toContain('await measureViewportOnce(handle)')
    expect(firstLoadHandler.indexOf('await measureViewportOnce(handle)')).toBeLessThan(
      firstLoadHandler.indexOf('subscribeToTerminal(handle)')
    )
  })

  it('atomically reveals the first xterm surface after replay and fit', () => {
    const initStart = terminalHtmlSource.indexOf('function init(')
    const initEnd = terminalHtmlSource.indexOf('\n\n  function write(', initStart)
    const initSource = terminalHtmlSource.slice(initStart, initEnd)

    expect(initSource).toContain("surface.style.visibility = 'hidden'")
    expect(initSource).toContain("surface.style.visibility = 'visible'")
    expect(initSource.indexOf("surface.style.visibility = 'visible'")).toBeGreaterThan(
      initSource.indexOf("applyFitScale('init-replay')")
    )
  })
})
