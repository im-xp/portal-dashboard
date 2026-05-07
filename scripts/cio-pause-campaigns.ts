/**
 * Phase 2 pre-flight / post-flight: pause or resume CIO campaigns 1 and 2.
 *
 * Plan: context/plans/fever-cleanup-replay-enrichment.md (Phase 2).
 *
 * Targets (per plan):
 *   1 — Post Purchase Campaign (event-triggered on Order Completed) — pause
 *   2 — Abandoned Browse (seg_attr) — pause
 *   4 — Utility Workflow (Move Phone Number Property) — DO NOT TOUCH
 *
 * Read-modify-write protocol:
 *   1. GET /v1/campaigns/:id — capture current state
 *   2. If state already at desired value → log no-op, skip PUT
 *   3. PUT /v1/campaigns/:id with { state: <target> }
 *   4. GET again — assert state == target. Hard fail otherwise.
 *
 * Modes:
 *   default              dry-run (prints what it would PUT)
 *   --execute            actually PUT
 *   --resume             reverse (target state = running instead of draft)
 *   --resume --execute   actually PUT to resume
 *
 * NOTE: PUT /v1/campaigns/:id with { state: "draft" } body is the documented
 * pattern referenced in the plan and the CIO community. The App API has not
 * been verified end-to-end on this endpoint shape from this codebase; the
 * read-after-write GET above is the safety net. If the PUT returns non-2xx
 * the script aborts before touching the next campaign.
 *
 * Auth: ~/.claude/credentials/customerio.json (app_api_key, region us).
 */

import { readFileSync } from 'node:fs';

type Creds = { app_api_key: string; region: string };
const CREDS: Creds = JSON.parse(
  readFileSync(`${process.env.HOME}/.claude/credentials/customerio.json`, 'utf8')
);
const AUTH = `Bearer ${CREDS.app_api_key}`;
const BASE = 'https://api.customer.io/v1';

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const RESUME = args.includes('--resume');
const TARGET_STATE = RESUME ? 'running' : 'draft';
const TARGET_IDS = [1, 2];

async function getCampaign(id: number): Promise<any> {
  const r = await fetch(`${BASE}/campaigns/${id}`, { headers: { Authorization: AUTH } });
  if (!r.ok) throw new Error(`GET campaign ${id} → ${r.status} ${await r.text()}`);
  return (await r.json()).campaign;
}

async function putCampaignState(id: number, state: string): Promise<any> {
  const r = await fetch(`${BASE}/campaigns/${id}`, {
    method: 'PUT',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`PUT campaign ${id} state=${state} → ${r.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  console.log(`=== cio-pause-campaigns ===`);
  console.log(`mode: ${RESUME ? 'RESUME' : 'PAUSE'} (target state = "${TARGET_STATE}")`);
  console.log(`execute: ${EXECUTE}`);
  console.log(`targets: campaigns ${TARGET_IDS.join(', ')}\n`);

  for (const id of TARGET_IDS) {
    const before = await getCampaign(id);
    console.log(`[${id}] "${before.name}" — current state: ${before.state}`);

    if (before.state === TARGET_STATE) {
      console.log(`     no-op (already ${TARGET_STATE})`);
      continue;
    }

    if (!EXECUTE) {
      console.log(`     would PUT { state: "${TARGET_STATE}" }`);
      continue;
    }

    console.log(`     PUT { state: "${TARGET_STATE}" } ...`);
    await putCampaignState(id, TARGET_STATE);

    const after = await getCampaign(id);
    if (after.state !== TARGET_STATE) {
      throw new Error(`[${id}] read-after-write mismatch: expected ${TARGET_STATE}, got ${after.state}`);
    }
    console.log(`     ✓ confirmed state=${after.state}`);
  }

  console.log(`\nDone.${EXECUTE ? '' : ' (dry-run; pass --execute to apply)'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
