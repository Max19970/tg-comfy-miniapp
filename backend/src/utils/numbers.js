export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function multipleOfEight(value, fallback) {
  const n = clampNumber(value, 64, 4096, fallback);
  return Math.max(64, Math.round(n / 8) * 8);
}

export function asPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}
