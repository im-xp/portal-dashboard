'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Suspense } from 'react';

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const errorMessages: Record<string, string> = {
    AccessDenied: 'Access denied. Only @im-xp.com and @icelandeclipse.com accounts are allowed.',
    Callback: 'There was a problem with the authentication callback.',
    Default: 'An authentication error occurred.',
  };

  const message = errorMessages[error || ''] || errorMessages.Default;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="max-w-md w-full mx-4">
        <div className="bg-zinc-900 rounded-lg p-8 border border-zinc-800">
          <div className="flex justify-center mb-6">
            <div className="h-12 w-12 rounded-lg bg-red-500/20 flex items-center justify-center">
              <svg
                className="h-6 w-6 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
          </div>
          <h1 className="text-xl font-semibold text-white text-center mb-2">
            Authentication Error
          </h1>
          <p className="text-zinc-400 text-center mb-8">{message}</p>
          <Link href="/auth/signin">
            <Button className="w-full">Try Again</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <ErrorContent />
    </Suspense>
  );
}
