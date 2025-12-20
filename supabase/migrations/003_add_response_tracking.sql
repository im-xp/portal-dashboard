-- Add response tracking columns
-- Created: 2024-12-20

-- Track who manually marked a ticket as responded (vs auto-detected from Gmail sync)
ALTER TABLE email_tickets ADD COLUMN IF NOT EXISTS responded_by TEXT;
ALTER TABLE email_tickets ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

-- Track conversation state for better visibility
-- 'awaiting_response' - customer sent email, waiting for team
-- 'awaiting_customer' - team responded, waiting for customer  
-- 'resolved' - manually marked as resolved (no further action needed)
ALTER TABLE email_tickets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'awaiting_response' 
    CHECK (status IN ('awaiting_response', 'awaiting_customer', 'resolved'));

-- Track if this is a follow-up (customer responded to our response)
-- This helps distinguish new tickets from reopened conversations
ALTER TABLE email_tickets ADD COLUMN IF NOT EXISTS is_followup BOOLEAN DEFAULT FALSE;

-- Count of back-and-forth exchanges in this conversation
ALTER TABLE email_tickets ADD COLUMN IF NOT EXISTS response_count INTEGER DEFAULT 0;

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_email_tickets_status ON email_tickets(status);

-- Index for filtering follow-ups
CREATE INDEX IF NOT EXISTS idx_email_tickets_followup ON email_tickets(is_followup) WHERE is_followup = TRUE;

