/**
 * Retroactively scrub WhatsApp non-buyer contacts who the pipeline now
 * recognises as actual Fever buyers (e.g. via the CustomerIO phone->email
 * bridge added in bout2). These rows were imported as Tier A/C before the
 * matcher could see them, so they are sitting on Deja's outreach list by
 * mistake. The import is upsert-only and never deletes, so it cannot retract
 * them on its own — hence this script.
 *
 * For each affected contact we set do_not_contact = true (which the /whatsapp
 * UI uses to hide the send + advance-status buttons and drop the row from the
 * Tier-A stats), append an explanatory note, and log a whatsapp_activity row.
 * We DO NOT delete: Deja's history (status/notes/contacted_at) is preserved,
 * and the flag is reversible from the dashboard.
 *
 * Source of truth for "who is now a buyer" is the fresh pipeline snapshot
 * (whatsapp-non-buyers.json), tier === 'BUYER'. The set intersection with the
 * live non_buyer rows is self-correcting: it only touches rows that are both
 * on the list AND reclassified, regardless of count.
 *
 * Safe by default: prints a dry-run report and writes NOTHING unless --apply
 * is passed. Idempotent: rows already flagged do_not_contact are skipped.
 *
 * Usage:
 *   npx tsx scripts/scrub-wa-reclassified-buyers.ts [path-to-snapshot.json]            # dry run
 *   npx tsx scripts/scrub-wa-reclassified-buyers.ts [path-to-snapshot.json] --apply    # write
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_SNAPSHOT_PATH = `${process.env.HOME}/imxp/affinity-mvp/portal-viz/public/data/wa-non-buyers.json`;

interface SnapshotMember {
  stable_id: string;
  tier: 'BUYER' | 'A' | 'C' | 'EXCLUDED';
  matched_email: string | null;
  match_confidence: string | null;
  normalized_display: string | null;
}

interface Snapshot {
  generated_at: string;
  members: SnapshotMember[];
}

const APPLY = process.argv.includes('--apply');
const snapshotPath =
  process.argv.slice(2).find((arg) => !arg.startsWith('--')) || DEFAULT_SNAPSHOT_PATH;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const snapshot: Snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const buyersById = new Map<string, SnapshotMember>();
  for (const m of snapshot.members) {
    if (m.tier === 'BUYER') buyersById.set(m.stable_id, m);
  }
  console.log(
    `Snapshot ${snapshot.generated_at}: ${buyersById.size} members now classified BUYER.`
  );

  // Pull the live outreach list (cohort non_buyer == everything imported as A/C).
  const { data: contacts, error } = await supabase
    .from('whatsapp_contacts')
    .select(
      'contact_key, stable_id, display_name, tier, status, do_not_contact, notes'
    )
    .eq('cohort', 'non_buyer');
  if (error) {
    console.error('Failed to read whatsapp_contacts:', error.message);
    process.exit(1);
  }

  const affected = (contacts ?? []).filter((c) => buyersById.has(c.stable_id));
  const toFlag = affected.filter((c) => !c.do_not_contact);
  const alreadyFlagged = affected.filter((c) => c.do_not_contact);
  const alreadyActioned = toFlag.filter((c) => c.status !== 'uncontacted');

  console.log(
    `\nLive non_buyer rows: ${contacts?.length ?? 0} | reclassified-as-buyer on list: ${affected.length} | to flag: ${toFlag.length} | already flagged (skip): ${alreadyFlagged.length}`
  );

  console.log('\n=== Contacts to flag do_not_contact ===');
  for (const c of toFlag) {
    const m = buyersById.get(c.stable_id)!;
    const flag = c.status !== 'uncontacted' ? `  ⚠️  status=${c.status}` : '';
    console.log(
      `  ${c.stable_id} | ${c.display_name} | tier ${c.tier} | buyer=${m.matched_email} (${m.match_confidence})${flag}`
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
    const m = buyersById.get(c.stable_id)!;
    const note = [
      c.notes?.trim() || null,
      `[auto ${today}] Originally added to the non-buyer list by mistake — confirmed Fever buyer (${m.matched_email}, matched via ${m.match_confidence}). Excluded from outreach.`,
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
      action: 'auto_flagged_reclassified_buyer',
      actor: 'pipeline',
      metadata: {
        matched_email: m.matched_email,
        match_confidence: m.match_confidence,
        snapshot_generated_at: snapshot.generated_at,
        prior_status: c.status,
      },
    });
    flagged += 1;
    console.log(`  flagged ${c.display_name} (${m.matched_email})`);
  }

  console.log(`\nDone. Flagged ${flagged}/${toFlag.length} contacts do_not_contact.`);
}

main();
