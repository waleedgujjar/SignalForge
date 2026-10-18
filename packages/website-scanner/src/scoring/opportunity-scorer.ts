import type { ScoreBreakdown } from '../types.js';

export function calculateOpportunityScore(
  websiteScore: number,
  scoreBreakdown: ScoreBreakdown,
): { opportunityScore: number; opportunityPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' } {
  const weakAreas = Object.values(scoreBreakdown).filter(s => s < 50).length;
  const veryWeakAreas = Object.values(scoreBreakdown).filter(s => s < 30).length;

  let opportunityScore = 100 - websiteScore;
  opportunityScore += weakAreas * 5;
  opportunityScore += veryWeakAreas * 5;
  opportunityScore = Math.max(0, Math.min(100, opportunityScore));

  let opportunityPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  if (opportunityScore >= 75) opportunityPriority = 'VERY_HIGH';
  else if (opportunityScore >= 55) opportunityPriority = 'HIGH';
  else if (opportunityScore >= 35) opportunityPriority = 'MEDIUM';
  else opportunityPriority = 'LOW';

  return { opportunityScore, opportunityPriority };
}
