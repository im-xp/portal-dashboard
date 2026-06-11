/**
 * One-shot import of the WhatsApp non-buyer snapshot into Supabase
 * (whatsapp_contacts, cohort 'non_buyer').
 *
 * Source: the pat-profile-cloud pipeline snapshot, locally available at
 * affinity-mvp/portal-viz/public/data/wa-non-buyers.json (or pass a path).
 * Imports Tier A + C only; BUYER/EXCLUDED rows are skipped.
 *
 * Idempotent: upserts on contact_key and never touches outreach state
 * (status/notes/assigned_to/do_not_contact) on re-import, so it is safe
 * to refresh the roster after Deja has started marking people.
 *
 * Usage: npx tsx scripts/import-wa-non-buyers.ts [path-to-snapshot.json]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_SNAPSHOT_PATH = `${process.env.HOME}/imxp/affinity-mvp/portal-viz/public/data/wa-non-buyers.json`;

interface SnapshotMember {
  stable_id: string;
  normalized_display: string;
  display_aliases: string[];
  phones_seen: string[];
  tier: 'BUYER' | 'A' | 'C' | 'EXCLUDED';
  groups: string[];
  message_count: number;
  first_seen: string | null;
  last_seen: string | null;
  still_in_group: boolean;
  rank: number | null;
}

interface Snapshot {
  generated_at: string;
  pipeline_version?: string;
  members: SnapshotMember[];
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UPSERT_BATCH = 100;

async function main() {
  const snapshotPath = process.argv[2] || DEFAULT_SNAPSHOT_PATH;
  const snapshot: Snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));

  const importable = snapshot.members.filter(
    (m) => m.tier === 'A' || m.tier === 'C'
  );
  console.log(
    `Snapshot ${snapshot.generated_at}: ${snapshot.members.length} members, importing ${importable.length} (Tier A+C)`
  );

  const rows = importable.map((m) => ({
    contact_key: `non_buyer:${m.stable_id}`,
    cohort: 'non_buyer',
    stable_id: m.stable_id,
    phone: m.phones_seen[0] ?? null,
    display_name: m.display_aliases[0] ?? m.normalized_display,
    tier: m.tier,
    groups: m.groups,
    message_count: m.message_count,
    first_seen: m.first_seen,
    last_seen: m.last_seen,
    still_in_group: m.still_in_group,
    rank: m.rank,
    metadata: {
      display_aliases: m.display_aliases,
      phones_seen: m.phones_seen,
      snapshot_generated_at: snapshot.generated_at,
      pipeline_version: snapshot.pipeline_version ?? null,
    },
    updated_at: new Date().toISOString(),
  }));

  let imported = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase
      .from('whatsapp_contacts')
      .upsert(batch, { onConflict: 'contact_key' });
    if (error) {
      console.error(`Batch ${i / UPSERT_BATCH + 1} failed:`, error.message);
      process.exit(1);
    }
    imported += batch.length;
    console.log(`Upserted ${imported}/${rows.length}`);
  }

  const { count } = await supabase
    .from('whatsapp_contacts')
    .select('*', { count: 'exact', head: true })
    .eq('cohort', 'non_buyer');
  console.log(`Done. whatsapp_contacts now has ${count} non_buyer rows.`);
}

main();
