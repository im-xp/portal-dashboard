import type { ProductSegment, ReviewApplicationBody } from './types';

const EDGEOS_API_URL = (process.env.EDGEOS_API_URL || '').trim();
const APPLICATION_REVIEW_API_KEY = (process.env.APPLICATION_REVIEW_API_KEY || '').trim();

function assertConfig(): void {
  if (!EDGEOS_API_URL) throw new Error('EDGEOS_API_URL is not configured');
  if (!APPLICATION_REVIEW_API_KEY) throw new Error('APPLICATION_REVIEW_API_KEY is not configured');
}

async function edgeosFetch<T>(path: string, init?: RequestInit): Promise<T> {
  assertConfig();
  const res = await fetch(`${EDGEOS_API_URL}${path}`, {
    ...init,
    headers: {
      'x-api-key': APPLICATION_REVIEW_API_KEY,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EdgeOS API ${res.status}: ${text}`);
  }

  return res.json();
}

export async function fetchSegments(popupCitySlug: string): Promise<ProductSegment[]> {
  return edgeosFetch<ProductSegment[]>(
    `/product-segments/?popup_city_slug=${encodeURIComponent(popupCitySlug)}`
  );
}

export async function reviewApplication(
  applicationId: number,
  body: ReviewApplicationBody
): Promise<unknown> {
  return edgeosFetch(`/applications/${applicationId}/review`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
