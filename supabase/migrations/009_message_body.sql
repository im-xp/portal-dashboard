-- Add body column to store full email content
ALTER TABLE email_messages ADD COLUMN body TEXT;

COMMENT ON COLUMN email_messages.body IS 'Plain text email body extracted during sync';
