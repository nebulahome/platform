/**
 * Every call the dashboard makes, one function per endpoint.
 *
 * As everywhere else in the client, each names the contract schema its answer must satisfy: a
 * dashboard that comes back in a shape this build does not understand is refused here, not drawn
 * half-right.
 */
import { z } from 'zod';

import {
  dashboardDocumentSchema,
  dashboardViewSchema,
  type DashboardCreate,
  type DashboardDocument,
  type DashboardUpdate,
  type DashboardView,
} from '@nebula-home/contracts';

import { apiRequest } from '@/lib/api-client';

/** The cache keys the dashboard reads under. */
export const DASHBOARD_QUERY_KEYS = {
  /** The signed-in person's dashboards. */
  dashboards: ['dashboards'] as const,
} as const;

/**
 * Lists the signed-in person's dashboards, in the order their tabs are drawn.
 *
 * @param signal - Cancels the request.
 * @returns Their dashboards.
 */
export async function fetchDashboards(signal?: AbortSignal): Promise<DashboardView[]> {
  const { items } = await apiRequest(
    '/dashboards',
    z.object({ items: z.array(dashboardViewSchema) }),
    { ...(signal === undefined ? {} : { signal }) },
  );

  return items;
}

/**
 * Creates a dashboard.
 *
 * @param request - Its name, and optionally its icon and first cards.
 * @returns The dashboard as it now stands.
 */
export async function createDashboard(request: DashboardCreate): Promise<DashboardView> {
  return apiRequest('/dashboards', dashboardViewSchema, { method: 'POST', body: request });
}

/**
 * Changes a dashboard. A layout replaces the stored one whole.
 *
 * @param dashboardId - Which one.
 * @param request - What to change.
 * @returns The dashboard as it now stands.
 */
export async function updateDashboard(
  dashboardId: string,
  request: DashboardUpdate,
): Promise<DashboardView> {
  return apiRequest(`/dashboards/${dashboardId}`, dashboardViewSchema, {
    method: 'PATCH',
    body: request,
  });
}

/**
 * Deletes a dashboard.
 *
 * @param dashboardId - Which one.
 * @returns The dashboard as it was.
 */
export async function deleteDashboard(dashboardId: string): Promise<DashboardView> {
  return apiRequest(`/dashboards/${dashboardId}`, dashboardViewSchema, { method: 'DELETE' });
}

/**
 * Reads a dashboard out as a file.
 *
 * @param dashboardId - Which one.
 * @returns What its file holds.
 */
export async function exportDashboard(dashboardId: string): Promise<DashboardDocument> {
  return apiRequest(`/dashboards/${dashboardId}/export`, dashboardDocumentSchema);
}

/**
 * Makes a new dashboard from a dashboard file.
 *
 * @param document - What the file holds.
 * @returns The new dashboard.
 */
export async function importDashboard(document: DashboardDocument): Promise<DashboardView> {
  return apiRequest('/dashboards/import', dashboardViewSchema, { method: 'POST', body: document });
}
