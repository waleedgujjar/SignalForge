// Rule-based lead categorization: explainable, deterministic, no external calls.
//
// Each category lists keyword stems. Text from the lead's fields is matched on
// word boundaries (so "band" does not match "broadband"), every category is
// scored with per-field weights, and the best score wins only above a minimum.
// Anything weaker is left Uncategorized rather than guessed.

export const UNCATEGORIZED = 'Uncategorized';

export interface CategoryResult {
  category: string;
  confidence: number;
  reason: string;
}

/**
 * Display order for categories: the user's priority list first, then all other
 * categories by size, Uncategorized last.
 */
export const CATEGORY_DISPLAY_ORDER = [
  'Healthcare',
  'Beauty',
  'SaaS',
  'Software',
  'Technology',
  'Marketing',
  'Finance',
  'E-commerce',
  'Blogs',
];

interface Rule {
  category: string;
  /**
   * Lower-case stems; a trailing "*" matches any word continuation. A leading
   * "~" marks a generic word (e.g. "store", "cloud") that counts half, so it
   * cannot decide a category on its own.
   */
  keywords: string[];
}

export const CATEGORY_RULES: Rule[] = [
  { category: 'Healthcare', keywords: ['healthcare', 'health care', 'medical', 'clinic*', 'hospital*', 'doctor*', 'physician*', 'dental', 'dentist*', 'orthodont*', 'dermatolog*', 'pediatric*', 'pharmac*', 'physiotherap*', 'chiropract*', 'therapist*', '~therapy', 'nurse*', 'nursing', 'optometr*', 'surgeon*', 'surgery', 'med spa', 'medspa', 'mental health', 'urgent care', 'telehealth', '~patient*'] },
  { category: 'Beauty', keywords: ['beauty', 'salon*', 'makeup', 'make-up', 'make up artist', 'hairstyl*', 'hair stylist', 'hair studio', 'barber*', '~nail*', '~lash*', '~brow*', 'esthetic*', 'aesthetic*', 'skincare', 'skin care', '~cosmetic*', '~spa', 'day spa'] },
  { category: 'SaaS', keywords: ['saas', 'software as a service', 'b2b software', 'subscription software', 'cloud platform', 'crm', 'erp', 'api platform', 'no-code', 'nocode'] },
  { category: 'Software', keywords: ['software', 'software development', 'app develop*', 'web develop*', 'mobile app*', '~developer*', 'dev shop', 'devops', 'full stack', 'fullstack', '~programming'] },
  { category: 'Technology', keywords: ['technology', 'tech company', 'it services', 'it support', 'managed services', 'cybersecurity', 'cyber security', 'artificial intelligence', '~ai', 'machine learning', 'data analytics', '~cloud', 'blockchain', 'web3', '~hardware', '~electronics'] },
  { category: 'Marketing', keywords: ['marketing', 'digital marketing', 'seo', 'sem', 'ppc', 'advertis*', 'social media', 'growth agency', 'media agency', 'digital agency', 'branding agency', 'lead generation', 'copywrit*', 'pr agency', 'public relations', 'influencer marketing'] },
  { category: 'Finance', keywords: ['finance', 'financial', 'accounting', 'accountant*', 'bookkeep*', 'cpa', '~tax*', 'insurance', 'mortgage*', '~loan*', '~bank*', 'banking', '~invest*', '~wealth', 'fintech', 'payroll', '~credit'] },
  { category: 'E-commerce', keywords: ['e-commerce', 'ecommerce', 'online store', 'online shop', 'shopify', 'woocommerce', 'etsy', 'amazon seller', 'dropshipping', 'boutique', '~retail', 'clothing brand', 'apparel', 'shop now', '~store'] },
  { category: 'Blogs', keywords: ['blog*', 'blogger*', 'newsletter', 'substack', 'magazine', '~publication', 'content creator', 'podcast*', 'vlog*', '~writer', 'journalist'] },
  { category: 'Photography', keywords: ['photograph*', 'photo studio', 'photoshoot', 'fotograf*'] },
  { category: 'Videography', keywords: ['videograph*', 'video production', 'filmmaker*', 'film maker', 'cinematograph*'] },
  { category: 'Design', keywords: ['graphic design*', 'ui/ux', 'ux design*', 'ui design*', 'web design*', 'interior design*', '~designer*', 'design studio', '~branding'] },
  { category: 'Consulting & Coaching', keywords: ['~consult*', '~coach*', '~mentor*', '~advisor*', 'advisory'] },
  { category: 'Real Estate', keywords: ['real estate', 'realtor*', 'realty', 'property manag*', '~properties', 'brokerage', 'homes for sale'] },
  { category: 'Food & Beverage', keywords: ['restaurant*', 'cafe', 'café', '~coffee', 'bakery', 'bakeries', 'catering', 'food truck', 'pizzeria', 'bar & grill', 'bistro', 'brewery', 'winery'] },
  { category: 'Fitness & Wellness', keywords: ['fitness', 'gym', 'personal trainer*', 'yoga', 'pilates', 'crossfit', 'wellness', 'nutrition*', 'nutritionist*', 'meditation'] },
  { category: 'Legal', keywords: ['law firm', 'attorney*', 'lawyer*', 'legal services', 'solicitor*', 'paralegal', 'notary'] },
  { category: 'Construction & Home Services', keywords: ['construction', 'contractor*', 'plumb*', 'roofing', 'roofer*', 'hvac', 'electrician*', 'landscap*', 'cleaning service*', 'remodel*', 'renovation*', 'handyman', 'painting contractor'] },
  { category: 'Automotive', keywords: ['automotive', 'car dealer*', 'auto repair', 'auto detail*', 'car wash', 'mechanic*', 'auto body', '~tire*'] },
  { category: 'Education', keywords: ['~school*', '~academy', 'tutor*', 'education', 'university', 'learning center', 'online course*', 'edtech', 'training center'] },
  { category: 'Travel & Hospitality', keywords: ['travel', 'hotel*', 'tour operator*', '~tours', 'hospitality', 'resort*', 'airbnb', 'vacation rental*', 'travel agency'] },
  { category: 'Events & Entertainment', keywords: ['wedding*', 'event plann*', 'event venue', '~dj', '~entertainment', 'musician*', 'live music', '~band', 'comedian*', 'photo booth'] },
  { category: 'Nonprofit', keywords: ['nonprofit', 'non-profit', 'charity', 'charities', '~foundation', 'ngo', '~volunteer*'] },
  { category: 'Veterinary & Pets', keywords: ['veterinar*', 'vet clinic', 'pet groom*', 'dog groom*', 'pet store', 'pet shop', 'dog train*', 'animal hospital'] },
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

function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60)
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
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
    // A file category that clearly names a known category is folded into it so
    // "Dentist" and "Dental Clinic" group together; anything else is kept as
    // its own dynamic category.
    const canonical = scoreCategories({ category: provided });
    if (canonical && canonical.score >= FIELD_WEIGHTS.category) {
      return {
        category: canonical.category,
        confidence: 1,
        reason: `file category "${provided.slice(0, 60)}" matches ${canonical.category} (${canonical.matched.join(', ')})`,
      };
    }
    return { category: titleCase(provided), confidence: 1, reason: 'category provided in file' };
  }

  const best = scoreCategories(input);
  if (!best || best.score < MIN_SCORE) {
    return {
      category: UNCATEGORIZED,
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

/** Sorts category buckets for display: priority list, then larger first, Uncategorized last. */
export function sortCategoryBuckets<T extends { category: string; count: number }>(buckets: T[]): T[] {
  const rank = (c: string) => {
    if (c === UNCATEGORIZED) return Number.MAX_SAFE_INTEGER;
    const i = CATEGORY_DISPLAY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_DISPLAY_ORDER.length : i;
  };
  return [...buckets].sort((a, b) => rank(a.category) - rank(b.category) || b.count - a.count || a.category.localeCompare(b.category));
}
