import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Collapse } from './collapse.js';

describe('Collapse', () => {
  it('draws nothing before it first opens', () => {
    render(
      <Collapse isOpen={false}>
        <p>Steps</p>
      </Collapse>,
    );

    expect(screen.queryByText('Steps')).toBeNull();
  });

  it('draws what it holds while closed when asked to, for a search to find', () => {
    render(
      <Collapse isOpen={false} isAlwaysRendered>
        <p>Steps</p>
      </Collapse>,
    );

    expect(screen.getByText('Steps')).toBeTruthy();
  });
});
