'use client';

import { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { HandHeart, FileText, Clock, CheckCircle, XCircle, Search } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { VolunteerDashboardData, VolunteerApplication } from '@/lib/types';

type StatusFilter = 'all' | 'draft' | 'in review' | 'accepted' | 'rejected';

export default function VolunteersPage() {
  const [data, setData] = useState<VolunteerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedApp, setSelectedApp] = useState<VolunteerApplication | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/volunteers');
        if (!res.ok) throw new Error(`API ${res.status}`);
        setData(await res.json());
      } catch (error) {
        console.error('Failed to fetch volunteer data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const filteredApplications = useMemo(() => {
    if (!data) return [];
    let apps = data.applications;

    if (statusFilter !== 'all') {
      apps = apps.filter(a => a.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      apps = apps.filter(a =>
        (a.custom_data?.full_name || '').toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q)
      );
    }

    return [...apps].sort((a, b) => {
      if (a.submitted_at && b.submitted_at) {
        return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
      }
      if (a.submitted_at) return -1;
      if (b.submitted_at) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [data, statusFilter, search]);

  const statusTabs: { label: string; value: StatusFilter; count: number }[] = [
    { label: 'All', value: 'all', count: data?.metrics.total || 0 },
    { label: 'Draft', value: 'draft', count: data?.metrics.drafts || 0 },
    { label: 'In Review', value: 'in review', count: data?.metrics.inReview || 0 },
    { label: 'Approved', value: 'accepted', count: data?.metrics.approved || 0 },
    { label: 'Rejected', value: 'rejected', count: data?.metrics.rejected || 0 },
  ];

  if (loading) {
    return (
      <div className="flex flex-col">
        <Header title="Volunteers" description="Track volunteer applications for Iceland Eclipse" />
        <div className="p-4 md:p-8">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 mb-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-zinc-100 animate-pulse rounded-lg" />
            ))}
          </div>
          <div className="h-96 bg-zinc-100 animate-pulse rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Header title="Volunteers" description="Track volunteer applications for Iceland Eclipse" />

      <div className="p-4 md:p-8">
        {/* Metrics */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 mb-6 md:mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Total</CardTitle>
              <HandHeart className="h-4 w-4 md:h-5 md:w-5 text-zinc-400" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold">{data?.metrics.total || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Drafts</CardTitle>
              <FileText className="h-4 w-4 md:h-5 md:w-5 text-zinc-400" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold text-zinc-600">{data?.metrics.drafts || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">In Review</CardTitle>
              <Clock className="h-4 w-4 md:h-5 md:w-5 text-amber-500" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold text-amber-600">{data?.metrics.inReview || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Approved</CardTitle>
              <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-emerald-500" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold text-emerald-600">{data?.metrics.approved || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex flex-wrap gap-2">
            {statusTabs.map(tab => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                  statusFilter === tab.value
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                )}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
          <div className="relative sm:ml-auto sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input
              placeholder="Search name or email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px] lg:w-[200px]">Name</TableHead>
                  <TableHead className="hidden md:table-cell w-[200px]">Email</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="hidden md:table-cell w-[120px]">Type</TableHead>
                  <TableHead className="hidden lg:table-cell w-[140px]">Phases</TableHead>
                  <TableHead className="hidden lg:table-cell w-[140px]">Teams</TableHead>
                  <TableHead className="hidden md:table-cell w-[110px]">Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredApplications.map(app => (
                  <TableRow
                    key={app.id}
                    className="cursor-pointer hover:bg-zinc-50"
                    onClick={() => setSelectedApp(app)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="hidden md:flex h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-violet-200 to-violet-300 items-center justify-center text-xs font-medium">
                          {getInitials(app.custom_data?.full_name)}
                        </div>
                        <span className="font-medium text-sm truncate">
                          {app.custom_data?.full_name || 'Unnamed'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-zinc-500 text-sm truncate">{app.email}</TableCell>
                    <TableCell>
                      <StatusBadge status={app.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-zinc-600 truncate">
                      {app.custom_data?.volunteer_type || '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <TagList items={app.custom_data?.available_phases} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <TagList items={app.custom_data?.team_preferences} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-zinc-500 text-sm">
                      {app.submitted_at
                        ? formatDistanceToNow(new Date(app.submitted_at), { addSuffix: true })
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredApplications.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-zinc-400 py-8">
                      No volunteer applications found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedApp} onOpenChange={open => !open && setSelectedApp(null)}>
        <SheetContent className="overflow-y-auto">
          {selectedApp && <VolunteerDetail app={selectedApp} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function VolunteerDetail({ app }: { app: VolunteerApplication }) {
  const cd = app.custom_data;

  return (
    <>
      <SheetHeader>
        <SheetTitle>{cd?.full_name || 'Unnamed Volunteer'}</SheetTitle>
        <SheetDescription>{app.email}</SheetDescription>
      </SheetHeader>

      <div className="mt-4 space-y-6">
        <div className="flex items-center gap-2">
          <StatusBadge status={app.status} />
          {app.submitted_at && (
            <span className="text-xs text-zinc-500">
              Submitted {format(new Date(app.submitted_at), 'MMM d, yyyy')}
            </span>
          )}
        </div>

        {/* About */}
        <Section title="About">
          <Field label="Residence" value={app.residence} />
          <Field label="Location" value={[cd?.city_town, cd?.state_option].filter(Boolean).join(', ')} />
          <Field label="Phone" value={cd?.phone_number} />
          <Field label="Volunteer Type" value={cd?.volunteer_type} />
          <Field label="Eclipse Attendance" value={cd?.eclipse_attendance} />
        </Section>

        <Separator />

        {/* Experience */}
        <Section title="Experience">
          <Field label="Skills" value={formatList(cd?.talents_skills)} />
          <Field label="Skills Description" value={cd?.skills_description} long />
          <Field label="Festival Experience" value={cd?.festival_experience} long />
          <Field label="Build Experience" value={cd?.build_experience} long />
          <Field label="Team Contribution" value={cd?.team_contribution} long />
        </Section>

        <Separator />

        {/* Availability & Teams */}
        <Section title="Availability & Teams">
          <Field label="Available Phases" value={formatList(cd?.available_phases)} />
          <Field label="Team Preferences" value={formatList(cd?.team_preferences)} />
        </Section>

        <Separator />

        {/* Referral */}
        <Section title="Referral">
          <Field label="Staff Referral" value={cd?.staff_referral} />
          <Field label="Referral Name" value={cd?.referral_name} />
        </Section>

        <Separator />

        {/* Special Accommodations */}
        <Section title="Special Accommodations">
          <Field label="Medical Conditions" value={cd?.medical_conditions} long />
          <Field label="Accommodations Needed" value={cd?.accommodations_needed} long />
        </Section>

        <Separator />

        {/* Emergency Contact */}
        <Section title="Emergency Contact">
          <Field label="Name" value={cd?.emergency_contact_name} />
          <Field label="Phone" value={cd?.emergency_contact_phone} />
        </Section>

        <Separator />

        {/* Agreement */}
        <Section title="Agreement">
          <Field
            label="Signed"
            value={cd?.agreement_date ? format(new Date(cd.agreement_date), 'MMM d, yyyy') : undefined}
          />
          <Field label="Data Privacy Consent" value={cd?.data_privacy_consent ? 'Yes' : 'No'} />
        </Section>

        {/* Meta */}
        <div className="text-xs text-zinc-400 pt-2">
          Created {format(new Date(app.created_at), 'MMM d, yyyy h:mm a')}
          {app.updated_at !== app.created_at && (
            <> · Updated {format(new Date(app.updated_at), 'MMM d, yyyy h:mm a')}</>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-900 mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value, long }: { label: string; value?: string | null; long?: boolean }) {
  if (!value) return null;
  return (
    <div className={long ? '' : 'flex items-baseline gap-2'}>
      <span className="text-xs font-medium text-zinc-500 shrink-0">{label}:</span>
      <span className={cn('text-sm text-zinc-800', long && 'block mt-0.5')}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-zinc-100 text-zinc-600 border-zinc-200',
    'in review': 'bg-amber-50 text-amber-700 border-amber-200',
    accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-red-50 text-red-700 border-red-200',
  };

  return (
    <Badge variant="outline" className={cn('capitalize text-xs', styles[status] || '')}>
      {status}
    </Badge>
  );
}

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function formatList(items?: string[] | string): string {
  if (!items) return '—';
  if (typeof items === 'string') return items || '—';
  return items.length > 0 ? items.join(', ') : '—';
}

function TagList({ items }: { items?: string[] | string }) {
  if (!items) return <span className="text-zinc-400">—</span>;
  const arr = typeof items === 'string' ? [items] : items;
  if (arr.length === 0) return <span className="text-zinc-400">—</span>;

  return (
    <div className="flex items-center gap-1 min-w-0">
      <span className="inline-block max-w-[100px] truncate rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700">
        {arr[0]}
      </span>
      {arr.length > 1 && (
        <span className="shrink-0 text-xs text-zinc-400">+{arr.length - 1}</span>
      )}
    </div>
  );
}
