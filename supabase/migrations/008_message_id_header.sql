-- Add RFC 2822 Message-ID header to email_messages
-- This enables proper email threading via In-Reply-To and References headers

ALTER TABLE email_messages
ADD COLUMN IF NOT EXISTS message_id TEXT;

-- Index for looking up messages by their Message-ID (for threading)
CREATE INDEX IF NOT EXISTS idx_email_messages_message_id ON email_messages(message_id);
