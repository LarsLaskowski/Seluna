const GROUP_SIZE = 3;

/** `value` in decimal with `separator` between the groups of three digits. */
export function groupDigits(value: number, separator: string): string {
  const digits = String(value);
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= GROUP_SIZE) {
    groups.unshift(digits.slice(Math.max(0, end - GROUP_SIZE), end));
  }
  return groups.join(separator);
}
