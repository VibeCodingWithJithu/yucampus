const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-11-24" -> "24 Nov 2026". Dates are calendar days, so they are read as UTC to avoid shifting a day. */
export function formatDate(isoDate: string): string {
  return DATE.format(new Date(`${isoDate}T00:00:00Z`));
}

/** "2026-27" -> "2026–27" (en dash, as in the designs). */
export function formatYearLabel(label: string): string {
  return label.replace('-', '–');
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Dr. K. Rao" -> "KR". */
export function initials(name: string): string {
  return name
    .replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '')
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}

const DATE_TIME = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "2026-10-15T09:40:00Z" -> "15 Oct, 3:10 pm" in the viewer's time zone. */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}
