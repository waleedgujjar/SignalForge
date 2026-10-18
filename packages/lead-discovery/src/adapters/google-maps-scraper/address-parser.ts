export interface ParsedAddress {
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
}

const POSTAL_CODE_RE = /\b(\d{5}(?:-\d{4})?)\b/;

const KNOWN_COUNTRIES = new Set([
  'united states', 'usa', 'us', 'canada', 'united kingdom', 'uk', 'australia',
  'germany', 'france', 'india', 'brazil', 'mexico', 'japan', 'china',
  'south korea', 'italy', 'spain', 'netherlands', 'sweden', 'norway',
  'denmark', 'finland', 'switzerland', 'austria', 'belgium', 'portugal',
  'ireland', 'new zealand', 'singapore', 'thailand', 'philippines',
  'indonesia', 'malaysia', 'vietnam', 'taiwan', 'hong kong',
  'united arab emirates', 'uae', 'saudi arabia', 'israel', 'turkey',
  'poland', 'czech republic', 'czechia', 'hungary', 'romania', 'greece',
  'south africa', 'nigeria', 'egypt', 'kenya', 'argentina', 'colombia',
  'chile', 'peru',
]);

export function parseAddress(address: string | null | undefined): ParsedAddress {
  const empty: ParsedAddress = { city: null, state: null, country: null, postalCode: null };
  if (!address || !address.trim()) return empty;

  const segments = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return empty;

  let country: string | null = null;
  let state: string | null = null;
  let city: string | null = null;
  let postalCode: string | null = null;

  const postalMatch = address.match(POSTAL_CODE_RE);
  if (postalMatch) postalCode = postalMatch[1]!;

  if (segments.length >= 3) {
    const last = segments[segments.length - 1]!;
    if (KNOWN_COUNTRIES.has(last.toLowerCase())) {
      country = last;
    }

    const secondLast = segments[segments.length - (country ? 2 : 1)]!;
    const stateCandidate = secondLast.replace(POSTAL_CODE_RE, '').trim();
    if (stateCandidate) state = stateCandidate;

    const cityIndex = segments.length - (country ? 3 : 2);
    if (cityIndex >= 0) city = segments[cityIndex]!;
  } else if (segments.length === 2) {
    const last = segments[1]!;
    if (KNOWN_COUNTRIES.has(last.toLowerCase())) {
      country = last;
      city = segments[0]!;
    } else {
      const stateCandidate = last.replace(POSTAL_CODE_RE, '').trim();
      if (stateCandidate) state = stateCandidate;
      city = segments[0]!;
    }
  } else {
    if (KNOWN_COUNTRIES.has(segments[0]!.toLowerCase())) {
      country = segments[0]!;
    } else {
      city = segments[0]!;
    }
  }

  return { city, state, country, postalCode };
}
