-- Rename status values for clarity
-- awaiting_response -> awaiting_team_response (we need to reply)
-- awaiting_customer -> awaiting_customer_response (customer needs to reply)

-- Drop old constraint FIRST
ALTER TABLE email_tickets DROP CONSTRAINT IF EXISTS email_tickets_status_check;

-- Update existing values
UPDATE email_tickets SET status = 'awaiting_team_response' WHERE status = 'awaiting_response';
UPDATE email_tickets SET status = 'awaiting_customer_response' WHERE status = 'awaiting_customer';

-- Add new constraint
ALTER TABLE email_tickets ADD CONSTRAINT email_tickets_status_check
  CHECK (status IN ('awaiting_team_response', 'awaiting_customer_response', 'resolved'));

-- Update default
ALTER TABLE email_tickets ALTER COLUMN status SET DEFAULT 'awaiting_team_response';
