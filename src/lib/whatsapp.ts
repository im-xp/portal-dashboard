// WhatsApp outreach CRM — shared types + status ladder.
// Ladder semantics ported from portal-viz non-buyer-status-shared.ts:
// status only moves forward unless the caller explicitly overrides.

export const WHATSAPP_STATUS_PRECEDENCE = {
  uncontacted: 0,
  contacted: 1,
  responded: 2,
  converted: 3,
} as const;

export type WhatsAppStatus = keyof typeof WHATSAPP_STATUS_PRECEDENCE;

export const WHATSAPP_STATUSES = Object.keys(
  WHATSAPP_STATUS_PRECEDENCE
) as WhatsAppStatus[];

export function isMonotonicTransition(
  from: WhatsAppStatus,
  to: WhatsAppStatus
): boolean {
  return WHATSAPP_STATUS_PRECEDENCE[to] >= WHATSAPP_STATUS_PRECEDENCE[from];
}

export type WhatsAppCohort = 'non_buyer' | 'work_exchange';

export interface WhatsAppContact {
  contact_key: string;
  cohort: WhatsAppCohort;
  stable_id: string;
  phone: string | null;
  display_name: string;
  tier: string | null;
  groups: string[];
  message_count: number;
  first_seen: string | null;
  last_seen: string | null;
  still_in_group: boolean;
  rank: number | null;
  status: WhatsAppStatus;
  contacted_by: string | null;
  contacted_at: string | null;
  responded_at: string | null;
  converted_at: string | null;
  do_not_contact: boolean;
  assigned_to: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function waMeLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}
