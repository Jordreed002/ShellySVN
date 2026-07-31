/**
 * The context menu's header — the prototype's `.hd`.
 *
 * Two things are worth defending here, and they pull in opposite directions:
 *
 *  1. The header must not change what a menu *is*. It names the entry you
 *     right-clicked; it is not a command, so it is not a button, cannot be
 *     tabbed to, and every caller that passes no header must render exactly the
 *     markup it rendered before the header existed.
 *  2. A monorepo path is longer than any menu. It has to truncate from the
 *     **left**, so `…/website/trunk/package.json` survives and the client folder
 *     is what gives way — losing the filename is the failure mode that made this
 *     a rule in the first place (SPEC, "Paths must never break the layout").
 */

import React from 'react';
import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileText } from 'lucide-react';

import {
  ContextMenu,
  getSubmenuPosition,
  type ContextMenuItem,
} from '../ui/ContextMenu';

const LONG_PATH = '^/clients/acme-corp/website/trunk/package.json';

const items: ContextMenuItem[] = [
  { id: 'open', label: 'Open', shortcut: '↵', onClick: vi.fn() },
  { id: 'sep', label: '', divider: true },
  { id: 'section', label: 'Working copy', divider: true },
  { id: 'checkout', label: 'Checkout…', command: 'svn checkout', onClick: vi.fn() },
];

function renderMenu(header?: { name: string; path: string }) {
  return render(
    <ContextMenu
      items={items}
      header={header ? { icon: FileText, ...header } : undefined}
      position={{ x: 10, y: 10 }}
      onClose={vi.fn()}
    />
  );
}

function menuElement(): HTMLElement {
  const menus = document.querySelectorAll('.context-menu');
  const menu = menus[menus.length - 1];
  if (!(menu instanceof HTMLElement)) throw new Error('The menu did not render');
  return menu;
}

afterEach(cleanup);

describe('ContextMenu header', () => {
  it('names the entry and shows its path in mono', () => {
    renderMenu({ name: 'package.json', path: LONG_PATH });

    expect(screen.getByText('package.json')).toBeInTheDocument();
    const path = screen.getByText(LONG_PATH);
    expect(path.closest('span')?.className).toContain('font-mono');
  });

  it('truncates the path from the left so the filename survives', () => {
    renderMenu({ name: 'package.json', path: LONG_PATH });

    // `<bdi>` keeps the string reading left-to-right inside the right-to-left
    // box; without it `^/` would be flung to the far end.
    const bdi = screen.getByText(LONG_PATH);
    expect(bdi.tagName).toBe('BDI');

    const line = bdi.parentElement;
    expect(line).not.toBeNull();
    expect(line?.style.direction).toBe('rtl');
    expect(line?.style.textAlign).toBe('left');
    expect(line?.className).toContain('truncate');
    // The whole path stays reachable even when the box eats the front of it.
    expect(line).toHaveAttribute('title', LONG_PATH);
  });

  it('is context, not an item: nothing in it is focusable or clickable', () => {
    renderMenu({ name: 'package.json', path: LONG_PATH });

    const header = screen.getByText('package.json').closest('div');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect((header as HTMLElement).querySelectorAll('[tabindex]')).toHaveLength(0);

    // The menu still offers exactly its two enabled items.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Open↵',
      'Checkout…svn checkout',
    ]);
  });

  it('leaves the items untouched — a menu with a header is the same menu plus a header', () => {
    const { unmount } = renderMenu();
    const withoutHeader = menuElement().innerHTML;
    unmount();

    renderMenu({ name: 'package.json', path: LONG_PATH });
    const withHeader = menuElement().innerHTML;

    expect(withHeader.endsWith(withoutHeader)).toBe(true);
  });

  it('renders no header node at all when a caller passes none', () => {
    renderMenu();
    const first = menuElement().firstElementChild;
    expect(first?.querySelector('button')).not.toBeNull();
    expect(menuElement().textContent).not.toContain('package.json');
  });
});

describe('ContextMenu submenus', () => {
  const withSubmenu: ContextMenuItem[] = [
    {
      id: 'copy-to',
      label: 'Copy to…',
      command: 'svn copy',
      submenu: [
        { id: 'heading', label: 'Copy this path to', divider: true },
        { id: 'branch', label: 'A new branch…', onClick: vi.fn() },
        { id: 'rule', label: '', divider: true },
        { id: 'head', label: 'From HEAD (r4838)', onClick: vi.fn() },
      ],
    },
  ];

  it('groups its choices instead of rendering a divider as an empty item', () => {
    render(
      <ContextMenu items={withSubmenu} position={{ x: 0, y: 0 }} onClose={vi.fn()} />
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: /Copy to/ }).parentElement as HTMLElement);

    expect(screen.getByText('Copy this path to')).toBeInTheDocument();
    // The heading and the rule are not clickable; the two real choices are.
    expect(
      screen
        .getAllByRole('button')
        .map((button) => button.textContent)
        .filter((text) => text !== 'Copy to…svn copy')
    ).toEqual(['A new branch…', 'From HEAD (r4838)']);
  });

  /*
   * The submenu renders in its own portal, because the menu scrolls when it is
   * taller than the window and a box that scrolls in one axis clips the other.
   * That makes the submenu "outside" the menu for a click-outside handler, and
   * closing on mousedown would eat the click that follows.
   */
  it('runs a submenu choice rather than closing before the click lands', () => {
    const onBranch = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        items={[{ id: 'copy-to', label: 'Copy to…', submenu: [{ id: 'branch', label: 'A new branch…', onClick: onBranch }] }]}
        position={{ x: 0, y: 0 }}
        onClose={onClose}
      />
    );

    fireEvent.mouseEnter(
      screen.getByRole('button', { name: /Copy to/ }).parentElement as HTMLElement
    );
    const choice = screen.getByRole('button', { name: 'A new branch…' });
    fireEvent.mouseDown(choice);
    fireEvent.click(choice);

    expect(onBranch).toHaveBeenCalledTimes(1);
    // Closed by the choice itself, not by the mousedown that preceded it.
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('getSubmenuPosition', () => {
  const size = { width: 208, height: 180 };
  const viewport = { width: 1000, height: 800 };

  it('sits just right of its row, slightly above it', () => {
    expect(getSubmenuPosition({ top: 300, right: 500, left: 240 }, size, viewport)).toEqual({
      left: 496,
      top: 295,
    });
  });

  it('flips to the left when the right edge has no room', () => {
    const { left } = getSubmenuPosition({ top: 300, right: 960, left: 700 }, size, viewport);
    expect(left).toBe(700 - 208 + 4);
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it('lifts a tall submenu so its bottom stays on screen', () => {
    const { top } = getSubmenuPosition({ top: 780, right: 500, left: 240 }, size, viewport);
    expect(top).toBe(800 - 180 - 8);
  });

  it('never places a submenu off the top or left, however cramped', () => {
    const cramped = getSubmenuPosition(
      { top: 0, right: 190, left: 0 },
      { width: 208, height: 900 },
      { width: 200, height: 400 }
    );
    expect(cramped.left).toBeGreaterThanOrEqual(0);
    expect(cramped.top).toBeGreaterThanOrEqual(0);
  });
});
