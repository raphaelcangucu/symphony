import type { RpcResponse } from '../transport/types'

export type TerminalViewportRefitTargetState = {
  activeHandle: string | null
  expectedHandle: string
  currentRef: unknown
  expectedRef: unknown
  disposed: boolean
  runSeq: number
  currentRunSeq: number
}

export function isTerminalUpdateViewportUpdated(response: RpcResponse): boolean {
  if (!response.ok || typeof response.result !== 'object' || response.result == null) {
    return false
  }
  return (response.result as { updated?: unknown }).updated === true
}

export function isTerminalUpdateViewportApplied(response: RpcResponse): boolean {
  if (!response.ok || typeof response.result !== 'object' || response.result == null) {
    return false
  }
  return (response.result as { applied?: unknown }).applied === true
}

// Ported from Orca #8707: defer height refits while typing, then coalesce
// every skipped layout change into one correction after the keyboard closes.
export type TerminalFrameHeightRefitState = {
  frameHeight: number
  keyboardVisible: boolean
  pending: boolean
}

export type TerminalFrameHeightRefitEvent =
  | { type: 'frame-height'; height: number }
  | { type: 'keyboard-visibility'; visible: boolean }
  | { type: 'refit-committed' }

export function reduceTerminalFrameHeightRefit(
  state: TerminalFrameHeightRefitState,
  event: TerminalFrameHeightRefitEvent
): { state: TerminalFrameHeightRefitState; shouldRefit: boolean } {
  if (event.type === 'refit-committed') {
    if (state.keyboardVisible) {
      return { state: { ...state, pending: true }, shouldRefit: false }
    }
    return { state: { ...state, pending: false }, shouldRefit: true }
  }
  if (event.type === 'keyboard-visibility') {
    if (event.visible === state.keyboardVisible) {
      return { state, shouldRefit: false }
    }
    if (event.visible) {
      return { state: { ...state, keyboardVisible: true }, shouldRefit: false }
    }
    return {
      state: { ...state, keyboardVisible: false, pending: false },
      shouldRefit: state.pending
    }
  }
  if (event.height === state.frameHeight) {
    return { state, shouldRefit: false }
  }
  if (state.keyboardVisible) {
    return {
      state: { ...state, frameHeight: event.height, pending: true },
      shouldRefit: false
    }
  }
  return {
    state: { ...state, frameHeight: event.height, pending: false },
    shouldRefit: true
  }
}

export function isTerminalViewportRefitTargetCurrent(
  state: TerminalViewportRefitTargetState
): boolean {
  return (
    !state.disposed &&
    state.runSeq === state.currentRunSeq &&
    state.activeHandle === state.expectedHandle &&
    state.currentRef === state.expectedRef
  )
}
