import { describe, expect, it } from 'vitest';
import { categorizeLead, sortCategoryBuckets, OTHER, UNCATEGORIZED, LOCAL_BUSINESS_CATEGORIES } from './categorizer.js';

describe('categorizeLead', () => {
  it.each([
    [{ name: 'Bright Smile Dental Clinic' }, 'Healthcare'],
    [{ name: 'Glow Hair & Nail Salon' }, 'Salons & Beauty'],
    [{ name: "Tony's Pizzeria & Italian Restaurant" }, 'Restaurants'],
    [{ name: 'Blackbelt Company', bio: 'HVAC services and air conditioning repair in San Antonio' }, 'Home Services'],
    [{ name: 'Radiant Plumbing & Air Conditioning' }, 'Home Services'],
    [{ name: 'Texas HVAC Heating LLC' }, 'Home Services'],
    [{ name: 'Lone Star Realty', bio: 'Real estate brokerage and property management' }, 'Real Estate'],
    [{ name: 'Iron Peak Gym', bio: 'Fitness center with personal trainers and crossfit' }, 'Gyms & Fitness'],
    [{ name: 'Riverwalk Boutique Hotel & Resort' }, 'Hotels'],
    [{ name: 'Wild Thread', bio: 'Online clothing store for handmade apparel', website: 'wildthread.myshopify.com' }, 'Retail'],
  ])('%o -> %s', (input, category) => {
    expect(categorizeLead(input).category).toBe(category);
  });

  it('only ever emits one of the fixed local-business categories', () => {
    for (const input of [
      { name: 'Downtown Dental' },
      { name: 'Iron Peak Gym' },
      { name: 'Joe Plumbing' },
      { name: 'Random Unmatched Co' },
    ]) {
      expect(LOCAL_BUSINESS_CATEGORIES).toContain(categorizeLead(input).category as never);
    }
  });

  it('scores every category instead of taking the first rule that matches', () => {
    // "photo" appears once, but this is clearly a dental practice.
    const r = categorizeLead({ name: 'Downtown Dental', bio: 'Family dentist and orthodontics clinic. See our office photo gallery.' });
    expect(r.category).toBe('Healthcare');
  });

  it('matches whole words, so look-alike substrings do not create categories', () => {
    expect(categorizeLead({ name: 'FastLink Broadband' }).category).toBe(OTHER); // not "band"
    expect(categorizeLead({ name: 'Spartan Movers' }).category).toBe('Home Services'); // "movers" is a home service
  });

  it('uses the keywords column', () => {
    expect(categorizeLead({ name: 'Studio 9', keywords: 'eyelash extensions, brows, makeup' }).category).toBe('Salons & Beauty');
  });

  it('folds a supplied business type into a known category, else "Other"', () => {
    expect(categorizeLead({ category: 'dentist' })).toMatchObject({ category: 'Healthcare', confidence: 1 });
    expect(categorizeLead({ category: 'HVAC contractor' })).toMatchObject({ category: 'Home Services', confidence: 1 });
    expect(categorizeLead({ category: 'Pizza restaurant' })).toMatchObject({ category: 'Restaurants', confidence: 1 });
    // A real category outside the fixed set collapses to Other.
    expect(categorizeLead({ category: 'aquarium supplies' })).toMatchObject({ category: OTHER });
  });

  it('explains its decision with the matched keywords and fields', () => {
    const r = categorizeLead({ name: 'Peak Physiotherapy', bio: 'Sports injury physiotherapy clinic' });
    expect(r.category).toBe('Healthcare');
    expect(r.reason).toMatch(/"physiotherap" in name\/bio/);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('falls back to "Other" when the evidence is weak or missing', () => {
    expect(categorizeLead({ name: 'Johnson Holdings LLC' }).category).toBe(OTHER);
    // One keyword in the website alone is not enough to decide.
    expect(categorizeLead({ website: 'https://boutique.example.com' }).category).toBe(OTHER);
    expect(categorizeLead({})).toMatchObject({ category: OTHER, confidence: 0 });
  });

  it('keeps UNCATEGORIZED as an alias of Other for existing callers', () => {
    expect(UNCATEGORIZED).toBe(OTHER);
  });
});

describe('sortCategoryBuckets', () => {
  it('lists local-business categories in order, then by size, with Other last', () => {
    const sorted = sortCategoryBuckets([
      { category: OTHER, count: 900 },
      { category: 'Retail', count: 5 },
      { category: 'Restaurants', count: 1 },
      { category: 'Healthcare', count: 3 },
      { category: 'Home Services', count: 50 },
      { category: 'Salons & Beauty', count: 2 },
    ]);
    expect(sorted.map((b) => b.category)).toEqual([
      'Restaurants',
      'Healthcare',
      'Salons & Beauty',
      'Home Services',
      'Retail',
      OTHER,
    ]);
  });
});
