/**
 * The dialog around the form: which model, what to call it, its icon, what Test sends, what
 * Save sends, and what comes back.
 *
 * The API module is stood in for, because the interest is in what the dialog asks of it - the
 * values as typed, the kept secret left out, the driver's kind, the model, the name and the icon
 * - and in how it shows the answer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  entityIdSchema,
  type DeviceView,
  type IconView,
  type IntegrationSetup,
  type IntegrationVendorView,
} from '@nebula-home/contracts';

import { ApiError } from '@/lib/api-error';
import { createDevice, fetchIcons, probeDevice, updateDevice } from '@/library/api';

import { DeviceDialog } from './device-dialog';

vi.mock('@/library/api', () => ({
  probeDevice: vi.fn(),
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
  fetchIcons: vi.fn(),
  LIBRARY_QUERY_KEYS: { icons: ['library', 'icons'] },
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
  logoPadding: 0,
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
      defaultIcon: 'printer',
      setup: PRINTER_SETUP,
    },
  ],
  needsSetup: false,
  isConfigured: false,
  transportConfig: {},
  options: {},
  configuredAt: null,
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
      defaultIcon: 'relay',
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

/** A device of the printer driver, as the list serves it. */
const EXISTING: DeviceView = {
  id: 'bambu-lab-x1c',
  name: 'Studio printer',
  icon: 'printer',
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
  lastUpdatedAt: null,
  externalId: '01P00A000000042',
  manufacturer: 'Bambu Lab',
  swVersion: null,
  hwVersion: null,
  areaKey: null,
  areaName: null,
  entityIds: [entityIdSchema.parse('sensor.bambu_lab_x1c_nozzle_temperature')],
};

/**
 * An icon as the catalogue serves it.
 *
 * @param id - Its id.
 * @returns The icon.
 */
function iconView(id: string): IconView {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    keywords: [],
    origin: 'builtin',
    isOverridden: false,
    node: [['circle', { cx: '12', cy: '12', r: '4' }]],
    frame: { x: 0, y: 0, size: 24 },
  };
}

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

  vi.mocked(fetchIcons).mockImplementation((request) =>
    Promise.resolve(
      request.ids !== undefined
        ? request.ids.map(iconView)
        : ['printer', 'lightbulb', 'relay']
            .filter((id) => request.q === undefined || id.includes(request.q))
            .map(iconView),
    ),
  );
});

/**
 * Renders the dialog inside what it needs.
 *
 * @param target - What it is for.
 * @returns The callbacks it was given.
 */
function renderDialog(target: Parameters<typeof DeviceDialog>[0]['target']) {
  const onSaved = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <DeviceDialog target={target} onClose={onClose} onSaved={onSaved} />
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
  it('offers every model the vendor has, names the device after the one picked, and suggests an id from the name', () => {
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    expect(screen.getByLabelText('Model').textContent).toContain('X1C');
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('X1C');
    expect(screen.getByLabelText<HTMLInputElement>('Id').value).toBe('bambu-lab-x1c');
  });

  it('follows the name into the id until the id is typed by hand', () => {
    // The id is what every entity carries as its source, so it should read as the device the
    // owner named - and stop moving once the owner has decided what it is.
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Studio printer' } });

    expect(screen.getByLabelText<HTMLInputElement>('Id').value).toBe('bambu-lab-studio-printer');

    fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'studio' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Office printer' } });

    expect(screen.getByLabelText<HTMLInputElement>('Id').value).toBe('studio');
  });

  it('asks for no model when the vendor offers only one, and takes it silently', async () => {
    vi.mocked(createDevice).mockResolvedValue(EXISTING);
    renderDialog({ mode: 'create', vendor: SHELLY, existingIds: [] });

    expect(screen.queryByLabelText('Model')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('1PM Mini Gen3');
    expect(screen.getByLabelText<HTMLInputElement>('Id').value).toBe('shelly-1pm-mini-gen3');

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '192.168.1.40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createDevice).toHaveBeenCalledWith({
        id: 'shelly-1pm-mini-gen3',
        kind: 'shelly/1pm-mini-g3',
        model: '1PM Mini Gen3',
        name: '1PM Mini Gen3',
        icon: 'relay',
        isEnabled: true,
        transportConfig: { host: '192.168.1.40' },
        options: {},
      });
    });
  });

  it('suggests an id nobody has yet', () => {
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: ['bambu-lab-x1c'] });

    expect(screen.getByLabelText<HTMLInputElement>('Id').value).toBe('bambu-lab-x1c-2');
  });

  it("starts from the driver's icon, and lets another be picked from the catalogue", async () => {
    vi.mocked(createDevice).mockResolvedValue(EXISTING);
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /change icon/iu }).textContent).toContain(
        'Printer',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /change icon/iu }));
    fireEvent.change(await screen.findByLabelText('Search icons'), {
      target: { value: 'light' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Lightbulb' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /change icon/iu }).textContent).toContain(
        'Lightbulb',
      );
    });

    fillPrinter();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createDevice).toHaveBeenCalledWith(expect.objectContaining({ icon: 'lightbulb' }));
    });
  });

  it('tries what was typed, with the kind, and shows the verdict', async () => {
    vi.mocked(probeDevice).mockResolvedValue({
      isReachable: true,
      detail: 'Connected to mqtts://192.168.1.60:8883 as bblp',
    });
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    fillPrinter();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Connected to');
    });
    expect(probeDevice).toHaveBeenCalledWith({
      kind: 'bambu-lab/printer',
      transportConfig: { url: 'mqtts://192.168.1.60:8883', password: '12345678' },
    });
  });

  it('underlines the field that is wrong instead of asking the server', () => {
    vi.mocked(probeDevice).mockClear();
    renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    fireEvent.change(screen.getByLabelText('Printer address'), {
      target: { value: 'mqtts://192.168.1.60:8883' },
    });
    fireEvent.change(screen.getByLabelText('Access code'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    expect(screen.getByLabelText('Access code').getAttribute('aria-invalid')).toBe('true');
    expect(probeDevice).not.toHaveBeenCalled();
  });

  it('saves the id, the kind, the model, the name, the icon and the values, and hands back what came back', async () => {
    vi.mocked(createDevice).mockResolvedValue({ ...EXISTING, state: 'identifying' });
    const { onSaved } = renderDialog({ mode: 'create', vendor: BAMBU, existingIds: [] });

    fillPrinter();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ ...EXISTING, state: 'identifying' });
    });
    expect(createDevice).toHaveBeenCalledWith({
      id: 'bambu-lab-x1c',
      kind: 'bambu-lab/printer',
      model: 'X1C',
      name: 'X1C',
      icon: 'printer',
      isEnabled: true,
      transportConfig: { url: 'mqtts://192.168.1.60:8883', password: '12345678' },
      options: {},
    });
  });

  it('says so when the vendor still needs setting up', async () => {
    vi.mocked(createDevice).mockRejectedValue(
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
  it('is titled by the name, leaves a blank secret out so the one kept stays, and names the device to the probe', async () => {
    vi.mocked(probeDevice).mockResolvedValue({ isReachable: true, detail: 'Connected' });
    vi.mocked(updateDevice).mockResolvedValue(EXISTING);
    const { onSaved } = renderDialog({ mode: 'edit', vendor: BAMBU, device: EXISTING });

    expect(screen.getByRole('heading', { name: 'Configure Studio printer' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Studio printer');
    expect(screen.queryByLabelText('Id')).toBeNull();
    expect(screen.getByLabelText('Access code').getAttribute('placeholder')).toMatch(/kept/iu);

    fireEvent.change(screen.getByLabelText('Printer address'), {
      target: { value: 'mqtts://192.168.1.61:8883' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(probeDevice).toHaveBeenCalledWith({
        kind: 'bambu-lab/printer',
        transportConfig: { url: 'mqtts://192.168.1.61:8883' },
        deviceId: 'bambu-lab-x1c',
      });
    });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Office printer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(EXISTING);
    });
    expect(updateDevice).toHaveBeenCalledWith('bambu-lab-x1c', {
      name: 'Office printer',
      icon: 'printer',
      isEnabled: true,
      model: 'X1C',
      transportConfig: { url: 'mqtts://192.168.1.61:8883' },
      options: {},
    });
  });
});
