/**
 * The tags, read once and shared by every field and page that shows them.
 *
 * Three places show tags - the device dialog, the entity dialog and the tags page - and each
 * of them can make one. One hook, so the read is cached under one key and a tag made in a
 * dialog is on the page behind it without a reload.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { TagColor, TagView } from '@nebula-home/contracts';

import { createTag, fetchTags, LIBRARY_QUERY_KEYS } from '@/library/api';

/** What a consumer gets. */
export type Tags = {
  /** Every tag, alphabetically; empty until read. */
  readonly tags: readonly TagView[];

  /** Whether the first read is still in flight. */
  readonly isPending: boolean;

  /**
   * Makes a tag.
   *
   * @param name - What the owner typed.
   * @param color - The colour they picked.
   * @returns The tag, once the server has it.
   */
  readonly create: (name: string, color: TagColor) => Promise<TagView>;
};

/**
 * Reads the tags, and makes one on request.
 *
 * @returns See {@link Tags}.
 */
export function useTags(): Tags {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.tags,

    /**
     * Reads every tag.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The tags.
     */
    queryFn: async ({ signal }) => fetchTags(signal),
    staleTime: 30_000,
  });

  const creation = useMutation({
    /**
     * Makes a tag.
     *
     * @param request - The name and the colour.
     * @param request.name - What the owner typed.
     * @param request.color - The colour they picked.
     * @returns The tag.
     */
    mutationFn: async (request: { name: string; color: TagColor }) => createTag(request),

    /** Reads the tags again, so every list that shows them has the new one. */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.tags });
    },
  });

  return {
    tags: query.data ?? [],
    isPending: query.isPending,

    /**
     * Makes a tag.
     *
     * @param name - What the owner typed.
     * @param color - The colour they picked.
     * @returns The tag, once the server has it.
     */
    create: async (name, color) => creation.mutateAsync({ name, color }),
  };
}
