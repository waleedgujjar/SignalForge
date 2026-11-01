const ROLE_PREFIXES = [
  'info',
  'admin',
  'support',
  'sales',
  'contact',
  'help',
  'noreply',
  'no-reply',
  'hello',
  'office',
  'marketing',
  'billing',
  'hr',
  'careers',
  'team',
  'service',
  'accounts',
  'enquiries',
  'enquiry',
  'inquiry',
  'inquiries',
  'webmaster',
  'postmaster',
  'hostmaster',
  'abuse',
  'root',
  'mailer-daemon',
  'donotreply',
  'do-not-reply',
  'jobs',
  'press',
  'media',
  'privacy',
  'legal',
  'security',
  'orders',
  'feedback',
  'newsletter',
  'reception',
  'customerservice',
  'customercare',
  'finance',
  'accounting',
  'invoices',
  'partners',
  'events',
  'booking',
  'bookings',
  'reservations',
  'general',
  'mail',
];

export interface RoleDetectionResult {
  isRole: boolean;
  roleType: string | null;
}

export function detectRoleEmail(localPart: string): RoleDetectionResult {
  const lower = localPart.toLowerCase();
  for (const prefix of ROLE_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}+`) || lower.startsWith(`${prefix}.`)) {
      return { isRole: true, roleType: prefix };
    }
  }
  return { isRole: false, roleType: null };
}

export { ROLE_PREFIXES };
