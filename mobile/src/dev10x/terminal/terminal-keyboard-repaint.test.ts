import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const paneSource = readFileSync(
  new URL('../session/TerminalPaneView.tsx', import.meta.url),
  'utf8'
)
const webViewSource = readFileSync(new URL('./TerminalWebView.tsx', import.meta.url), 'utf8')
const htmlSource = readFileSync(new URL('./terminal-webview-html.ts', import.meta.url), 'utf8')
const contractSource = readFileSync(
  new URL('./terminal-webview-contract.ts', import.meta.url),
  'utf8'
)

describe('terminal keyboard repaint', () => {
  it('does not translate Android WebView canvases during keyboard transitions', () => {
    expect(paneSource).toContain("Platform.OS === 'ios'")
    expect(paneSource).toContain('transform: [{ translateY: -keyboardLift }]')
  })

  it('redraws xterm after the keyboard lift settles', () => {
    expect(contractSource).toContain('redraw: () => void')
    expect(webViewSource).toContain("postMessage({ type: 'redraw' })")
    expect(paneSource).toContain('terminalRef.current?.redraw()')
    expect(htmlSource).toContain("} else if (msg.type === 'redraw') {")
    expect(htmlSource).toContain('term.refresh(0, term.rows - 1)')
  })
})
