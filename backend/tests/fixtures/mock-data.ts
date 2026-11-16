import type { ProcessedSearchResult } from "../../src/services/search/result-processor";

export const MOCK_CRM_SEARCH_RESULTS: ProcessedSearchResult[] = [
  {
    title: "HubSpot Pricing & Plans 2026 - Official",
    url: "https://www.hubspot.com/pricing/crm",
    content: "HubSpot Sales Hub Professional is $90/seat/month billed annually. Free tools remain free for up to 5 users.",
    publishedDate: "2026-11-10T00:00:00Z",
    domain: "hubspot.com",
    score: 0.95,
    qualityScore: 0.95,
    isAfterAnchor: true,
    isPrimarySource: true,
  },
  {
    title: "Salesforce Starter Suite 2026 Update",
    url: "https://www.salesforce.com/editions-pricing/starter/",
    content: "Salesforce Starter Suite is $25/user/month. Pro Suite announced at $100/user/month with advanced customization.",
    publishedDate: "2026-11-11T00:00:00Z",
    domain: "salesforce.com",
    score: 0.93,
    qualityScore: 0.92,
    isAfterAnchor: true,
    isPrimarySource: true,
  },
  {
    title: "Pipedrive Pricing - Sales CRM",
    url: "https://www.pipedrive.com/en/pricing",
    content: "Pipedrive Essential plan is $14/user/month. Advanced plan is $34/user/month. No price changes since October 2026.",
    publishedDate: "2026-11-08T00:00:00Z",
    domain: "pipedrive.com",
    score: 0.91,
    qualityScore: 0.88,
    isAfterAnchor: false,
    isPrimarySource: true,
  },
];

export const MOCK_POSTGRES_SEARCH_RESULTS: ProcessedSearchResult[] = [
  {
    title: "Neon Serverless Postgres Pricing 2026",
    url: "https://neon.tech/pricing",
    content: "Neon Free Tier includes 0.5 GB storage and shared compute. Launch plan is $19/month with 10 GB storage.",
    publishedDate: "2026-11-10T00:00:00Z",
    domain: "neon.tech",
    score: 0.96,
    qualityScore: 0.95,
    isAfterAnchor: true,
    isPrimarySource: true,
  },
  {
    title: "Supabase Pricing & Compute Updates",
    url: "https://supabase.com/pricing",
    content: "Supabase Free plan includes 500 MB database storage. Pro plan is $25/month with 8 GB included storage.",
    publishedDate: "2026-11-09T00:00:00Z",
    domain: "supabase.com",
    score: 0.94,
    qualityScore: 0.93,
    isAfterAnchor: true,
    isPrimarySource: true,
  },
];

