import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sessionSource = readFileSync(
  new URL('../../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url),
  'utf8'
)

describe('focused terminal opened from chat', () => {
  it('recognizes the focused terminal route and gives it chat-aware navigation', () => {
    expect(sessionSource).toContain('view: routeView')
    expect(sessionSource).toContain("const isFocusedTerminal = routeView === 'terminal'")
    expect(sessionSource).toContain(
      "accessibilityLabel={isFocusedTerminal ? 'Back to chat' : 'Back to worktrees'}"
    )
  })

  it('keeps one terminal canvas clean and removes non-terminal composer actions', () => {
    expect(sessionSource).toContain('visibleTabs.length > 1')
    expect(sessionSource).toContain('{!isFocusedTerminal && (')
    expect(sessionSource).toContain('<MobileTerminalInputActions')
  })

})
