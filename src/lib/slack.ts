const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

export interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: string;
    url?: string;
  }>;
}

export async function sendSlackMessage(
  message: SlackMessage,
  webhookUrl?: string
): Promise<boolean> {
  const url = webhookUrl || SLACK_WEBHOOK_URL;
  if (!url) {
    console.warn('[Slack] No webhook URL configured');
    return false;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.error('[Slack] Failed to send message:', response.status);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Slack] Error sending message:', error);
    return false;
  }
}

export function formatDigestMessage(stats: {
  needsResponse: number;
  stale: number;
  unclaimed: number;
  staleTickets: Array<{ customer_email: string; subject: string | null; age_display: string }>;
  dashboardUrl: string;
}): SlackMessage {
  const lines = [
    ':mailbox_with_mail: *Email Queue Daily Digest*',
    '',
    `:red_circle: *${stats.needsResponse}* tickets need response`,
    `:warning: *${stats.stale}* stale (>24h)`,
    `:bust_in_silhouette: Unclaimed: *${stats.unclaimed}*`,
  ];

  if (stats.staleTickets.length > 0) {
    lines.push('', '*Top stale:*');
    stats.staleTickets.slice(0, 3).forEach((ticket) => {
      const subject = ticket.subject || '(No subject)';
      const truncatedSubject = subject.length > 40 ? subject.slice(0, 40) + '...' : subject;
      lines.push(`• ${ticket.customer_email} - "${truncatedSubject}" (${ticket.age_display})`);
    });
  }

  lines.push('', `<${stats.dashboardUrl}|View Dashboard>`);

  return {
    text: `Email Queue: ${stats.needsResponse} need response, ${stats.stale} stale`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: lines.join('\n'),
        },
      },
    ],
  };
}

export function formatStaleAlert(ticket: {
  customer_email: string;
  subject: string | null;
  claimed_by: string | null;
  age_display: string;
  dashboardUrl: string;
}): SlackMessage {
  const subject = ticket.subject || '(No subject)';
  const claimedInfo = ticket.claimed_by
    ? `Claimed by: ${ticket.claimed_by.split('@')[0]}`
    : 'Unclaimed';

  return {
    text: `Stale ticket alert: ${ticket.customer_email}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            ':rotating_light: *Stale Ticket Alert*',
            '',
            `*${ticket.customer_email}* hasn't received a response in *${ticket.age_display}*`,
            `Subject: "${subject}"`,
            claimedInfo,
            '',
            `<${ticket.dashboardUrl}|View in Dashboard>`,
          ].join('\n'),
        },
      },
    ],
  };
}

export function formatFeverOrderNotification(order: {
  orderId: string;
  buyerEmail: string;
  buyerName: string | null;
  planName: string;
  itemCount: number;
  totalPrice: number;
  currency: string;
  sessionName: string | null;
  sessionStart: Date | null;
  dashboardUrl: string;
}): SlackMessage {
  const buyerDisplay = order.buyerName || order.buyerEmail;
  const priceDisplay = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: order.currency,
  }).format(order.totalPrice);

  const sessionDisplay = order.sessionStart
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(order.sessionStart)
    : null;

  const lines = [
    ':ticket: *New Fever Order*',
    '',
    `*${buyerDisplay}*`,
    `${order.planName}`,
    `${order.itemCount} ticket${order.itemCount !== 1 ? 's' : ''} • ${priceDisplay}`,
  ];

  if (order.sessionName && sessionDisplay) {
    lines.push(`Session: ${order.sessionName} (${sessionDisplay})`);
  } else if (sessionDisplay) {
    lines.push(`Session: ${sessionDisplay}`);
  }

  lines.push('', `<${order.dashboardUrl}|View Orders>`);

  return {
    text: `New Fever order: ${buyerDisplay} - ${order.planName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: lines.join('\n'),
        },
      },
    ],
  };
}
