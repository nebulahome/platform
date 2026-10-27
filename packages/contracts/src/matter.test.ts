import { describe, expect, it } from 'vitest';

import {
  matterAnswerRequestSchema,
  matterCommissioningSchema,
  matterCommissionRequestSchema,
  matterNetworksSaveRequestSchema,
  matterPairingCodeSchema,
} from './matter.js';

describe('matterPairingCodeSchema', () => {
  it('reads a manual code as written, groups and all', () => {
    expect(matterPairingCodeSchema.parse('3497-011-2332')).toBe('34970112332');
    expect(matterPairingCodeSchema.parse(' 3497 011 2332 ')).toBe('34970112332');
    expect(matterPairingCodeSchema.parse('749701123365521327694')).toBe('749701123365521327694');
  });

  it('keeps a QR code as its text', () => {
    expect(matterPairingCodeSchema.parse('MT:Y.K9042C00KA0648G00')).toBe('MT:Y.K9042C00KA0648G00');
  });

  it('refuses what is no pairing code', () => {
    expect(matterPairingCodeSchema.safeParse('1234').success).toBe(false);
    expect(matterPairingCodeSchema.safeParse('3497-011-233a').success).toBe(false);
    expect(matterPairingCodeSchema.safeParse('MT:short').success).toBe(false);
    expect(matterPairingCodeSchema.safeParse('').success).toBe(false);
  });
});

describe('matterCommissionRequestSchema', () => {
  it('commissions by a shared code when a caller does not say', () => {
    expect(matterCommissionRequestSchema.parse({ code: '3497-011-2332' }).mode).toBe('shared');
    expect(matterCommissionRequestSchema.parse({ code: '34970112332', mode: 'new' }).mode).toBe(
      'new',
    );
  });
});

describe('matterCommissioningSchema', () => {
  it('reads a new device stopped on its Wi-Fi, found on its network', () => {
    const job = matterCommissioningSchema.parse({
      id: 'job-1',
      state: 'needs-answer',
      mode: 'new',
      question: 'needs-wifi',
      startedAt: new Date(),
      finishedAt: null,
      nodeId: null,
      error: null,
      steps: [
        { id: 'looking', state: 'done' },
        { id: 'found', state: 'done', detail: { product: 'Eve Energy', network: 'wifi' } },
        { id: 'network', state: 'running' },
      ],
    });

    expect(job.steps[1]?.detail.network).toBe('wifi');
  });
});

describe('matterAnswerRequestSchema', () => {
  it('takes a test certificate answer as before, and a Wi-Fi to join', () => {
    expect(matterAnswerRequestSchema.parse({ jobId: 'job-1', isAccepted: true }).wifi).toBe(
      undefined,
    );
    expect(
      matterAnswerRequestSchema.parse({
        jobId: 'job-1',
        isAccepted: true,
        wifi: { ssid: 'Home', password: 'correct horse' },
      }).wifi?.isSaved,
    ).toBe(false);
  });

  it('refuses a password WPA would not take', () => {
    expect(
      matterAnswerRequestSchema.safeParse({
        jobId: 'job-1',
        isAccepted: true,
        wifi: { ssid: 'Home', password: 'short' },
      }).success,
    ).toBe(false);
  });
});

describe('matterNetworksSaveRequestSchema', () => {
  it('keeps the saved password when none is given, and forgets the network on null', () => {
    expect(matterNetworksSaveRequestSchema.parse({ wifi: { ssid: 'Home' } }).wifi).toEqual({
      ssid: 'Home',
    });
    expect(matterNetworksSaveRequestSchema.parse({ wifi: null }).wifi).toBeNull();
  });
});
