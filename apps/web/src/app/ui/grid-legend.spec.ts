import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGEND_BADGES } from '../core/copy';
import { GridLegend, LEGEND_OPEN_KEY, readLegendOpen, writeLegendOpen } from './grid-legend';

function mount(active: string[] = []) {
  const fixture = TestBed.createComponent(GridLegend);
  fixture.componentRef.setInput('active', new Set(active));
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { fixture, el, q };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GridLegend', () => {
  it('lists every badge from the copy table in two labelled groups, plus the grid symbols', () => {
    const { el, q } = mount();
    for (const e of LEGEND_BADGES) {
      const li = q(`legend-${e.text}`);
      expect(li, e.text).not.toBeNull();
      expect(li?.textContent).toContain(e.label);
      expect(li?.textContent).toContain(e.detail);
      expect(li?.getAttribute('data-group')).toBe(e.group);
    }
    expect(Array.from(el.querySelectorAll('h3')).map((h) => h.textContent?.trim())).toEqual([
      'On the grid',
      'Blocked last tick',
      'GOTO last tick',
    ]);
    expect(el.querySelectorAll('[data-code]')).toHaveLength(LEGEND_BADGES.length);
    expect(q('legend-robot')).not.toBeNull();
    expect(q('legend-obstacle')).not.toBeNull();
    expect(q('legend-goto-active')).not.toBeNull();
    expect(q('legend-goto-pending')).not.toBeNull();
  });

  it('uses the shared pill class for every badge', () => {
    const { el } = mount();
    expect(el.querySelectorAll('[data-code] .pill')).toHaveLength(LEGEND_BADGES.length);
  });

  it('marks only the badges on the floor as active, and says so in the summary', () => {
    const { el, q } = mount(['CT', 'BB']);
    const active = Array.from(el.querySelectorAll('[data-code][data-active="true"]')).map((li) =>
      li.getAttribute('data-code'),
    );
    expect(active).toEqual(['CT', 'BB']);
    expect(q('legend-WL')?.getAttribute('data-active')).toBe('false');
    expect(q('grid-legend')?.getAttribute('data-has-active')).toBe('true');
    expect(q('legend-on-floor')?.textContent?.trim()).toBe('· CT, BB on the floor');
  });

  it('shows everything at full strength and no summary note while nothing is active', () => {
    const { el, q } = mount();
    expect(el.querySelectorAll('[data-active="true"]')).toHaveLength(0);
    expect(q('grid-legend')?.getAttribute('data-has-active')).toBe('false');
    expect(q('legend-on-floor')).toBeNull();
  });

  it('has a rail of pills for the active codes only, in key order, and none while nothing is active', () => {
    const { el, q } = mount(['BB', 'CT']);
    const rail = q('legend-rail');
    expect(rail?.getAttribute('aria-hidden')).toBe('true');
    expect(
      Array.from(rail?.querySelectorAll('.pill') ?? []).map((p) =>
        p.getAttribute('data-rail-code'),
      ),
    ).toEqual(['CT', 'BB']);
    expect(rail?.querySelectorAll('[data-group="blocked"]')).toHaveLength(2);
    // The rail's pills do not count as key entries.
    expect(el.querySelectorAll('[data-code]')).toHaveLength(LEGEND_BADGES.length);

    const none = mount();
    expect(none.q('legend-rail')).toBeNull();
  });

  it('is open by default, and remembers a collapse', () => {
    const { fixture, q } = mount();
    const details = q('grid-legend') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    expect(localStorage.getItem(LEGEND_OPEN_KEY)).toBe('closed');

    TestBed.resetTestingModule();
    const again = mount();
    expect((again.q('grid-legend') as HTMLDetailsElement).open).toBe(false);
  });
});

describe('legend open state storage', () => {
  it('defaults to open, reads the stored choice, and writes it back', () => {
    expect(readLegendOpen()).toBe(true);
    writeLegendOpen(false);
    expect(localStorage.getItem(LEGEND_OPEN_KEY)).toBe('closed');
    expect(readLegendOpen()).toBe(false);
    writeLegendOpen(true);
    expect(readLegendOpen()).toBe(true);
  });

  it('treats an unknown stored value as open', () => {
    localStorage.setItem(LEGEND_OPEN_KEY, 'garbage');
    expect(readLegendOpen()).toBe(true);
  });

  it('falls back to open and does not throw when localStorage throws on every access', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readLegendOpen()).toBe(true);
    expect(() => writeLegendOpen(false)).not.toThrow();
  });

  it('falls back to open when the localStorage property itself throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(readLegendOpen()).toBe(true);
      expect(() => writeLegendOpen(false)).not.toThrow();
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original);
      }
    }
  });
});
