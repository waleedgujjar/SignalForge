import { prisma } from '@signalforge/database';
import {
  DEFAULT_POLICY,
  deliverabilityProtectionSchema,
  deliverabilityThresholdsSchema,
  healthScoreWeightsSchema,
  type DeliverabilityPolicy,
} from './types.js';

/// Callers may send any subset of the policy; unspecified fields keep their
/// current value rather than reverting to the default.
export interface DeliverabilityPolicyUpdate {
  protection?: Partial<DeliverabilityPolicy['protection']>;
  thresholds?: Partial<DeliverabilityPolicy['thresholds']>;
  weights?: Partial<DeliverabilityPolicy['weights']>;
}

/**
 * Resolves the effective deliverability policy for a workspace. Stored JSON is
 * merged over the conservative defaults, so a partially configured policy never
 * disables a safety rule by omission.
 */
export class DeliverabilityPolicyService {
  async get(workspaceId: string): Promise<DeliverabilityPolicy> {
    const row = await prisma.workspaceDeliverabilityPolicy.findUnique({ where: { workspaceId } });
    if (!row) return DEFAULT_POLICY;

    return {
      protection: deliverabilityProtectionSchema.parse({
        ...DEFAULT_POLICY.protection,
        ...asRecord(row.protection),
      }),
      thresholds: deliverabilityThresholdsSchema.parse({
        ...DEFAULT_POLICY.thresholds,
        ...asRecord(row.thresholds),
      }),
      weights: healthScoreWeightsSchema.parse({
        ...DEFAULT_POLICY.weights,
        ...asRecord(row.weights),
      }),
    };
  }

  async update(
    workspaceId: string,
    input: DeliverabilityPolicyUpdate,
  ): Promise<DeliverabilityPolicy> {
    const current = await this.get(workspaceId);
    const next: DeliverabilityPolicy = {
      protection: deliverabilityProtectionSchema.parse({
        ...current.protection,
        ...(input.protection ?? {}),
      }),
      thresholds: deliverabilityThresholdsSchema.parse({
        ...current.thresholds,
        ...(input.thresholds ?? {}),
      }),
      weights: healthScoreWeightsSchema.parse({ ...current.weights, ...(input.weights ?? {}) }),
    };

    await prisma.workspaceDeliverabilityPolicy.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        protection: next.protection,
        thresholds: next.thresholds,
        weights: next.weights,
      },
      update: {
        protection: next.protection,
        thresholds: next.thresholds,
        weights: next.weights,
      },
    });

    return next;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const deliverabilityPolicyService = new DeliverabilityPolicyService();
