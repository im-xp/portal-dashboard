'use client';

import { useState, useEffect } from 'react';
import {
  Loader2,
  UserPlus,
  UserMinus,
  Send,
  RotateCcw,
  MessageSquare,
  Plus,
  History
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Activity {
  id: string;
  ticket_key: string;
  action: 'created' | 'claimed' | 'unclaimed' | 'responded' | 'reopened' | 'customer_replied';
  actor: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface TicketActivityProps {
  ticketKey: string;
}

const ACTION_CONFIG: Record<Activity['action'], { icon: typeof UserPlus; label: string; color: string }> = {
  created: { icon: Plus, label: 'Ticket created', color: 'text-emerald-600' },
  claimed: { icon: UserPlus, label: 'Claimed by', color: 'text-blue-600' },
  unclaimed: { icon: UserMinus, label: 'Unclaimed by', color: 'text-zinc-500' },
  responded: { icon: Send, label: 'Responded by', color: 'text-emerald-600' },
  reopened: { icon: RotateCcw, label: 'Reopened by', color: 'text-amber-600' },
  customer_replied: { icon: MessageSquare, label: 'Customer replied', color: 'text-purple-600' },
};

export function TicketActivity({ ticketKey }: TicketActivityProps) {
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadActivity = async () => {
      try {
        const response = await fetch(`/api/email/activity?ticket_key=${ticketKey}`);
        const data = await response.json();
        setActivity(data.activity || []);
      } catch (error) {
        console.error('Failed to fetch activity:', error);
      } finally {
        setLoading(false);
      }
    };
    loadActivity();
  }, [ticketKey]);

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatActor = (actor: string | null, action: Activity['action']) => {
    if (!actor) return '';
    if (action === 'customer_replied' || action === 'created') {
      return actor;
    }
    return actor.split('@')[0];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <div className="text-sm text-zinc-400 py-2">
        No activity recorded yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
        <History className="h-4 w-4" />
        Activity Timeline
      </div>

      <div className="space-y-1 max-h-48 overflow-y-auto">
        {activity.map((item, index) => {
          const config = ACTION_CONFIG[item.action];
          const Icon = config.icon;

          return (
            <div
              key={item.id}
              className={cn(
                "flex items-start gap-2 py-1.5",
                index !== activity.length - 1 && "border-b border-zinc-100"
              )}
            >
              <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", config.color)} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-600">
                  <span className={cn("font-medium", config.color)}>
                    {config.label}
                  </span>
                  {item.actor && (
                    <span className="text-zinc-700">
                      {' '}{formatActor(item.actor, item.action)}
                    </span>
                  )}
                </p>
                <p className="text-xs text-zinc-400">
                  {formatTime(item.created_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
