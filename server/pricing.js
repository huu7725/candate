export const DEFAULT_TIERS = [
  { days: 3, percent: 80 },
  { days: 7, percent: 50 },
  { days: 14, percent: 30 },
];

// Compare calendar dates in Vietnam, independent of host timezone / DST.
export function todayVN(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (name) => parts.find((p) => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function daysLeft(expiry, today = todayVN()) {
  return Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
  );
}
export function priceLot(lot, tiers = DEFAULT_TIERS, today = todayVN()) {
  const days_left = daysLeft(lot.expiry_date, today);
  const expired = days_left < 0;
  const discount_percent = expired
    ? 0
    : ([...tiers].sort((a, b) => a.days - b.days).find((t) => days_left <= t.days)?.percent ?? 0);
  return {
    ...lot,
    days_left,
    expired,
    discount_percent,
    price: expired ? null : Math.round((lot.original_price * (100 - discount_percent)) / 100),
  };
}
