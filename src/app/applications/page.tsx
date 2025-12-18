import { getDashboardData } from '@/lib/nocodb';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FileText, Users, Clock, CheckCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';

export default async function ApplicationsPage() {
  const { applications, metrics } = await getDashboardData();

  // Sort by most recent first
  const sortedApplications = [...applications].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'rejected':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'in review':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return '';
    }
  };

  return (
    <div className="flex flex-col">
      <Header
        title="Applications"
        description="Track application pipeline and status"
      />

      <div className="p-4 md:p-8">
        {/* Status Summary */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 mb-6 md:mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Total</CardTitle>
              <FileText className="h-4 w-4 md:h-5 md:w-5 text-zinc-400" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold">{metrics.totalApplications}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Accepted</CardTitle>
              <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-emerald-500" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold text-emerald-600">
                {metrics.applicationsByStatus['accepted'] || 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">In Review</CardTitle>
              <Clock className="h-4 w-4 md:h-5 md:w-5 text-amber-500" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold text-amber-600">
                {metrics.applicationsByStatus['in review'] || 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Purchases</CardTitle>
              <Users className="h-4 w-4 md:h-5 md:w-5 text-zinc-400" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold">{metrics.paidAttendees}</div>
            </CardContent>
          </Card>
        </div>

        {/* Applications Table */}
        <Card>
          <CardHeader className="pb-3 md:pb-6">
            <CardTitle className="text-base md:text-lg">All Applications</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attendees</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedApplications.map((app) => {
                  const totalProducts = app.attendeesList.reduce(
                    (sum, att) => sum + att.purchasedProducts.length,
                    0
                  );
                  const hasPaid = totalProducts > 0;

                  return (
                    <TableRow key={app.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 flex items-center justify-center text-sm font-medium">
                            {app.first_name[0]}{app.last_name[0]}
                          </div>
                          <div>
                            <p className="font-medium">{app.first_name} {app.last_name}</p>
                            {app.telegram && (
                              <p className="text-xs text-zinc-500">@{app.telegram}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-zinc-500">{app.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`capitalize ${getStatusColor(app.status)}`}>
                          {app.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Users className="h-4 w-4 text-zinc-400" />
                          <span>{app.attendeesList.length}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {hasPaid ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                            {totalProducts} item{totalProducts !== 1 ? 's' : ''}
                          </Badge>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-zinc-500 text-sm">
                        {app.submitted_at
                          ? formatDistanceToNow(new Date(app.submitted_at), { addSuffix: true })
                          : 'Not submitted'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

