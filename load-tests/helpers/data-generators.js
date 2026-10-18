const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
const COMPANIES = ['Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Cyberdyne', 'Stark Industries', 'Wayne Enterprises', 'Oscorp', 'LexCorp', 'Wonka'];
const INDUSTRIES = ['Technology', 'Healthcare', 'Finance', 'Manufacturing', 'Education', 'Retail', 'Energy', 'Real Estate'];
const COUNTRIES = ['US', 'UK', 'CA', 'DE', 'FR', 'AU', 'JP', 'BR'];
const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'NURTURING', 'CONVERTED', 'LOST'];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateLead(index) {
  const firstName = randomItem(FIRST_NAMES);
  const lastName = randomItem(LAST_NAMES);
  const company = randomItem(COMPANIES);
  const domain = company.toLowerCase().replace(/\s+/g, '') + '.com';

  return {
    email: `lead${index || randomInt(1, 99999)}@${domain}`,
    firstName,
    lastName,
    company,
    title: `${randomItem(['CEO', 'CTO', 'VP', 'Director', 'Manager'])} of ${randomItem(['Engineering', 'Sales', 'Marketing', 'Operations'])}`,
    phone: `+1${randomInt(200, 999)}${randomInt(100, 999)}${randomInt(1000, 9999)}`,
    industry: randomItem(INDUSTRIES),
    country: randomItem(COUNTRIES),
    website: `https://${domain}`,
    companyDomain: domain,
  };
}

export function generateSearchTerms() {
  return {
    short: randomItem(FIRST_NAMES).substring(0, 3).toLowerCase(),
    medium: randomItem(COMPANIES).substring(0, 5).toLowerCase(),
    long: randomItem(COMPANIES).toLowerCase(),
  };
}

export function generateCampaignPayload(name) {
  return {
    name: name || `Campaign ${randomInt(1, 9999)}`,
    status: 'DRAFT',
  };
}
