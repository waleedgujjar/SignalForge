import { leadToVariableContext, parseSpintax, resolveVariables } from '@signalforge/email';
import { prisma } from '@signalforge/database';

export class CampaignPreviewService {
  async preview(
    workspaceId: string,
    input: {
      leadId: string;
      subjectTemplate: string;
      bodyTemplate: string;
      seed?: number;
      deterministic?: boolean;
    },
  ) {
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, workspaceId },
      include: {
        enrichment: true,
        websiteAnalyses: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!lead) throw new Error('Lead not found');

    const context = leadToVariableContext({
      email: lead.email,
      firstName: lead.firstName,
      lastName: lead.lastName,
      fullName: lead.fullName,
      company: lead.company,
      companyDomain: lead.companyDomain,
      jobTitle: lead.jobTitle,
      industry: lead.industry,
      country: lead.country,
      city: lead.city,
      website: lead.website,
      icpScore: lead.icpScore,
      customFields: lead.customFields,
      enrichment: lead.enrichment,
      websiteAnalysis: lead.websiteAnalyses[0] ?? null,
    });

    const seed = input.seed ?? 0;
    const spintaxOptions = {
      deterministic: input.deterministic ?? true,
      seed,
    };

    const subjectResolved = resolveVariables(input.subjectTemplate, context);
    const bodyResolved = resolveVariables(input.bodyTemplate, context);

    const subject = parseSpintax(subjectResolved.text, spintaxOptions);
    const body = parseSpintax(bodyResolved.text, spintaxOptions);

    return {
      leadId: lead.id,
      subject: subject.text,
      body: body.text,
      valid: subject.valid && body.valid,
      missingVariables: [...new Set([...subjectResolved.missingVariables, ...bodyResolved.missingVariables])],
      seed,
    };
  }

  async previewVariations(
    workspaceId: string,
    input: {
      leadId: string;
      subjectTemplate: string;
      bodyTemplate: string;
      count?: number;
    },
  ) {
    const count = input.count ?? 3;
    const variations = [];

    for (let seed = 0; seed < count; seed += 1) {
      variations.push(await this.preview(workspaceId, { ...input, seed }));
    }

    return variations;
  }
}

export const campaignPreviewService = new CampaignPreviewService();
