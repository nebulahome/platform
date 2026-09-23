/**
 * The form a bundle's declaration turns into.
 *
 * One control per field, of the kind the field asks for, wired to a draft the page owns. What is
 * asserted is the mapping - text field, password field, switch, select - and that what is typed
 * reaches the page under the field's key.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { integrationSetupSchema } from '@nebula-home/contracts';

import { initialDraft } from '@/library/setup-values';

import { SetupForm } from './setup-form';

const SETUP = integrationSetupSchema.parse({
  transport: {
    fields: [
      { key: 'url', type: 'text', label: 'Printer address', isRequired: true, help: 'Port 8883.' },
      { key: 'password', type: 'secret', label: 'Access code', isRequired: true },
      { key: 'pollMs', type: 'number', label: 'Poll every', unit: 'ms', default: 5000 },
      { key: 'isSecure', type: 'boolean', label: 'HTTPS', default: false },
      {
        key: 'speed',
        type: 'choice',
        label: 'Speed',
        choices: [
          { value: 'slow', label: 'Slow' },
          { value: 'fast', label: 'Fast' },
        ],
        default: 'fast',
      },
      { key: 'hosts', type: 'list', label: 'Addresses' },
    ],
  },
});

describe('SetupForm', () => {
  it('renders one control per field, of the kind the field asks for', () => {
    render(
      <SetupForm
        group={SETUP.transport}
        draft={initialDraft(SETUP.transport)}
        errors={{}}
        kept={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Printer address').getAttribute('type')).toBe('text');
    expect(screen.getByLabelText('Access code').getAttribute('type')).toBe('password');
    expect(screen.getByLabelText('Poll every').getAttribute('type')).toBe('number');
    expect(screen.getByRole('radiogroup', { name: 'HTTPS' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /^Speed/u })).toBeTruthy();
    expect(screen.getByLabelText('Addresses')).toBeTruthy();
    expect(screen.getByText('Port 8883.')).toBeTruthy();
  });

  it('tells the browser these are not account fields', () => {
    render(
      <SetupForm
        group={SETUP.transport}
        draft={initialDraft(SETUP.transport)}
        errors={{}}
        kept={[]}
        onChange={vi.fn()}
      />,
    );

    // A text field labelled "…address" right before a `new-password` field is what a sign-up form
    // looks like to a browser, and Brave answered by offering to make an email alias for the
    // printer's address. Each typed field carries the bundle's own key and asks for no filling.
    for (const label of ['Printer address', 'Access code', 'Addresses']) {
      const input = screen.getByLabelText(label);

      expect(input.getAttribute('autocomplete'), label).toBe('off');
    }

    expect(screen.getByLabelText('Printer address').getAttribute('name')).toBe('url');
    expect(screen.getByLabelText('Addresses').getAttribute('name')).toBe('hosts');
  });

  it('reports what was typed under the field key', () => {
    const onChange = vi.fn();

    render(
      <SetupForm
        group={SETUP.transport}
        draft={initialDraft(SETUP.transport)}
        errors={{}}
        kept={[]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Printer address'), {
      target: { value: 'mqtts://192.168.1.60:8883' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'On' }));

    expect(onChange).toHaveBeenCalledWith('url', 'mqtts://192.168.1.60:8883');
    expect(onChange).toHaveBeenCalledWith('isSecure', true);
  });

  it('shows the error under the field it belongs to', () => {
    render(
      <SetupForm
        group={SETUP.transport}
        draft={initialDraft(SETUP.transport)}
        errors={{ url: 'Must start with mqtt' }}
        kept={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe('Must start with mqtt');
    expect(screen.getByLabelText('Printer address').getAttribute('aria-invalid')).toBe('true');
  });

  it('says a secret is kept, so a blank field is not a missing one', () => {
    render(
      <SetupForm
        group={SETUP.transport}
        draft={initialDraft(SETUP.transport)}
        errors={{}}
        kept={['password']}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Access code').getAttribute('placeholder')).toMatch(/kept/iu);
  });
});
