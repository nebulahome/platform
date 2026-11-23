import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PeopleField } from '@/components/people-field';

const PEOPLE = [
  { id: 'b', displayName: 'Bobby', username: 'bobby', avatarUrl: null },
  { id: 'g', displayName: 'Giulia', username: 'giulia', avatarUrl: null },
  { id: 'e', displayName: 'Elena', username: 'elena', avatarUrl: null },
];

describe('PeopleField', () => {
  it('keeps a locked person ticked, says why, and leaves them out of what it hands back', () => {
    const onChange = vi.fn();

    render(
      <PeopleField
        legend="Editors"
        people={PEOPLE}
        value={['g']}
        onChange={onChange}
        selfId="b"
        isPending={false}
        locked={new Map([['b', 'Always · owner']])}
        summary={(ids) => `${String(ids.length)} edit it`}
      />,
    );

    const bobby = screen.getByRole<HTMLInputElement>('checkbox', { name: /Bobby/u });

    expect(bobby.checked).toBe(true);
    expect(bobby.disabled).toBe(true);
    expect(screen.getByText('Always · owner')).toBeTruthy();
    expect(screen.getByText('2 edit it')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /Elena/u }));

    expect(onChange).toHaveBeenCalledWith(['g', 'e']);
  });

  it('shows every tick and lets none be pressed for someone who may only look', () => {
    render(
      <PeopleField
        legend="Editors"
        people={PEOPLE}
        value={['g']}
        onChange={vi.fn()}
        selfId="e"
        isPending={false}
        isReadOnly
        summary={() => ''}
      />,
    );

    const giulia = screen.getByRole<HTMLInputElement>('checkbox', { name: /Giulia/u });

    expect(giulia.checked).toBe(true);
    expect(giulia.disabled).toBe(true);
  });
});
