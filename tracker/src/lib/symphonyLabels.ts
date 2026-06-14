export const SYMPHONY_LABEL_PATTERN = /^symphony(?::.*)?$/i;

export function isSymphonyLabel(label: string): boolean {
  return SYMPHONY_LABEL_PATTERN.test(label.trim());
}

export function isUserVisibleLabel(label: string): boolean {
  return !isSymphonyLabel(label);
}

export function userVisibleLabels(labels: string[]): string[] {
  return labels.filter(isUserVisibleLabel);
}
