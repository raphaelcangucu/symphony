export const SYMPHONY_LABEL_PATTERN = /^symphony(?::.*)?$/i;

export function isUserVisibleLabel(label: string): boolean {
  return !SYMPHONY_LABEL_PATTERN.test(label);
}

export function userVisibleLabels(labels: string[]): string[] {
  return labels.filter(isUserVisibleLabel);
}
