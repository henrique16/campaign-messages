export const CAMPAIGN_STATUS = {
  draft: 'draft',
  running: 'running',
  finished: 'finished',
} as const

export type CampaignStatus = (typeof CAMPAIGN_STATUS)[keyof typeof CAMPAIGN_STATUS]
