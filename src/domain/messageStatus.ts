export const MESSAGE_STATUS = {
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
} as const

export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS]
