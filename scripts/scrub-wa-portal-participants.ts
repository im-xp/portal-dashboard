/**
 * Flag WhatsApp non-buyer contacts who already have Festival admission via the
 * Portal (EdgeOS) as do_not_contact, so Deja stops asking them to buy a Fever
 * ticket. Sibling of scrub-wa-reclassified-buyers.ts (which handles Fever
 * buyers); this one handles Portal participants.
 *
 * The Portal stores NO phone number (humans are keyed by email + telegram), and
 * many WA members appear only as a bare phone-number display name, so the two
 * systems share only one key: the phone. The pat-profile-cloud pipeline resolves
 * each WA member's phone to an email via the CustomerIO phone<->email bridge and
 * checks it against the Portal's admitted-email set (accepted application OR
 * attendee record OR paid pass). The result is written to
 * reports/whatsapp-portal-participants.json, which this script consumes.
 *
 * Two inputs:
 *   --artifact <path>  data-matched portal participants (the pipeline artifact)
 *   --manual   <path>  optional {confirmations:[{stable_id,phone?,reason}]} for
 *                      contacts confirmed by direct conversation, where no
 *                      phone<->portal-email link exists in our data.
 *
 * For each affected contact we set do_not_contact = true (the /whatsapp UI hides
 * the send + advance-status buttons and drops the row from the Tier-A stats),
 * append an explanatory note, and log a whatsapp_activity row. We DO NOT delete:
 * Deja's history (status/notes/contacted_at) is preserved and the flag is
 * reversible from the dashboard.
 *
 * Safe by default: prints a dry-run report and writes NOTHING unless --apply is
 * passed. Idempotent: rows already flagged do_not_contact are skipped.
 *
 * Usage:
 *   npx tsx scripts/scrub-wa-portal-participants.ts [--artifact path] [--manual path]            # dry run
 *   npx tsx scripts/scrub-wa-portal-participants.ts [--artifact path] [--manual path] --apply    # write
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_ARTIFACT_PATH = `${process.env.HOME}/imxp/pat-profile-cloud/reports/whatsapp-portal-participants.json`;
const DEFAULT_MANUAL_PATH = `${__dirname}/wa-portal-manual-confirmations.json`;

interface PortalMatch {
  stable_id: string;
  display_name: string | null;
  phone: string | null;
  tier: string | null;
  portal_emails: string[];
  admission_basis: string[];
}

interface Artifact {
  generated_at: string;
  source_snapshot_generated_at?: string | null;
  members: PortalMatch[];
}

interface ManualConfirmation {
  stable_id: string;
  phone?: string | null;
  reason: string;
}

function flagValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const APPLY = process.argv.includes('--apply');
const artifactPath = flagValue('--artifact') || DEFAULT_ARTIFACT_PATH;
const manualPath = flagValue('--manual') || DEFAULT_MANUAL_PATH;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Target {
  stable_id: string;
  /** human-readable basis appended to the note */
  noteReason: string;
  /** structured metadata for the activity log */
  metadata: Record<string, unknown>;
}

function loadTargets(): Target[] {
  const targets = new Map<string, Target>();

  const artifact: Artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  for (const m of artifact.members) {
    targets.set(m.stable_id, {
      stable_id: m.stable_id,
      noteReason: `confirmed Portal participant (${m.portal_emails.join(
        ', '
      )}; admission: ${m.admission_basis.join('+')}; matched via CustomerIO phone→email)`,
      metadata: {
        source: 'portal_match_artifact',
        portal_emails: m.portal_emails,
        admission_basis: m.admission_basis,
        artifact_generated_at: artifact.generated_at,
      },
    });
  }
  console.log(
    `Artifact ${artifact.generated_at}: ${artifact.members.length} data-matched Portal participants.`
  );

  if (existsSync(manualPath)) {
    const manual: { confirmations?: ManualConfirmation[] } = JSON.parse(
      readFileSync(manualPath, 'utf8')
    );
    const confirmations = manual.confirmations ?? [];
    for (const c of confirmations) {
      // A manual confirmation never overrides a richer data match.
      if (targets.has(c.stable_id)) continue;
      targets.set(c.stable_id, {
        stable_id: c.stable_id,
        noteReason: `confirmed Portal participant by direct conversation — ${c.reason}`,
        metadata: { source: 'manual_confirmation', phone: c.phone ?? null },
      });
    }
    console.log(`Manual confirmations: ${confirmations.length}.`);
  } else {
    console.log(`Manual confirmations: none (${manualPath} not found).`);
  }

  return [...targets.values()];
}

async function main() {
  const targets = loadTargets();
  const targetById = new Map(targets.map((t) => [t.stable_id, t]));

  const { data: contacts, error } = await supabase
    .from('whatsapp_contacts')
    .select('contact_key, stable_id, display_name, tier, status, do_not_contact, notes')
    .eq('cohort', 'non_buyer');
  if (error) {
    console.error('Failed to read whatsapp_contacts:', error.message);
    process.exit(1);
  }

  const onList = (contacts ?? []).filter((c) => targetById.has(c.stable_id));
  const toFlag = onList.filter((c) => !c.do_not_contact);
  const alreadyFlagged = onList.filter((c) => c.do_not_contact);
  const alreadyActioned = toFlag.filter((c) => c.status !== 'uncontacted');
  const notOnList = targets.filter(
    (t) => !(contacts ?? []).some((c) => c.stable_id === t.stable_id)
  );

  console.log(
    `\nLive non_buyer rows: ${contacts?.length ?? 0} | confirmed Portal participants on list: ${onList.length} | to flag: ${toFlag.length} | already flagged (skip): ${alreadyFlagged.length}`
  );

  console.log('\n=== Contacts to flag do_not_contact ===');
  for (const c of toFlag) {
    const t = targetById.get(c.stable_id)!;
    const warn = c.status !== 'uncontacted' ? `  ⚠️  status=${c.status}` : '';
    console.log(`  ${c.stable_id} | ${c.display_name} | tier ${c.tier} | ${t.noteReason}${warn}`);
  }

  if (alreadyActioned.length) {
    console.log(
      `\n⚠️  ${alreadyActioned.length} of these were ALREADY contacted/responded/converted — review for follow-up:`
    );
    for (const c of alreadyActioned) {
      console.log(`     ${c.display_name} (status=${c.status})`);
    }
  }

  if (notOnList.length) {
    console.log(
      `\nℹ️  ${notOnList.length} confirmed participant(s) not on the live non_buyer list (already excluded or never imported): ${notOnList
        .map((t) => t.stable_id)
        .join(', ')}`
    );
  }

  if (!APPLY) {
    console.log('\n[dry-run] No changes written. Re-run with --apply to flag these rows.');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let flagged = 0;
  for (const c of toFlag) {
    const t = targetById.get(c.stable_id)!;
    const note = [
      c.notes?.trim() || null,
      `[auto ${today}] Originally added to the non-buyer list by mistake — ${t.noteReason}. Already has Festival admission via the Portal; excluded from outreach.`,
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
      action: 'auto_flagged_portal_participant',
      actor: 'pipeline',
      metadata: { ...t.metadata, prior_status: c.status },
    });
    flagged += 1;
    console.log(`  flagged ${c.display_name}`);
  }

  console.log(`\nDone. Flagged ${flagged}/${toFlag.length} contacts do_not_contact.`);
}

main();
