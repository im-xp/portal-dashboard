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
  accessory?: {
    type: string;
    text?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    url?: string;
    action_id?: string;
  };
  elements?: Array<{
    type: string;
    text?: string | { type: string; text: string; emoji?: boolean };
    url?: string;
    action_id?: string;
  }>;
  fields?: Array<{
    type: string;
    text: string;
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
  unclaimed: { total: number; stale: number };
  awaitingTeam: { total: number; stale: number };
  oldestStale: Array<{ customer_email: string; subject: string | null; age_display: string }>;
  dashboardUrl: string;
}): SlackMessage {
  const totalStale = stats.unclaimed.stale + stats.awaitingTeam.stale;
  const hasIssues = totalStale > 0;

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: hasIssues ? '📬 Email Queue Needs Attention' : '📬 Email Queue Status',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Unclaimed*\n${stats.unclaimed.total} total${stats.unclaimed.stale > 0 ? ` · ⚠️ ${stats.unclaimed.stale} stale` : ''}`,
        },
        {
          type: 'mrkdwn',
          text: `*Awaiting Team Reply*\n${stats.awaitingTeam.total} total${stats.awaitingTeam.stale > 0 ? ` · ⚠️ ${stats.awaitingTeam.stale} stale` : ''}`,
        },
      ],
    },
  ];

  if (stats.oldestStale.length > 0) {
    blocks.push({ type: 'divider' });

    const staleList = stats.oldestStale.map((ticket) => {
      const subject = ticket.subject || '(No subject)';
      const truncatedSubject = subject.length > 35 ? subject.slice(0, 35) + '…' : subject;
      return `• *${ticket.customer_email}*\n   _${truncatedSubject}_ · ${ticket.age_display}`;
    });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Oldest stale:*\n${staleList.join('\n')}`,
      },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Open Email Queue',
          emoji: true,
        },
        url: stats.dashboardUrl,
        action_id: 'open_dashboard',
      },
    ],
  });

  return {
    text: `Email Queue: ${stats.unclaimed.total} unclaimed, ${stats.awaitingTeam.total} awaiting team reply`,
    blocks,
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
