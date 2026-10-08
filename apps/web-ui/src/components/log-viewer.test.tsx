import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContainerLogsReply } from '@nebulahome/contracts';

import { LogViewer } from '@/components/log-viewer';

/**
 * Draws the viewer over a read the test holds.
 *
 * @param read - What reading the log answers.
 * @returns The read, to look at how it was asked.
 */
function renderViewer(read: (since: string | undefined) => ContainerLogsReply) {
  const spy = vi.fn((tail: number, since: string | undefined) => Promise.resolve(read(since)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <LogViewer
        queryKey={['logs', 'test']}
        fileName="test"
        read={async (tail, since) => spy(tail, since)}
      />
    </QueryClientProvider>,
  );

  return { spy, client };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('LogViewer', () => {
  it('draws each line with its level, and reads on from the cursor it was given', async () => {
    const { spy, client } = renderViewer((since) =>
      since === undefined
        ? {
            lines: [
              {
                at: new Date('2026-09-28T10:00:00.000Z'),
                stream: 'stdout',
                text: '[2026-09-28 10:00:00] info: z2m: Starting',
              },
              {
                at: new Date('2026-09-28T10:00:01.000Z'),
                stream: 'stderr',
                text: '[2026-09-28 10:00:01] error: z2m: Failed to start zigbee',
              },
            ],
            cursor: '1790589601.000000000',
            isTruncated: false,
          }
        : {
            lines: [
              {
                at: new Date('2026-09-28T10:00:02.000Z'),
                stream: 'stdout',
                text: 'Listening',
              },
            ],
            cursor: '1790589602.000000000',
            isTruncated: false,
          },
    );

    expect(await screen.findByText(/Failed to start zigbee/u)).toBeTruthy();
    expect(screen.getByText('ERR')).toBeTruthy();
    expect(screen.getByText('INF')).toBeTruthy();
    expect(spy).toHaveBeenCalledWith(500, undefined);

    await client.refetchQueries({ queryKey: ['logs', 'test'] });

    expect(await screen.findByText('Listening')).toBeTruthy();
    expect(spy).toHaveBeenLastCalledWith(500, '1790589601.000000000');
    // What came before is kept: the second read only added to it.
    expect(screen.getByText(/Failed to start zigbee/u)).toBeTruthy();
  });

  it('shows only the errors when asked, and what the search finds', async () => {
    renderViewer(() => ({
      lines: [
        { at: null, stream: 'stdout', text: 'INFO all good' },
        { at: null, stream: 'stdout', text: 'ERROR broken pipe' },
      ],
      cursor: null,
      isTruncated: false,
    }));

    expect(await screen.findByText(/all good/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Errors' }));

    await waitFor(() => {
      expect(screen.queryByText(/all good/u)).toBeNull();
    });
    expect(screen.getByText(/broken pipe/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing like it' } });

    expect(await screen.findByText('No line matches.')).toBeTruthy();
  });

  it('says so when the container has written nothing', async () => {
    renderViewer(() => ({ lines: [], cursor: null, isTruncated: false }));

    expect(await screen.findByText('It has written nothing.')).toBeTruthy();
  });

  it('leaves the chrome still while it reads on its own', async () => {
    const empty: ContainerLogsReply = { lines: [], cursor: null, isTruncated: false };
    let release: ((reply: ContainerLogsReply) => void) | undefined;
    let reads = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <LogViewer
          queryKey={['logs', 'held']}
          fileName="test"
          read={async () => {
            reads += 1;

            // The first read answers at once; the next is held open, as a slow background read.
            return reads === 1
              ? empty
              : new Promise<ContainerLogsReply>((resolve) => {
                  release = resolve;
                });
          }}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('It has written nothing.')).toBeTruthy();
    const header = screen.getByRole('heading', { name: 'Logs' }).closest('header');
    const before = header?.innerHTML;
    const refetch = client.refetchQueries({ queryKey: ['logs', 'held'] });

    await waitFor(() => {
      expect(release).toBeDefined();
    });
    // Mid-read: the header is exactly as it was, and no button has gone grey.
    expect(header?.innerHTML).toBe(before);
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }

    release?.(empty);
    await refetch;
  });

  it('offers the way back to the newest line only once the reader scrolls away', async () => {
    renderViewer(() => ({
      lines: [{ at: new Date('2026-09-28T10:00:00.000Z'), stream: 'stdout', text: 'Hello' }],
      cursor: null,
      isTruncated: false,
    }));

    expect(await screen.findByText('Hello')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Follow the newest lines/u })).toBeNull();

    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 200 });
    log.scrollTop = 100;
    fireEvent.scroll(log);

    fireEvent.click(screen.getByRole('button', { name: /Follow the newest lines/u }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Follow the newest lines/u })).toBeNull();
    });
  });
});
