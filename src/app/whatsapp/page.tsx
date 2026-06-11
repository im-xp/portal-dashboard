'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  MessageCircle,
  Loader2,
  XCircle,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Ban,
  RotateCcw,
  Users,
  Send,
  Reply,
  PartyPopper,
} from 'lucide-react';
import {
  waMeLink,
  type WhatsAppContact,
  type WhatsAppStatus,
} from '@/lib/whatsapp';

type TierFilter = 'A' | 'C' | 'all';
type StatusFilter = WhatsAppStatus | 'all' | 'do_not_contact';

const statusBadgeClasses: Record<WhatsAppStatus, string> = {
  uncontacted: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  contacted: 'bg-blue-50 text-blue-700 border-blue-200',
  responded: 'bg-amber-50 text-amber-700 border-amber-200',
  converted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const nextStatus: Partial<Record<WhatsAppStatus, WhatsAppStatus>> = {
  uncontacted: 'contacted',
  contacted: 'responded',
  responded: 'converted',
};

const prevStatus: Partial<Record<WhatsAppStatus, WhatsAppStatus>> = {
  contacted: 'uncontacted',
  responded: 'contacted',
  converted: 'responded',
};

const nextStatusLabel: Partial<Record<WhatsAppStatus, string>> = {
  uncontacted: 'Mark Contacted',
  contacted: 'Mark Responded',
  responded: 'Mark Converted',
};

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export default function WhatsAppPage() {
  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<TierFilter>('A');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchContacts = useCallback(async () => {
    try {
      const response = await fetch('/api/whatsapp/contacts');
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setContacts(data.contacts || []);
        setError(null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const postUpdate = async (
    contactKey: string,
    payload: Record<string, unknown>
  ) => {
    setSavingKey(contactKey);
    try {
      const response = await fetch('/api/whatsapp/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_key: contactKey, ...payload }),
      });
      const data = await response.json();
      if (data.success) {
        setContacts((prev) =>
          prev.map((c) => (c.contact_key === contactKey ? data.contact : c))
        );
        setError(null);
      } else {
        setError(data.message || data.error || 'Update failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingKey(null);
    }
  };

  const copyPhone = async (contact: WhatsAppContact) => {
    if (!contact.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedKey(contact.contact_key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const toggleExpanded = (contact: WhatsAppContact) => {
    if (expandedKey === contact.contact_key) {
      setExpandedKey(null);
    } else {
      setExpandedKey(contact.contact_key);
      setNoteDraft(contact.notes || '');
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (tierFilter !== 'all' && c.tier !== tierFilter) return false;
      if (statusFilter === 'do_not_contact') {
        if (!c.do_not_contact) return false;
      } else if (statusFilter !== 'all') {
        if (c.status !== statusFilter || c.do_not_contact) return false;
      }
      if (term) {
        const haystack = `${c.display_name} ${c.phone ?? ''} ${c.groups.join(' ')}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [contacts, tierFilter, statusFilter, search]);

  const stats = useMemo(() => {
    const tierA = contacts.filter((c) => c.tier === 'A' && !c.do_not_contact);
    return {
      total: tierA.length,
      contacted: tierA.filter((c) => c.status !== 'uncontacted').length,
      responded: tierA.filter(
        (c) => c.status === 'responded' || c.status === 'converted'
      ).length,
      converted: tierA.filter((c) => c.status === 'converted').length,
    };
  }, [contacts]);

  const exportCsv = () => {
    const header = [
      'name',
      'phone',
      'tier',
      'groups',
      'messages',
      'last_seen',
      'status',
      'do_not_contact',
      'notes',
    ];
    const escape = (value: unknown) => {
      let s = String(value ?? '');
      // display names come from WhatsApp users — neutralize formula injection
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [
      header.join(','),
      ...filtered.map((c) =>
        [
          c.display_name,
          c.phone,
          c.tier,
          c.groups.join('; '),
          c.message_count,
          c.last_seen,
          c.status,
          c.do_not_contact,
          c.notes,
        ]
          .map(escape)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wa-non-buyers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col">
      <Header
        title="WhatsApp Outreach"
        description="Community members without a Fever ticket — manual outreach tracker"
      />

      <div className="p-4 md:p-8">
        <div className="mb-6 rounded-lg bg-blue-50 border border-blue-200 p-4 space-y-1">
          <p className="text-sm text-blue-800">
            <strong>Workflow:</strong> Open someone in WhatsApp (or copy their
            number), send your message from your own phone, then click{' '}
            <strong>Mark Contacted</strong>. When they reply, mark Responded;
            if they buy a ticket, mark Converted.
          </p>
          <p className="text-sm text-blue-700">
            This is an event-derived outreach list, not a full membership
            roster — people who joined the groups but never messaged are not
            on it. Tier C members have no phone on file (nickname only).
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-4 flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
            <p className="text-sm text-red-700 flex-1">{error}</p>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Tier A list', value: stats.total, icon: Users, color: 'text-zinc-400' },
            { label: 'Contacted', value: stats.contacted, icon: Send, color: 'text-blue-500' },
            { label: 'Responded', value: stats.responded, icon: Reply, color: 'text-amber-500' },
            { label: 'Converted', value: stats.converted, icon: PartyPopper, color: 'text-emerald-500' },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <stat.icon className={cn('h-5 w-5', stat.color)} />
                  <div>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-sm text-zinc-500">{stat.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5">
              {(['A', 'C', 'all'] as const).map((t) => (
                <Button
                  key={t}
                  variant={tierFilter === t ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTierFilter(t)}
                >
                  {t === 'all' ? 'All tiers' : `Tier ${t}`}
                </Button>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(
                [
                  'all',
                  'uncontacted',
                  'contacted',
                  'responded',
                  'converted',
                  'do_not_contact',
                ] as const
              ).map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? 'default' : 'outline'}
                  size="sm"
                  className="capitalize text-xs"
                  onClick={() => setStatusFilter(s)}
                >
                  {s === 'do_not_contact' ? 'Do not contact' : s}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, group..."
              className="w-56"
            />
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                <MessageCircle className="h-12 w-12 mx-auto mb-4 text-zinc-300" />
                <p className="text-lg font-medium">No contacts found</p>
                <p className="text-sm">
                  {contacts.length === 0
                    ? 'The non-buyer list has not been imported yet — run scripts/import-wa-non-buyers.ts.'
                    : 'No contacts match this filter.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((contact) => {
                  const isExpanded = expandedKey === contact.contact_key;
                  const isSaving = savingKey === contact.contact_key;
                  const advance = nextStatus[contact.status];
                  return (
                    <div
                      key={contact.contact_key}
                      className={cn(
                        'p-4 rounded-lg border transition-colors',
                        contact.do_not_contact
                          ? 'bg-zinc-50 border-zinc-200 opacity-60'
                          : 'hover:bg-zinc-50'
                      )}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">
                              {contact.display_name}
                            </p>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-xs capitalize',
                                statusBadgeClasses[contact.status]
                              )}
                            >
                              {contact.status}
                            </Badge>
                            {contact.do_not_contact && (
                              <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                                Do not contact
                              </Badge>
                            )}
                            {!contact.still_in_group && (
                              <Badge variant="outline" className="text-xs bg-zinc-100 text-zinc-500">
                                Left group
                              </Badge>
                            )}
                            {contact.notes && (
                              <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                Note
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-zinc-400">
                            {contact.phone && (
                              <button
                                onClick={() => copyPhone(contact)}
                                className="flex items-center gap-1 font-mono text-zinc-600 hover:text-zinc-900"
                                title="Copy number"
                              >
                                {contact.phone}
                                {copiedKey === contact.contact_key ? (
                                  <Check className="h-3 w-3 text-emerald-500" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            )}
                            <span>{contact.groups.join(', ')}</span>
                            <span>{contact.message_count} msgs</span>
                            <span>last seen {formatDate(contact.last_seen)}</span>
                            {contact.contacted_at && (
                              <span className="text-blue-600">
                                contacted {formatDate(contact.contacted_at)}
                                {contact.contacted_by
                                  ? ` by ${contact.contacted_by.split('@')[0]}`
                                  : ''}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {contact.phone && !contact.do_not_contact && (
                            <a
                              href={waMeLink(contact.phone)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 h-8 px-3"
                            >
                              <MessageCircle className="h-4 w-4 mr-1" />
                              WhatsApp
                            </a>
                          )}
                          {advance && !contact.do_not_contact && (
                            <Button
                              variant="default"
                              size="sm"
                              className="text-xs h-8"
                              disabled={isSaving}
                              onClick={() =>
                                postUpdate(contact.contact_key, {
                                  action: 'status',
                                  status: advance,
                                })
                              }
                            >
                              {isSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                nextStatusLabel[contact.status]
                              )}
                            </Button>
                          )}
                          {prevStatus[contact.status] && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-8 text-zinc-400"
                              title={`Undo back to ${prevStatus[contact.status]}`}
                              disabled={isSaving}
                              onClick={() =>
                                postUpdate(contact.contact_key, {
                                  action: 'status',
                                  status: prevStatus[contact.status],
                                  override: true,
                                })
                              }
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-8"
                            title={
                              contact.do_not_contact
                                ? 'Allow contacting again'
                                : 'Mark do-not-contact (teammate, opted out, etc.)'
                            }
                            disabled={isSaving}
                            onClick={() =>
                              postUpdate(contact.contact_key, {
                                action: 'do_not_contact',
                                do_not_contact: !contact.do_not_contact,
                              })
                            }
                          >
                            <Ban className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-8"
                            onClick={() => toggleExpanded(contact)}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-zinc-200">
                          <label className="text-xs font-medium text-zinc-500">
                            Notes
                          </label>
                          <textarea
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                            rows={3}
                            placeholder="e.g. said she's deciding next week, follow up Friday"
                            className="mt-1 w-full rounded-md border border-zinc-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
                          />
                          <div className="mt-2 flex justify-end">
                            <Button
                              size="sm"
                              disabled={isSaving}
                              onClick={() =>
                                postUpdate(contact.contact_key, {
                                  action: 'notes',
                                  notes: noteDraft,
                                })
                              }
                            >
                              {isSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                'Save note'
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
