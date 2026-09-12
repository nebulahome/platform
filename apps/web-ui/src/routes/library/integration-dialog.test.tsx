/**
 * The dialog around the form: which model, what Test sends, what Save sends, and what comes back.
 *
 * The API module is stood in for, because the interest is in what the dialog asks of it - the
 * values as typed, the kept secret left out, the driver's kind and the model picked - and in how
 * it shows the answer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  IntegrationSetup,
  IntegrationVendorView,
  IntegrationView,
} from '@nebula-home/contracts';

import { ApiError } from '@/lib/api-error';
import { createIntegration, probeIntegration, updateIntegration } from '@/library/api';

import { IntegrationDialog } from './integration-dialog';

vi.mock('@/library/api', () => ({
  probeIntegration: vi.fn(),
  createIntegration: vi.fn(),
  updateIntegration: vi.fn(),
}));

/** What the printer driver asks. */
const PRINTER_SETUP = {
  transport: {
    constants: { username: 'bblp' },
    fields: [
      { key: 'url', type: 'text', label: 'Printer address', isRequired: true, maxLength: 512 },
      {
        key: 'password',
        type: 'secret',
        label: 'Access code',
        isRequired: true,
        minLength: 8,
        maxLength: 8,
      },
    ],
  },
  options: { constants: {}, fields: [] },
} satisfies IntegrationSetup;

/** Bambu Lab, as the vendors list serves it: one driver, two printers to choose between. */
const BAMBU: IntegrationVendorView = {
  id: 'bambu-lab',
  version: '1.0.0',
  name: 'Bambu Lab',
  internetRequired: false,
  transports: ['mqtt'],
  setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
  drivers: [
    {
      id: 'bambu-lab/printer',
      vendorId: 'bambu-lab',
      driverId: 'printer',
      name: 'Printer',
      transport: 'mqtt',
      models: ['X1C', 'P1S'],
      setup: PRINTER_SETUP,
    },
  ],
  needsSetup: false,
  isConfigured: false,
  transportConfig: {},
  options: {},
  configuredAt: null,
  instanceCount: 0,
  deviceCount: 0,
  entityCount: 0,
};

/** Shelly: one driver that lists no model, so there is nothing to choose. */
const SHELLY: IntegrationVendorView = {
  ...BAMBU,
  id: 'shelly',
  name: 'Shelly',
  transports: ['http'],
  drivers: [
    {
      id: 'shelly/1pm-mini-g3',
      vendorId: 'shelly',
      driverId: '1pm-mini-g3',
      name: '1PM Mini Gen3',
      transport: 'http',
      models: [],
      setup: {
        transport: {
          constants: {},
          fields: [
            { key: 'host', type: 'text', label: 'Address', isRequired: true, maxLength: 512 },
          ],
        },
        options: { constants: {}, fields: [] },
      },
    },
  ],
};

/** An instance of the printer, as the list serves it. */
const EXISTING: IntegrationView = {
  id: 'bambu-lab-x1c',
  kind: 'bambu-lab/printer',
  kindVersion: '1.0.0',
  vendorId: 'bambu-lab',
  driverId: 'printer',
  driverName: 'Printer',
  model: 'X1C',
  transport: 'mqtt',
  transportConfig: {
    url: 'mqtts://192.168.1.60:8883',
    username: 'bblp',
    password: { $sealed: true },
  },
  options: {},
  isEnabled: true,
  state: 'running',
  lastError: null,
  lastStartedAt: null,
  deviceCount: 1,
  entityCount: 12,
};

beforeAll(() => {
  // jsdom implements `<dialog>` but not the modal behaviour behind it.
  if (typeof globalThis.HTMLDialogElement.prototype.showModal !== 'function') {
    globalThis.HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (typeof globalThis.HTMLDialogElement.prototype.close !== 'function') {
    globalThis.HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

/**
 * Renders the dialog inside what it needs.
 *
 * @param target - What it is for.
 * @returns The callbacks it was given.
 */
function renderDialog(target: Parameters<typeof IntegrationDialog>[0]['target']) {
  const onSaved = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntegrationDialog target={target} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>,
  );

  return { onSaved, onClose };
}

/**
 * Fills the printer's two fields.
 *
 * @param url - The address to type.
 */
function fillPrinter(url = 'mqtts://192.168.1.60:8883'): void {
  fireEvent.change(screen.getByLabelText('Printer address'), { target: { value: url } });
  fireEvent.change(screen.getByLabelText('Access code'), { target: { value: '12345678' } });
}

describe('adding a device', () => {
  it('offers every model the vendor has, and suggests an id from the one picked', () => {
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    const model = screen.getByLabelText('Model');

    expect(model.textContent).toContain('X1C');
    expect(screen.getByLabelText<HTMLInputElement>('Id').value).toBe('bambu-lab-x1c');
  });

  it('asks for no model when the vendor offers only one, and takes it silently', async () => {
    vi.mocked(createIntegration).mockResolvedValue(EXISTING);
    renderDialog({ mode: 'create', vendor: SHELLY, existingIds: [] });

    expect(screen.queryByLabelText('Model')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Id').value).toBe('shelly-1pm-mini-gen3');

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '192.168.1.40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createIntegration).toHaveBeenCalledWith({
        id: 'shelly-1pm-mini-gen3',
        kind: 'shelly/1pm-mini-g3',
        model: '1PM Mini Gen3',
        isEnabled: true,
        transportConfig: { host: '192.168.1.40' },
        options: {},
      });
    });
  });

  it('suggests an id nobody has yet', () => {
    // The first X1C is `bambu-lab-x1c`; the second is not, because the id is what every entity
    // of the instance carries as its source and two of them cannot share it.
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: ['bambu-lab-x1c'] });

    expect(screen.getByLabelText<HTMLInputElement>('Id').value).toBe('bambu-lab-x1c-2');
  });

  it('tries what was typed, with the kind, and shows the verdict', async () => {
    vi.mocked(probeIntegration).mockResolvedValue({
      isReachable: true,
      detail: 'Connected to mqtts://192.168.1.60:8883 as bblp',
    });
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    fillPrinter();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Connected to');
    });
    expect(probeIntegration).toHaveBeenCalledWith({
      kind: 'bambu-lab/printer',
      transportConfig: { url: 'mqtts://192.168.1.60:8883', password: '12345678' },
    });
  });

  it('underlines the field that is wrong instead of asking the server', () => {
    vi.mocked(probeIntegration).mockClear();
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    fireEvent.change(screen.getByLabelText('Printer address'), {
      target: { value: 'mqtts://192.168.1.60:8883' },
    });
    fireEvent.change(screen.getByLabelText('Access code'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    expect(screen.getByLabelText('Access code').getAttribute('aria-invalid')).toBe('true');
    expect(probeIntegration).not.toHaveBeenCalled();
  });

  it('saves the id, the kind, the model and the values, and hands back what came back', async () => {
    vi.mocked(createIntegration).mockResolvedValue({ ...EXISTING, state: 'starting' });
    const { onSaved } = renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    fillPrinter();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ ...EXISTING, state: 'starting' });
    });
    expect(createIntegration).toHaveBeenCalledWith({
      id: 'bambu-lab-x1c',
      kind: 'bambu-lab/printer',
      model: 'X1C',
      isEnabled: true,
      transportConfig: { url: 'mqtts://192.168.1.60:8883', password: '12345678' },
      options: {},
    });
  });

  it('says so when the vendor still needs setting up', async () => {
    vi.mocked(createIntegration).mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'CONFLICT',
        message: 'Bambu Lab needs setting up first',
        details: { vendorId: 'bambu-lab', reason: 'needs-setup' },
      }),
    );
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    fillPrinter();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('needs setting up');
    });
  });
});

describe('changing a device', () => {
  it('leaves a blank secret out, so the one kept stays, and names the instance to the probe', async () => {
    vi.mocked(probeIntegration).mockResolvedValue({ isReachable: true, detail: 'Connected' });
    vi.mocked(updateIntegration).mockResolvedValue(EXISTING);
    const { onSaved } = renderDialog({ mode: 'edit', vendor: BAMBU, integration: EXISTING });

    expect(screen.getByLabelText('Access code').getAttribute('placeholder')).toMatch(/kept/iu);

    fireEvent.change(screen.getByLabelText('Printer address'), {
      target: { value: 'mqtts://192.168.1.61:8883' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(probeIntegration).toHaveBeenCalledWith({
        kind: 'bambu-lab/printer',
        transportConfig: { url: 'mqtts://192.168.1.61:8883' },
        integrationId: 'bambu-lab-x1c',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(EXISTING);
    });
    expect(updateIntegration).toHaveBeenCalledWith('bambu-lab-x1c', {
      isEnabled: true,
      model: 'X1C',
      transportConfig: { url: 'mqtts://192.168.1.61:8883' },
      options: {},
    });
  });
});
