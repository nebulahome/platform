/**
 * Every call the dashboards make, one function per endpoint: the ones assigned to the person
 * signed in, and - for whoever manages them - every dashboard, the people to assign them to, and
 * the writes.
 *
 * As everywhere else in the client, each names the contract schema its answer must satisfy: a
 * dashboard that comes back in a shape this build does not understand is refused here, not drawn
 * half-right.
 */
import { z } from 'zod';

import {
  dashboardAssigneeSchema,
  dashboardDocumentSchema,
  dashboardViewSchema,
  type DashboardAssignee,
  type DashboardCreate,
  type DashboardDocument,
  type DashboardUpdate,
  type DashboardView,
} from '@nebula-home/contracts';

import { apiRequest } from '@/lib/api-client';

/** The cache keys the dashboard reads under. */
export const DASHBOARD_QUERY_KEYS = {
  /** The dashboards assigned to the signed-in person. */
  dashboards: ['dashboards'] as const,

  /** Every dashboard in the house, for whoever manages them. */
  managed: ['dashboards', 'manage'] as const,

  /** The people a dashboard can be assigned to. */
  assignees: ['dashboards', 'assignees'] as const,
} as const;

/**
 * Lists the dashboards assigned to the signed-in person, in the order their tabs are drawn.
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
 * Lists every dashboard in the house, with who each is assigned to.
 *
 * @param signal - Cancels the request.
 * @returns The dashboards, oldest first.
 */
export async function fetchManagedDashboards(signal?: AbortSignal): Promise<DashboardView[]> {
  const { items } = await apiRequest(
    '/dashboards/manage',
    z.object({ items: z.array(dashboardViewSchema) }),
    { ...(signal === undefined ? {} : { signal }) },
  );

  return items;
}

/**
 * Lists the people a dashboard can be assigned to.
 *
 * @param signal - Cancels the request.
 * @returns Every active account, by name.
 */
export async function fetchAssignees(signal?: AbortSignal): Promise<DashboardAssignee[]> {
  const { items } = await apiRequest(
    '/dashboards/assignees',
    z.object({ items: z.array(dashboardAssigneeSchema) }),
    { ...(signal === undefined ? {} : { signal }) },
  );

  return items;
}

/**
 * Reads one dashboard.
 *
 * @param dashboardId - Which one.
 * @param signal - Cancels the request.
 * @returns The dashboard.
 */
export async function fetchDashboard(
  dashboardId: string,
  signal?: AbortSignal,
): Promise<DashboardView> {
  return apiRequest(`/dashboards/${dashboardId}`, dashboardViewSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
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
