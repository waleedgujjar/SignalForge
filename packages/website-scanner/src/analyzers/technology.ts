import type { CrawledPage, TechnologyDetection, Confidence } from '../types.js';

interface TechSignature {
  name: string;
  category: string;
  patterns?: RegExp[];
  headerPatterns?: { header: string; pattern: RegExp }[];
  scriptPatterns?: RegExp[];
}

const TECH_SIGNATURES: TechSignature[] = [
  // CMS
  { name: 'WordPress', category: 'CMS', patterns: [/wp-content/i, /wp-includes/i, /wp-json/i], headerPatterns: [{ header: 'x-powered-by', pattern: /WordPress/i }] },
  { name: 'Drupal', category: 'CMS', patterns: [/Drupal\.settings/i, /sites\/default\/files/i] },
  { name: 'Joomla', category: 'CMS', patterns: [/\/media\/jui/i, /com_content/i] },
  { name: 'Wix', category: 'CMS', patterns: [/wix\.com/i, /wixstatic\.com/i, /_wix_browser_sess/i] },
  { name: 'Squarespace', category: 'CMS', patterns: [/squarespace\.com/i, /sqsp\.net/i, /static\.squarespace/i] },
  { name: 'Webflow', category: 'CMS', patterns: [/webflow\.com/i, /assets\.website-files\.com/i] },
  { name: 'Shopify', category: 'E-commerce', patterns: [/shopify\.com/i, /cdn\.shopify/i, /Shopify\.theme/i] },
  { name: 'WooCommerce', category: 'E-commerce', patterns: [/woocommerce/i, /wc-ajax/i] },
  { name: 'Magento', category: 'E-commerce', patterns: [/mage\/cookies/i, /Magento_Ui/i] },
  { name: 'BigCommerce', category: 'E-commerce', patterns: [/bigcommerce\.com/i] },

  // Frameworks
  { name: 'React', category: 'Framework', patterns: [/__react/i, /react-root/i, /_reactRootContainer/i, /data-reactroot/i] },
  { name: 'Next.js', category: 'Framework', patterns: [/__next/i, /_next\/static/i, /next\/router/i] },
  { name: 'Vue.js', category: 'Framework', patterns: [/vue\.js/i, /vue\.min\.js/i, /data-v-[a-f0-9]/i, /vue-router/i] },
  { name: 'Nuxt', category: 'Framework', patterns: [/__nuxt/i, /_nuxt\//i] },
  { name: 'Angular', category: 'Framework', patterns: [/ng-version/i, /angular\.js/i, /ng-app/i, /ng-controller/i] },
  { name: 'Svelte', category: 'Framework', patterns: [/svelte/i, /__svelte/i] },
  { name: 'jQuery', category: 'Library', patterns: [/jquery/i], scriptPatterns: [/jquery[.-]?\d/i] },
  { name: 'Bootstrap', category: 'CSS Framework', patterns: [/bootstrap\.min/i, /bootstrap\.css/i] },
  { name: 'Tailwind CSS', category: 'CSS Framework', patterns: [/tailwindcss/i, /tailwind\.css/i] },

  // Analytics
  { name: 'Google Analytics', category: 'Analytics', patterns: [/google-analytics\.com/i, /googletagmanager\.com/i, /gtag\(/i, /ga\('create'/i] },
  { name: 'Google Tag Manager', category: 'Analytics', patterns: [/googletagmanager\.com\/gtm/i, /GTM-[A-Z0-9]/i] },
  { name: 'Facebook Pixel', category: 'Analytics', patterns: [/connect\.facebook\.net/i, /fbq\(/i, /fbevents\.js/i] },
  { name: 'Hotjar', category: 'Analytics', patterns: [/hotjar\.com/i, /hj\('init'/i] },
  { name: 'Mixpanel', category: 'Analytics', patterns: [/mixpanel\.com/i, /mixpanel\.init/i] },
  { name: 'Segment', category: 'Analytics', patterns: [/segment\.com\/analytics/i, /analytics\.load/i] },
  { name: 'Plausible', category: 'Analytics', patterns: [/plausible\.io/i] },

  // Marketing
  { name: 'HubSpot', category: 'Marketing', patterns: [/hubspot\.com/i, /hs-scripts/i, /hbspt\.forms/i] },
  { name: 'Mailchimp', category: 'Marketing', patterns: [/mailchimp\.com/i, /list-manage\.com/i, /mc\.us/i] },
  { name: 'Marketo', category: 'Marketing', patterns: [/marketo\.com/i, /marketo\.net/i, /munchkin/i] },
  { name: 'ActiveCampaign', category: 'Marketing', patterns: [/activecampaign\.com/i, /trackcmp\.net/i] },

  // Support
  { name: 'Intercom', category: 'Support', patterns: [/intercom\.com/i, /intercomSettings/i, /widget\.intercom\.io/i] },
  { name: 'Zendesk', category: 'Support', patterns: [/zendesk\.com/i, /zdassets\.com/i, /zE\('webWidget'/i] },
  { name: 'Freshdesk', category: 'Support', patterns: [/freshdesk\.com/i, /freshworks\.com/i] },
  { name: 'Drift', category: 'Support', patterns: [/drift\.com/i, /js\.driftt\.com/i] },
  { name: 'Crisp', category: 'Support', patterns: [/crisp\.chat/i, /client\.crisp\.chat/i] },
  { name: 'Tawk.to', category: 'Support', patterns: [/tawk\.to/i, /embed\.tawk/i] },
  { name: 'LiveChat', category: 'Support', patterns: [/livechatinc\.com/i, /cdn\.livechatinc/i] },

  // Payment
  { name: 'Stripe', category: 'Payment', patterns: [/stripe\.com/i, /js\.stripe\.com/i] },
  { name: 'PayPal', category: 'Payment', patterns: [/paypal\.com/i, /paypalobjects\.com/i] },
  { name: 'Square', category: 'Payment', patterns: [/squareup\.com/i, /square\.site/i] },

  // Hosting
  { name: 'Cloudflare', category: 'CDN/Hosting', headerPatterns: [{ header: 'server', pattern: /cloudflare/i }, { header: 'cf-ray', pattern: /.+/ }] },
  { name: 'AWS', category: 'CDN/Hosting', headerPatterns: [{ header: 'server', pattern: /AmazonS3|CloudFront/i }, { header: 'x-amz-request-id', pattern: /.+/ }] },
  { name: 'Vercel', category: 'CDN/Hosting', headerPatterns: [{ header: 'server', pattern: /Vercel/i }, { header: 'x-vercel-id', pattern: /.+/ }] },
  { name: 'Netlify', category: 'CDN/Hosting', headerPatterns: [{ header: 'server', pattern: /Netlify/i }, { header: 'x-nf-request-id', pattern: /.+/ }] },
];

export function detectTechnologies(pages: CrawledPage[]): TechnologyDetection[] {
  const detected = new Map<string, { tech: TechSignature; matchCount: number }>();

  for (const page of pages) {
    const html = page.html;

    for (const sig of TECH_SIGNATURES) {
      if (detected.has(sig.name)) {
        detected.get(sig.name)!.matchCount++;
        continue;
      }

      let matched = false;

      if (sig.patterns) {
        for (const p of sig.patterns) {
          if (p.test(html)) { matched = true; break; }
        }
      }

      if (!matched && sig.headerPatterns) {
        for (const hp of sig.headerPatterns) {
          const val = page.headers[hp.header];
          if (val && hp.pattern.test(val)) { matched = true; break; }
        }
      }

      if (!matched && sig.scriptPatterns) {
        for (const sp of sig.scriptPatterns) {
          if (sp.test(html)) { matched = true; break; }
        }
      }

      if (matched) {
        detected.set(sig.name, { tech: sig, matchCount: 1 });
      }
    }
  }

  return Array.from(detected.entries()).map(([name, { tech, matchCount }]): TechnologyDetection => {
    let confidence: Confidence = 'LOW';
    if (matchCount >= 3) confidence = 'HIGH';
    else if (matchCount >= 1) confidence = 'MEDIUM';

    return { name, category: tech.category, confidence };
  });
}
