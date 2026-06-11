// Access gate for the WhatsApp outreach tab. The non-buyer list is PII
// (phones + names of community members), so unlike /volunteers it is NOT
// open to every volunteer_viewer — only admins plus this allowlist.
// Edge-safe: imported by middleware, keep free of node/supabase imports.

const WHATSAPP_OUTREACH_EMAILS = ['deja@im-xp.com'];

export function canAccessWhatsApp(
  email: string | null | undefined,
  role: string | null | undefined
): boolean {
  if (role === 'admin') return true;
  if (!email) return false;
  return WHATSAPP_OUTREACH_EMAILS.includes(email.toLowerCase());
}
