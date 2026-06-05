export type SeedType = 'buyers' | 'owners' | 'exclusion';

export interface SeedRow {
  email: string;
  fn: string;
  ln: string;
  doby: string;
  dobm: string;
  dobd: string;
  ct: string;
  st: string;
  zp: string;
  country: string;
}

type NullableString = string | null | undefined;

export function normalizeEmail(value: NullableString): string {
  return (value || '').trim().toLowerCase();
}

export function normalizeName(value: NullableString): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLocation(value: NullableString): string {
  return (value || '').trim().toLowerCase();
}

export function normalizeCountry(value: NullableString): string {
  const normalized = (value || '').trim().toUpperCase();
  return normalized.length === 2 ? normalized : '';
}

export function normalizeZip(value: NullableString, country: string): string {
  const normalized = (value || '').trim();
  if (!normalized) {
    return '';
  }

  if (country === 'US') {
    const digits = normalized.replace(/\D+/g, '');
    return digits.slice(0, 5);
  }

  return normalized;
}

export function splitDob(value: NullableString): Pick<SeedRow, 'doby' | 'dobm' | 'dobd'> {
  const normalized = (value || '').trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { doby: '', dobm: '', dobd: '' };
  }

  const [, year, month, day] = match;
  const parsedMonth = Number(month);
  const parsedDay = Number(day);

  if (parsedMonth < 1 || parsedMonth > 12 || parsedDay < 1 || parsedDay > 31) {
    return { doby: '', dobm: '', dobd: '' };
  }

  return { doby: year, dobm: month, dobd: day };
}

export function scoreSeedRow(row: SeedRow): number {
  return [
    row.fn,
    row.ln,
    row.doby,
    row.dobm,
    row.dobd,
    row.ct,
    row.st,
    row.zp,
    row.country,
  ].reduce((score, value) => score + (value ? 1 : 0), 0);
}

export function toSeedRow(input: {
  email: NullableString;
  firstName: NullableString;
  lastName: NullableString;
  dob: NullableString;
  city: NullableString;
  region: NullableString;
  postal: NullableString;
  postalFallback?: NullableString;
  country: NullableString;
}): SeedRow | null {
  const email = normalizeEmail(input.email);
  if (!email) {
    return null;
  }

  const country = normalizeCountry(input.country);
  const dob = splitDob(input.dob);

  return {
    email,
    fn: normalizeName(input.firstName),
    ln: normalizeName(input.lastName),
    ...dob,
    ct: normalizeLocation(input.city),
    st: normalizeLocation(input.region),
    zp: normalizeZip(input.postal || input.postalFallback, country),
    country,
  };
}

export function mergeBestSeedRows(rows: SeedRow[]): SeedRow[] {
  const deduped = new Map<string, SeedRow>();

  for (const row of rows) {
    const existing = deduped.get(row.email);
    if (!existing || scoreSeedRow(row) > scoreSeedRow(existing)) {
      deduped.set(row.email, row);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => a.email.localeCompare(b.email));
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export function buildCsv(headers: string[], rows: string[][]): string {
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => row.map((value) => csvEscape(value)).join(',')),
  ].join('\n');
}

export function fileNameForSeedType(type: SeedType, dateStamp: string): string {
  switch (type) {
    case 'buyers':
      return `fever-buyers-seed-${dateStamp}.csv`;
    case 'owners':
      return `fever-owners-seed-${dateStamp}.csv`;
    case 'exclusion':
      return `fever-exclusion-${dateStamp}.csv`;
  }
}
