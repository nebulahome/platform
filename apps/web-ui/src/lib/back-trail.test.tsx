import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { cameFromIn, useBackTrail, useCameFrom, walk, type Move } from '@/lib/back-trail';
import { BackLink } from '@/routes/library/detail-page';

/**
 * A page with links to the others and, on a device, its way back.
 *
 * @returns The page.
 */
function Page() {
  const cameFrom = useCameFrom();

  return (
    <>
      <Link to="/devices/garage">garage</Link>
      <Link to="/dashboards/home">home</Link>
      <BackLink to={cameFrom ?? '/devices'}>{`back to ${cameFrom ?? 'none'}`}</BackLink>
    </>
  );
}

/**
 * The shell's part: records the trail around the pages.
 *
 * @returns The pages.
 */
function Shell() {
  useBackTrail();

  return (
    <Routes>
      <Route path="*" element={<Page />} />
    </Routes>
  );
}

describe('a page in the app', () => {
  it('goes back to where it was last opened from, and steps back from there', () => {
    render(
      <MemoryRouter initialEntries={['/devices']}>
        <Shell />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'garage' }));
    expect(screen.getByRole('link', { name: /^back to/u }).textContent).toBe('back to /devices');

    fireEvent.click(screen.getByRole('link', { name: 'home' }));
    fireEvent.click(screen.getByRole('link', { name: 'garage' }));
    expect(screen.getByRole('link', { name: /^back to/u }).textContent).toBe(
      'back to /dashboards/home',
    );

    // Home, which was opened from the garage the first time; then the garage, then the list.
    fireEvent.click(screen.getByRole('link', { name: /^back to/u }));
    expect(screen.getByRole('link', { name: /^back to/u }).textContent).toBe(
      'back to /devices/garage',
    );
    fireEvent.click(screen.getByRole('link', { name: /^back to/u }));
    expect(screen.getByRole('link', { name: /^back to/u }).textContent).toBe('back to /devices');
    fireEvent.click(screen.getByRole('link', { name: /^back to/u }));
    expect(screen.getByRole('link', { name: /^back to/u }).textContent).toBe('back to none');
  });
});

/**
 * Walks a tab through some moves from nowhere.
 *
 * @param moves - Each address, and how the tab got there.
 * @returns The trail.
 */
function walked(moves: readonly (readonly [string, Move])[]) {
  return moves.reduce<ReturnType<typeof walk>>(
    (visits, [href, move]) => walk(visits, { pathname: href.split('?')[0] ?? href, href }, move),
    [],
  );
}

describe('the trail of pages', () => {
  it('goes back to where a device was opened from, the list with its filters', () => {
    const visits = walked([
      ['/devices', 'push'],
      ['/devices?q=plug&sort=name', 'replace'],
      ['/devices/garage', 'push'],
    ]);

    expect(cameFromIn(visits, '/devices/garage')).toBe('/devices?q=plug&sort=name');
  });

  it('is not moved by what changes inside the page: a tab, an entity dialog', () => {
    const visits = walked([
      ['/integrations/shelly?tab=devices', 'push'],
      ['/devices/garage', 'push'],
      ['/devices/garage?tab=activity', 'replace'],
      ['/devices/garage?tab=activity&entity=switch.garage', 'push'],
      ['/devices/garage?tab=activity', 'replace'],
    ]);

    expect(cameFromIn(visits, '/devices/garage')).toBe('/integrations/shelly?tab=devices');
  });

  it('takes a part back to its parent, and the parent back to where it was opened from', () => {
    const toPart = walked([
      ['/integrations/solax', 'push'],
      ['/devices/inverter', 'push'],
      ['/devices/battery', 'push'],
    ]);

    expect(cameFromIn(toPart, '/devices/battery')).toBe('/devices/inverter');

    const backAtParent = walk(
      toPart,
      { pathname: '/devices/inverter', href: '/devices/inverter' },
      'back',
    );

    expect(cameFromIn(backAtParent, '/devices/inverter')).toBe('/integrations/solax');
  });

  it('follows the browser back, and a device opened again from somewhere else', () => {
    const visits = walked([
      ['/devices', 'push'],
      ['/devices/garage', 'push'],
      ['/dashboards/home', 'push'],
      ['/devices/garage', 'push'],
    ]);

    expect(cameFromIn(visits, '/devices/garage')).toBe('/dashboards/home');
    expect(
      cameFromIn(
        walk(visits, { pathname: '/dashboards/home', href: '/dashboards/home' }, 'back'),
        '/devices/garage',
      ),
    ).toBe('/devices');
  });

  it('lets a page replace the one it was on without becoming its origin', () => {
    const visits = walked([
      ['/aliases', 'push'],
      ['/aliases/new', 'push'],
      ['/aliases/heating', 'replace'],
    ]);

    expect(cameFromIn(visits, '/aliases/heating')).toBe('/aliases');
  });

  it('has nowhere to go back to from the first page of a tab', () => {
    expect(cameFromIn(walked([['/devices/garage', 'back']]), '/devices/garage')).toBeNull();
  });

  it('names the page before this one while the shell has not recorded this one yet', () => {
    expect(cameFromIn(walked([['/brokers/bluetooth', 'push']]), '/devices/garage')).toBe(
      '/brokers/bluetooth',
    );
  });
});
