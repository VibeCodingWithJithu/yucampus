export const TYPE_LABELS: Record<string, string> = { affiliated: 'Affiliated college', autonomous: 'Autonomous college', university: 'University' };

/** 1536 -> "1.5 KB". */
export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

const WHEN = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export const when = (iso: string) => WHEN.format(new Date(iso));

/** "3 days ago", or the date after a month. */
export function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return minutes <= 1 ? 'Just now' : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return days === 1 ? 'Yesterday' : `${days} days ago`;
  return when(iso).replace(/,? \d+:\d+.*$/, '');
}
