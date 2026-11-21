/** Date-only values use the configured application timezone (India by default). */
export function dateToYmd(date: Date): string {
  const timeZone = process.env.APP_TIME_ZONE?.trim() || 'Asia/Kolkata';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function todayYmd(): string {
  return dateToYmd(new Date());
}

/** Shifts a date-only value by whole calendar days without applying the host timezone. */
export function shiftYmd(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
