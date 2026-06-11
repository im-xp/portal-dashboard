-- WhatsApp outreach CRM (manual flow — WABA locked, Deja sends from her phone)
-- Cohort discriminator kept so work-exchange can share this table later.

CREATE TABLE whatsapp_contacts (
  contact_key TEXT PRIMARY KEY,           -- '<cohort>:<stable_id>'
  cohort TEXT NOT NULL DEFAULT 'non_buyer',
  stable_id TEXT NOT NULL,                -- pipeline identity (survives re-imports)
  phone TEXT,                             -- E.164, null for nickname-only (Tier C)
  display_name TEXT NOT NULL,
  tier TEXT,                              -- A | C (BUYER/EXCLUDED not imported)
  groups JSONB NOT NULL DEFAULT '[]',
  message_count INTEGER NOT NULL DEFAULT 0,
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  still_in_group BOOLEAN NOT NULL DEFAULT true,
  rank INTEGER,                           -- engagement rank within tier, from pipeline

  -- Outreach state (monotonic ladder, enforced in API)
  status TEXT NOT NULL DEFAULT 'uncontacted'
    CHECK (status IN ('uncontacted', 'contacted', 'responded', 'converted')),
  contacted_by TEXT,
  contacted_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  do_not_contact BOOLEAN NOT NULL DEFAULT false,
  assigned_to TEXT,
  notes TEXT,

  metadata JSONB NOT NULL DEFAULT '{}',   -- snapshot extras (aliases, last_event, import info)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_contacts_cohort_tier ON whatsapp_contacts(cohort, tier);
CREATE INDEX idx_whatsapp_contacts_status ON whatsapp_contacts(status);
CREATE INDEX idx_whatsapp_contacts_phone ON whatsapp_contacts(phone);

-- Action log, mirrors ticket_activity
CREATE TABLE whatsapp_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_key TEXT NOT NULL REFERENCES whatsapp_contacts(contact_key) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_activity_contact ON whatsapp_activity(contact_key, created_at DESC);

-- PII tables: no PostgREST access for anon/authenticated. The app reads and
-- writes only via the service role, which bypasses RLS.
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON whatsapp_contacts FROM anon, authenticated;
REVOKE ALL ON whatsapp_activity FROM anon, authenticated;
