-- Add AI summary column to email_tickets
ALTER TABLE email_tickets ADD COLUMN IF NOT EXISTS summary TEXT;



