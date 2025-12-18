import { getDashboardData } from '@/lib/nocodb';
import { Header } from '@/components/layout/Header';
import { PeopleTable } from './PeopleTable';
import type { JourneyStage } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  const { applications, attendees } = await getDashboardData();

  // Calculate journey stage counts
  const journeyCounts: Record<JourneyStage, number> = {
    accepted: 0,
    in_cart: 0,
    partial: 0,
    confirmed: 0,
  };

  for (const att of attendees) {
    journeyCounts[att.journeyStage]++;
  }

  return (
    <div className="flex flex-col min-h-0">
      <Header 
        title="People" 
        description="Track the journey from accepted applicant to confirmed attendee"
      />
      <div className="flex-1 p-4 md:p-8 overflow-auto">
        <PeopleTable 
          applications={applications} 
          attendees={attendees}
          journeyCounts={journeyCounts}
        />
      </div>
    </div>
  );
}
