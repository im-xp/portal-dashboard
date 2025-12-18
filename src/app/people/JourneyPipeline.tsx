'use client';

import { cn } from '@/lib/utils';
import type { JourneyStage } from '@/lib/types';
import { CheckCircle2, ShoppingCart, AlertCircle, Clock } from 'lucide-react';

interface JourneyPipelineProps {
  counts: Record<JourneyStage, number>;
  selectedStage: JourneyStage | 'all';
  onSelectStage: (stage: JourneyStage | 'all') => void;
}

const stages: { 
  key: JourneyStage; 
  label: string; 
  sublabel: string;
  icon: typeof CheckCircle2;
  color: string;
  bgColor: string;
  borderColor: string;
}[] = [
  { 
    key: 'accepted', 
    label: 'Accepted', 
    sublabel: 'no payment',
    icon: Clock,
    color: 'text-zinc-600',
    bgColor: 'bg-zinc-100',
    borderColor: 'border-zinc-300',
  },
  { 
    key: 'in_cart', 
    label: 'In Cart', 
    sublabel: 'checkout started',
    icon: ShoppingCart,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-300',
  },
  { 
    key: 'partial', 
    label: 'Partial', 
    sublabel: 'needs pass or room',
    icon: AlertCircle,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-300',
  },
  { 
    key: 'confirmed', 
    label: 'Confirmed', 
    sublabel: 'pass + lodging',
    icon: CheckCircle2,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-300',
  },
];

export function JourneyPipeline({ counts, selectedStage, onSelectStage }: JourneyPipelineProps) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  
  return (
    <div className="mb-4 md:mb-6">
      {/* All button */}
      <div className="flex items-center gap-2 mb-3 md:mb-4">
        <button
          onClick={() => onSelectStage('all')}
          className={cn(
            'px-3 md:px-4 py-2 rounded-lg text-sm font-medium transition-all',
            selectedStage === 'all'
              ? 'bg-zinc-900 text-white'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
          )}
        >
          All People ({total})
        </button>
      </div>
      
      {/* Pipeline stages - horizontal scroll on mobile */}
      <div className="flex gap-2 md:gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:overflow-visible">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const count = counts[stage.key];
          const isSelected = selectedStage === stage.key;
          
          return (
            <div key={stage.key} className="flex items-center flex-shrink-0">
              <button
                onClick={() => onSelectStage(stage.key)}
                className={cn(
                  'relative flex flex-col items-center justify-center p-3 md:p-4 rounded-xl border-2 transition-all min-w-[100px] md:min-w-[140px]',
                  isSelected
                    ? `${stage.bgColor} ${stage.borderColor} shadow-md`
                    : 'bg-white border-zinc-200 hover:border-zinc-300 hover:shadow-sm'
                )}
              >
                <Icon className={cn('h-5 w-5 md:h-6 md:w-6 mb-1 md:mb-2', isSelected ? stage.color : 'text-zinc-400')} />
                <span className={cn(
                  'text-xl md:text-2xl font-bold',
                  isSelected ? stage.color : 'text-zinc-900'
                )}>
                  {count}
                </span>
                <span className={cn(
                  'text-xs md:text-sm font-medium',
                  isSelected ? stage.color : 'text-zinc-700'
                )}>
                  {stage.label}
                </span>
                <span className="text-[10px] md:text-xs text-zinc-500 mt-0.5 hidden md:block">
                  {stage.sublabel}
                </span>
              </button>
              
              {/* Arrow between stages - hide on mobile */}
              {index < stages.length - 1 && (
                <div className="px-1 md:px-2 text-zinc-300 hidden md:block">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Conversion funnel hint */}
      <p className="text-xs text-zinc-500 mt-2 md:mt-3 hidden md:block">
        Click a stage to filter • Confirmed = ready to attend (has pass + lodging)
      </p>
    </div>
  );
}

