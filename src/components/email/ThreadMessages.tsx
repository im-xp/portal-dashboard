'use client';

import { useState, useEffect } from 'react';
import { Loader2, Mail, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ThreadMessage {
  gmail_message_id: string;
  gmail_thread_id: string;
  from_email: string;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  body: string | null;
  snippet: string | null;
  internal_ts: string;
  direction: 'inbound' | 'outbound';
}

interface ThreadMessagesProps {
  ticketKey: string;
  onThreadLoaded?: (messages: ThreadMessage[]) => void;
}

export function ThreadMessages({ ticketKey, onThreadLoaded }: ThreadMessagesProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMessages = async () => {
      try {
        const response = await fetch(`/api/email/thread?ticket_key=${ticketKey}`);
        const data = await response.json();
        const msgs = data.messages || [];
        setMessages(msgs);
        onThreadLoaded?.(msgs);
      } catch (error) {
        console.error('Failed to fetch thread messages:', error);
      } finally {
        setLoading(false);
      }
    };
    loadMessages();
  }, [ticketKey, onThreadLoaded]);

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatSender = (email: string) => {
    return email.split('@')[0];
  };

  const decodeHtmlEntities = (text: string) => {
    return text
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  };

  const stripQuotedContent = (text: string): string => {
    const lines = text.split('\n');
    const resultLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Gmail/standard quote marker start: "On [day], [month] [date]..."
      // These often wrap across lines, so detect the start pattern
      if (/^On\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d)/i.test(trimmed)) {
        // Look ahead to see if "wrote:" appears within next few lines
        const lookAhead = lines.slice(i, i + 4).join(' ');
        if (/wrote:\s*$/i.test(lookAhead) || /> wrote:/i.test(lookAhead)) {
          break;
        }
      }

      // Line ends with "wrote:" (catches wrapped Gmail quotes)
      if (/>\s*wrote:\s*$/i.test(trimmed)) {
        break;
      }

      // Outlook style: "-----Original Message-----" or "---------- Forwarded message ---------"
      if (/^-{3,}\s*(Original Message|Forwarded message)/i.test(trimmed)) {
        break;
      }

      // Block of consecutive quoted lines (3+ lines starting with >)
      if (trimmed.startsWith('>')) {
        let quoteCount = 0;
        for (let j = i; j < lines.length && j < i + 5; j++) {
          if (lines[j].trim().startsWith('>')) quoteCount++;
        }
        if (quoteCount >= 3) {
          break;
        }
      }

      resultLines.push(line);
    }

    return resultLines.join('\n').trim();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="text-sm text-zinc-400 py-4 text-center">
        No messages in this thread
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
        <Mail className="h-4 w-4" />
        Conversation ({messages.length} messages)
      </div>

      <div className="space-y-3 max-h-64 md:max-h-96 overflow-y-auto pr-2">
        {messages.map((msg) => {
          const isInbound = msg.direction === 'inbound';

          return (
            <div
              key={msg.gmail_message_id}
              className={cn(
                "flex flex-col gap-1 max-w-[85%]",
                isInbound ? "items-start" : "items-end ml-auto"
              )}
            >
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                {isInbound ? (
                  <ArrowDownLeft className="h-3 w-3 text-zinc-400" />
                ) : (
                  <ArrowUpRight className="h-3 w-3 text-blue-400" />
                )}
                <span className="font-medium">
                  {formatSender(msg.from_email)}
                </span>
                <span className="text-zinc-400">
                  {formatTime(msg.internal_ts)}
                </span>
              </div>

              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-sm",
                  isInbound
                    ? "bg-zinc-100 text-zinc-700"
                    : "bg-blue-50 text-zinc-700 border border-blue-100"
                )}
              >
                {msg.body ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {stripQuotedContent(decodeHtmlEntities(msg.body))}
                  </pre>
                ) : (
                  <span className="text-zinc-400 italic">
                    {msg.snippet ? decodeHtmlEntities(msg.snippet) : '(No content)'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
