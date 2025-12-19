-- Email Queue Schema
-- Created: 2024-12-18

-- =============================================================================
-- email_messages: Store every Gmail message for deduplication and attribution
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_messages (
    gmail_message_id TEXT PRIMARY KEY,
    gmail_thread_id TEXT NOT NULL,
    from_email TEXT NOT NULL,
    to_emails JSONB DEFAULT '[]'::jsonb,
    cc_emails JSONB DEFAULT '[]'::jsonb,
    subject TEXT,
    snippet TEXT,
    internal_ts TIMESTAMPTZ NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    is_noise BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for sync queries (find messages by thread)
CREATE INDEX IF NOT EXISTS idx_email_messages_thread_id ON email_messages(gmail_thread_id);

-- Index for finding recent messages
CREATE INDEX IF NOT EXISTS idx_email_messages_internal_ts ON email_messages(internal_ts DESC);


-- =============================================================================
-- email_tickets: One ticket per (thread + customer) combination
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_tickets (
    ticket_key TEXT PRIMARY KEY,  -- hash(gmail_thread_id + customer_email)
    gmail_thread_id TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    subject TEXT,
    last_inbound_ts TIMESTAMPTZ,
    last_outbound_ts TIMESTAMPTZ,
    needs_response BOOLEAN GENERATED ALWAYS AS (
        last_inbound_ts IS NOT NULL AND (
            last_outbound_ts IS NULL OR 
            last_outbound_ts < last_inbound_ts
        )
    ) STORED,
    claimed_by TEXT,  -- email of person who claimed
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for queue view (needs response, sorted by age)
CREATE INDEX IF NOT EXISTS idx_email_tickets_queue 
ON email_tickets(needs_response, last_inbound_ts ASC) 
WHERE needs_response = TRUE;

-- Index for finding tickets by thread
CREATE INDEX IF NOT EXISTS idx_email_tickets_thread_id ON email_tickets(gmail_thread_id);

-- Index for finding tickets by customer
CREATE INDEX IF NOT EXISTS idx_email_tickets_customer ON email_tickets(customer_email);


-- =============================================================================
-- sync_state: Track Gmail sync progress
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_sync_state (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton row
    last_history_id TEXT,
    last_sync_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial sync state
INSERT INTO email_sync_state (id) VALUES (1) ON CONFLICT DO NOTHING;


-- =============================================================================
-- Function to auto-update updated_at timestamp
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for email_tickets
DROP TRIGGER IF EXISTS update_email_tickets_updated_at ON email_tickets;
CREATE TRIGGER update_email_tickets_updated_at
    BEFORE UPDATE ON email_tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for email_sync_state
DROP TRIGGER IF EXISTS update_email_sync_state_updated_at ON email_sync_state;
CREATE TRIGGER update_email_sync_state_updated_at
    BEFORE UPDATE ON email_sync_state
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

