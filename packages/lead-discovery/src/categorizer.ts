// Rule-based lead categorization: explainable, deterministic, no external calls.
//
// Each category lists keyword stems. Text from the lead's fields is matched on
// word boundaries (so "band" does not match "broadband"), every category is
// scored with per-field weights, and the best score wins only above a minimum.
// Anything weaker is left in "Other" rather than guessed.
//
// The categories are the fixed local-business set below. Auto-categorization
// only ever emits one of these labels (or "Other"); a user can still type any
// category manually on a lead.

/** The canonical local-business category set. "Other" is the fallback. */
export const LOCAL_BUSINESS_CATEGORIES = [
  'Restaurants',
  'Healthcare',
  'Real Estate',
  'Salons & Beauty',
  'Gyms & Fitness',
  'Hotels',
  'Home Services',
  'Retail',
  'Other',
] as const;

export type LocalBusinessCategory = (typeof LOCAL_BUSINESS_CATEGORIES)[number];

/** Fallback category when nothing matches (also used for null/unknown). */
export const OTHER = 'Other';

/**
 * @deprecated Historical name for the fallback category. Kept so existing
 * imports keep compiling; its value is now "Other".
 */
export const UNCATEGORIZED = OTHER;

export interface CategoryResult {
  category: string;
  confidence: number;
  reason: string;
}

/** Display order for category buckets: the local-business list, "Other" last. */
export const CATEGORY_DISPLAY_ORDER = [
  'Restaurants',
  'Healthcare',
  'Real Estate',
  'Salons & Beauty',
  'Gyms & Fitness',
  'Hotels',
  'Home Services',
  'Retail',
];

interface Rule {
  category: string;
  /**
   * Lower-case stems; a trailing "*" matches any word continuation. A leading
   * "~" marks a generic word (e.g. "store", "coffee") that counts half, so it
   * cannot decide a category on its own.
   */
  keywords: string[];
}

export const CATEGORY_RULES: Rule[] = [
  { category: 'Restaurants', keywords: ['restaurant*', 'cafe', 'café', 'coffee shop', '~coffee', 'bakery', 'bakeries', 'catering', 'caterer*', 'food truck', 'pizzeria', 'pizza', 'bistro', 'diner', 'bar & grill', '~grill', 'steakhouse', 'brewery', 'brewpub', 'winery', 'taqueria', 'taco*', 'bbq', 'barbecue', 'sushi', 'ramen', 'deli', '~eatery', 'ice cream', 'donut*', 'sandwich shop', 'juice bar'] },
  { category: 'Healthcare', keywords: ['healthcare', 'health care', 'medical', 'clinic*', 'hospital*', 'doctor*', 'physician*', 'dental', 'dentist*', 'orthodont*', 'dermatolog*', 'pediatric*', 'pharmac*', 'physiotherap*', 'chiropract*', 'therapist*', '~therapy', 'nurse*', 'nursing', 'optometr*', 'surgeon*', 'surgery', 'med spa', 'medspa', 'mental health', 'urgent care', 'telehealth', '~patient*'] },
  { category: 'Real Estate', keywords: ['real estate', 'realtor*', 'realty', 'property manag*', '~properties', 'brokerage', 'homes for sale', 'home builder*', 'title company'] },
  { category: 'Salons & Beauty', keywords: ['beauty', 'salon*', 'hair salon', 'nail salon', 'makeup', 'make-up', 'make up artist', 'hairstyl*', 'hair stylist', 'hair studio', 'barber*', '~nail*', '~lash*', '~brow*', 'esthetic*', 'aesthetic*', 'skincare', 'skin care', '~cosmetic*', '~spa', 'day spa', 'waxing', 'tanning'] },
  { category: 'Gyms & Fitness', keywords: ['fitness', 'gym*', 'personal trainer*', 'yoga', 'pilates', 'crossfit', '~wellness', 'nutrition*', 'nutritionist*', 'meditation', 'martial arts', 'karate', 'jiu jitsu', 'boxing gym', 'dance studio', 'spin studio', 'health club'] },
  { category: 'Hotels', keywords: ['hotel*', 'motel*', 'resort*', '~inn', 'bed and breakfast', 'b&b', 'hostel', 'lodge', 'lodging', 'guest house', 'vacation rental*', '~suites', 'boutique hotel'] },
  { category: 'Home Services', keywords: ['construction', 'contractor*', 'general contractor', 'plumb*', 'plumber*', 'roofing', 'roofer*', 'hvac', 'air conditioning', 'air conditioner*', 'heating', 'cooling', 'furnace', 'refrigeration', 'electrician*', 'electrical', 'landscap*', 'lawn care', 'lawn service', 'pest control', 'exterminator', 'garage door', 'appliance repair', 'pool service', 'pool cleaning', 'tree service', 'tree trimming', 'fencing', 'fence', 'flooring', 'paving', 'asphalt', 'septic', 'locksmith', 'moving', 'movers', 'pressure washing', 'power washing', 'gutter*', 'insulation', 'drywall', 'concrete', 'masonry', 'painting', 'painter*', 'remodel*', 'renovation*', 'handyman', 'cleaning service*', 'maid service', 'janitorial', 'junk removal', 'window cleaning', 'carpet cleaning', 'water damage', 'restoration', 'solar install*', 'home services'] },
  { category: 'Retail', keywords: ['e-commerce', 'ecommerce', 'online store', 'online shop', 'shopify', 'woocommerce', 'etsy', 'amazon seller', 'dropshipping', 'boutique', '~retail', 'clothing brand', 'clothing store', 'apparel', '~store', '~shop', 'furniture store', 'jewelry', 'jeweler*', 'florist', 'flower shop', 'hardware store', 'grocer*', 'supermarket', 'gift shop', 'thrift store', '~market'] },
];

const FIELD_WEIGHTS = {
  category: 4,
  keywords: 3,
  name: 3,
  bio: 2,
  website: 1,
  username: 1,
} as const;
type CategorizedField = keyof typeof FIELD_WEIGHTS;

/**
 * Minimum weighted score to assign a category: one specific keyword in the
 * description (or name/keywords). A website or handle match alone, or a single
 * generic word, is not enough.
 */
const MIN_SCORE = 2;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPILED = CATEGORY_RULES.map((rule) => ({
  category: rule.category,
  patterns: rule.keywords.map((raw) => {
    const weak = raw.startsWith('~');
    const kw = weak ? raw.slice(1) : raw;
    const prefix = kw.endsWith('*');
    const stem = escapeRegex(prefix ? kw.slice(0, -1) : kw).replace(/\s+/g, '[\\s_-]+');
    return {
      weight: weak ? 0.5 : 1,
      keyword: prefix ? kw.slice(0, -1) : kw,
      regex: new RegExp(`(?:^|[^\\p{L}\\p{N}])${stem}${prefix ? '' : '(?![\\p{L}\\p{N}])'}`, 'iu'),
    };
  }),
}));

/** Domains and handles join words ("brightsmiledental"); split on separators only. */
function fieldText(field: CategorizedField, value: string): string {
  if (field === 'website') {
    return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[./]/g, ' ');
  }
  if (field === 'username') return value.replace(/[._]/g, ' ');
  return value;
}

export interface CategorizeInput {
  category?: string | null;
  keywords?: string | null;
  bio?: string | null;
  name?: string | null;
  website?: string | null;
  username?: string | null;
}

export function categorizeLead(input: CategorizeInput): CategoryResult {
  const provided = input.category?.trim();
  if (provided) {
    // A supplied category (e.g. a Google Maps business type like "HVAC
    // contractor" or "Pizza restaurant") is folded into the matching local
    // category. Anything that matches no category becomes "Other" — the
    // taxonomy is fixed, and a user can override it by hand.
    const canonical = scoreCategories({ category: provided });
    if (canonical && canonical.score >= FIELD_WEIGHTS.category) {
      return {
        category: canonical.category,
        confidence: 1,
        reason: `category "${provided.slice(0, 60)}" matches ${canonical.category} (${canonical.matched.join(', ')})`,
      };
    }
    return {
      category: OTHER,
      confidence: 0.3,
      reason: `category "${provided.slice(0, 60)}" does not match a known category`,
    };
  }

  const best = scoreCategories(input);
  if (!best || best.score < MIN_SCORE) {
    return {
      category: OTHER,
      confidence: 0,
      reason: best ? `weak signal only (${best.matched.join(', ')})` : 'no category keywords in name, description, keywords or website',
    };
  }
  return {
    category: best.category,
    confidence: Math.min(0.95, Number((0.5 + best.score * 0.05).toFixed(2))),
    reason: `matched ${best.matched.join(', ')}`,
  };
}

function scoreCategories(
  input: CategorizeInput,
): { category: string; score: number; matched: string[] } | null {
  const fields = (Object.keys(FIELD_WEIGHTS) as CategorizedField[])
    .map((field) => ({ field, text: input[field] ? fieldText(field, String(input[field])) : '' }))
    .filter((f) => f.text);
  if (fields.length === 0) return null;

  let best: { category: string; score: number; matched: string[] } | null = null;
  for (const rule of COMPILED) {
    let score = 0;
    const matched: string[] = [];
    for (const { keyword, regex, weight } of rule.patterns) {
      const hitFields = fields.filter((f) => regex.test(f.text));
      if (hitFields.length === 0) continue;
      // Each keyword counts once, at the weight of the strongest field it was found in.
      score += weight * Math.max(...hitFields.map((f) => FIELD_WEIGHTS[f.field]));
      matched.push(`"${keyword}" in ${hitFields.map((f) => f.field).join('/')}`);
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { category: rule.category, score, matched: matched.slice(0, 4) };
    }
  }
  return best;
}

/** Sorts category buckets for display: local-business order, then larger first, "Other" last. */
export function sortCategoryBuckets<T extends { category: string; count: number }>(buckets: T[]): T[] {
  const rank = (c: string) => {
    if (c === OTHER) return Number.MAX_SAFE_INTEGER;
    const i = CATEGORY_DISPLAY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_DISPLAY_ORDER.length : i;
  };
  return [...buckets].sort((a, b) => rank(a.category) - rank(b.category) || b.count - a.count || a.category.localeCompare(b.category));
}
