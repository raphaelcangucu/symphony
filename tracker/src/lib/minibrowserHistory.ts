export interface MinibrowserHistory {
  current: string;
  backStack: readonly string[];
  forwardStack: readonly string[];
}

export function createMinibrowserHistory(homeUrl: string): MinibrowserHistory {
  return {
    current: homeUrl,
    backStack: [],
    forwardStack: [],
  };
}

export function navigateTo(history: MinibrowserHistory, url: string): MinibrowserHistory {
  const nextUrl = url.trim();
  if (!nextUrl || nextUrl === history.current) {
    return history;
  }

  return {
    current: nextUrl,
    backStack: [...history.backStack, history.current],
    forwardStack: [],
  };
}

export function goBack(history: MinibrowserHistory): MinibrowserHistory {
  const previousUrl = history.backStack.at(-1);
  if (!previousUrl) {
    return history;
  }

  return {
    current: previousUrl,
    backStack: history.backStack.slice(0, -1),
    forwardStack: [history.current, ...history.forwardStack],
  };
}

export function goForward(history: MinibrowserHistory): MinibrowserHistory {
  const nextUrl = history.forwardStack[0];
  if (!nextUrl) {
    return history;
  }

  return {
    current: nextUrl,
    backStack: [...history.backStack, history.current],
    forwardStack: history.forwardStack.slice(1),
  };
}

export function canGoBack(history: MinibrowserHistory): boolean {
  return history.backStack.length > 0;
}

export function canGoForward(history: MinibrowserHistory): boolean {
  return history.forwardStack.length > 0;
}
