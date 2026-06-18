/**
 * Flag WhatsApp non-buyer contacts who HOLD an active Fever admission ticket as
 * the ticket owner (holder), even though they are not the order buyer, as
 * do_not_contact. Sibling of scrub-wa-reclassified-buyers.ts (order buyers) and
 * scrub-wa-portal-participants.ts (Portal admission).
 *
 * The buyer-matcher keys only on order-level buyer_email, so gifted/assigned
 * ticket holders (admission tracked on the order ITEM's owner_email) slip onto
 * the outreach list. The pat-profile-cloud job owner_admission_match.py resolves
 * each member's phone to an email via CustomerIO and checks for an ACTIVE
 * (purchased) ticket held as owner_email, writing
 * reports/whatsapp-fever-ticket-holders.json. Cancelled/refunded-only holders
 * are excluded upstream (they are not admitted).
 *
 * Sets do_not_contact = true, appends an explanatory note, logs a
 * whatsapp_activity row. Nothing is deleted; the flag is reversible from the
 * dashboard. Dry-run by default; --apply writes. Idempotent.
 *
 * Usage:
 *   npx tsx scripts/scrub-wa-fever-ticket-holders.ts [--artifact path]            # dry run
 *   npx tsx scripts/scrub-wa-fever-ticket-holders.ts [--artifact path] --apply    # write
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_ARTIFACT_PATH = `${process.env.HOME}/imxp/pat-profile-cloud/reports/whatsapp-fever-ticket-holders.json`;

interface Holder {
  stable_id: string;
  display_name: string | null;
  phone: string | null;
  tier: string | null;
  matched_email: string;
  active_ticket_count: number;
  match_confidence: string;
}

interface Artifact {
  generated_at: string;
  members: Holder[];
}

function flagValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const APPLY = process.argv.includes('--apply');
const artifactPath = flagValue('--artifact') || DEFAULT_ARTIFACT_PATH;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const artifact: Artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const holdersById = new Map(artifact.members.map((m) => [m.stable_id, m]));
  console.log(
    `Artifact ${artifact.generated_at}: ${artifact.members.length} members holding an active Fever ticket as owner.`
  );

  const { data: contacts, error } = await supabase
    .from('whatsapp_contacts')
    .select('contact_key, stable_id, display_name, tier, status, do_not_contact, notes')
    .eq('cohort', 'non_buyer');
  if (error) {
    console.error('Failed to read whatsapp_contacts:', error.message);
    process.exit(1);
  }

  const onList = (contacts ?? []).filter((c) => holdersById.has(c.stable_id));
  const toFlag = onList.filter((c) => !c.do_not_contact);
  const alreadyFlagged = onList.filter((c) => c.do_not_contact);
  const alreadyActioned = toFlag.filter((c) => c.status !== 'uncontacted');

  console.log(
    `\nLive non_buyer rows: ${contacts?.length ?? 0} | ticket-holders on list: ${onList.length} | to flag: ${toFlag.length} | already flagged (skip): ${alreadyFlagged.length}`
  );

  console.log('\n=== Contacts to flag do_not_contact ===');
  for (const c of toFlag) {
    const h = holdersById.get(c.stable_id)!;
    const warn = c.status !== 'uncontacted' ? `  ⚠️  status=${c.status}` : '';
    console.log(
      `  ${c.stable_id} | ${c.display_name} | tier ${c.tier} | holds ${h.active_ticket_count} active ticket(s) (${h.matched_email})${warn}`
    );
  }

  if (alreadyActioned.length) {
    console.log(
      `\n⚠️  ${alreadyActioned.length} of these were ALREADY contacted/responded/converted — review for follow-up:`
    );
    for (const c of alreadyActioned) {
      console.log(`     ${c.display_name} (status=${c.status})`);
    }
  }

  if (!APPLY) {
    console.log('\n[dry-run] No changes written. Re-run with --apply to flag these rows.');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let flagged = 0;
  for (const c of toFlag) {
    const h = holdersById.get(c.stable_id)!;
    const note = [
      c.notes?.trim() || null,
      `[auto ${today}] Originally added to the non-buyer list by mistake — holds ${h.active_ticket_count} active Fever admission ticket(s) as ticket-holder (owner_email ${h.matched_email}; not the order buyer, so the buyer-match missed them). Already admitted; excluded from outreach.`,
    ]
      .filter(Boolean)
      .join('\n');

    const { error: updateError } = await supabase
      .from('whatsapp_contacts')
      .update({ do_not_contact: true, notes: note, updated_at: new Date().toISOString() })
      .eq('contact_key', c.contact_key);
    if (updateError) {
      console.error(`  FAILED ${c.contact_key}:`, updateError.message);
      continue;
    }

    await supabase.from('whatsapp_activity').insert({
      contact_key: c.contact_key,
      action: 'auto_flagged_fever_ticket_holder',
      actor: 'pipeline',
      metadata: {
        matched_email: h.matched_email,
        match_confidence: h.match_confidence,
        active_ticket_count: h.active_ticket_count,
        artifact_generated_at: artifact.generated_at,
        prior_status: c.status,
      },
    });
    flagged += 1;
    console.log(`  flagged ${c.display_name}`);
  }

  console.log(`\nDone. Flagged ${flagged}/${toFlag.length} contacts do_not_contact.`);
}

main();
