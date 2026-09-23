/**
 * The marks on a vendor's card: the wires it speaks, then whether it needs the internet.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Marks } from '@/routes/library/vendor-card';

describe('Marks', () => {
  it('draws the platform wires by what they are', () => {
    render(<Marks vendor={{ transports: ['http', 'mqtt'], internetRequired: false }} />);

    expect(screen.getByRole('img', { name: 'Speaks HTTP to each device' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Listens on the MQTT broker' })).toBeTruthy();
  });

  it("marks a vendor's own protocol with a cable, named after the transport", () => {
    // A transport the vendor ships has a name the interface cannot know in advance; it still
    // says there is a wire, and which, rather than leaving the corner empty.
    render(<Marks vendor={{ transports: ['shelly/rpc'], internetRequired: false }} />);

    expect(screen.getByRole('img', { name: 'Speaks its own protocol, shelly/rpc' })).toBeTruthy();
  });

  it('says so when the internet is needed', () => {
    render(<Marks vendor={{ transports: ['http'], internetRequired: true }} />);

    expect(screen.getByRole('img', { name: 'Needs the internet' })).toBeTruthy();
  });
});
