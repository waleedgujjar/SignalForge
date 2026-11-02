import { describe, expect, it } from 'vitest';
import { categorizeLead, sortCategoryBuckets, UNCATEGORIZED } from './categorizer.js';

describe('categorizeLead', () => {
  it.each([
    [{ name: 'Bright Smile Dental Clinic' }, 'Healthcare'],
    [{ name: 'Glow Hair & Nail Salon' }, 'Beauty'],
    [{ name: 'Acme', bio: 'B2B SaaS platform for subscription billing' }, 'SaaS'],
    [{ name: 'Pixel Forge', bio: 'Custom software development and mobile app development' }, 'Software'],
    [{ name: 'Northwind IT Services', bio: 'Managed services and cybersecurity' }, 'Technology'],
    [{ name: 'Growth Lab', bio: 'Digital marketing, SEO and PPC for local businesses' }, 'Marketing'],
    [{ name: 'Ledger & Co', bio: 'Accounting, bookkeeping and tax preparation' }, 'Finance'],
    [{ name: 'Wild Thread', bio: 'Online store for handmade apparel', website: 'wildthread.myshopify.com' }, 'E-commerce'],
    [{ name: 'The Frugal Writer', bio: 'Personal finance blog and weekly newsletter' }, 'Blogs'],
  ])('%o -> %s', (input, category) => {
    expect(categorizeLead(input).category).toBe(category);
  });

  it('scores every category instead of taking the first rule that matches', () => {
    // "photo" appears once, but this is clearly a dental practice.
    const r = categorizeLead({ name: 'Downtown Dental', bio: 'Family dentist and orthodontics clinic. See our office photo gallery.' });
    expect(r.category).toBe('Healthcare');
  });

  it('matches whole words, so look-alike substrings do not create categories', () => {
    expect(categorizeLead({ name: 'FastLink Broadband' }).category).toBe(UNCATEGORIZED); // not "band"
    expect(categorizeLead({ name: 'Spartan Movers' }).category).toBe(UNCATEGORIZED); // not "spa"/"art"
  });

  it('uses the keywords column', () => {
    expect(categorizeLead({ name: 'Studio 9', keywords: 'eyelash extensions, brows, makeup' }).category).toBe('Beauty');
  });

  it('folds a file category into a known category, and keeps unknown ones as their own', () => {
    expect(categorizeLead({ category: 'dentist' })).toMatchObject({ category: 'Healthcare', confidence: 1 });
    expect(categorizeLead({ category: 'aquarium supplies' })).toMatchObject({ category: 'Aquarium Supplies', confidence: 1 });
  });

  it('explains its decision with the matched keywords and fields', () => {
    const r = categorizeLead({ name: 'Peak Physiotherapy', bio: 'Sports injury physiotherapy clinic' });
    expect(r.category).toBe('Healthcare');
    expect(r.reason).toMatch(/"physiotherap" in name\/bio/);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('leaves a lead Uncategorized when the evidence is weak or missing', () => {
    expect(categorizeLead({ name: 'Johnson Holdings LLC' }).category).toBe(UNCATEGORIZED);
    // One keyword in the website alone is not enough to decide.
    expect(categorizeLead({ website: 'https://blogspot.example.com' }).category).toBe(UNCATEGORIZED);
    expect(categorizeLead({})).toMatchObject({ category: UNCATEGORIZED, confidence: 0 });
  });
});

describe('sortCategoryBuckets', () => {
  it('lists priority categories first, then by size, with Uncategorized last', () => {
    const sorted = sortCategoryBuckets([
      { category: UNCATEGORIZED, count: 900 },
      { category: 'Legal', count: 5 },
      { category: 'Blogs', count: 1 },
      { category: 'Healthcare', count: 3 },
      { category: 'Real Estate', count: 50 },
      { category: 'Beauty', count: 2 },
    ]);
    expect(sorted.map((b) => b.category)).toEqual(['Healthcare', 'Beauty', 'Blogs', 'Real Estate', 'Legal', UNCATEGORIZED]);
  });
});
