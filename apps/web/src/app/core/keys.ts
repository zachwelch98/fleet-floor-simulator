/** Global keyboard map (UI_SPEC 5.2) as a pure decision, so it can be unit-tested without a DOM. */

export type KeyAction =
  | { readonly type: 'command'; readonly kind: 'MOVE' | 'LEFT' | 'RIGHT' }
  /** Arrow Down, or a held arrow: `preventDefault` only. */
  | { readonly type: 'swallow' }
  | { readonly type: 'disarm' }
  | { readonly type: 'deselect' };

export interface KeyContext {
  readonly hasSelection: boolean;
  readonly gotoArmed: boolean;
  readonly modalOpen: boolean;
}

export interface KeyInput {
  readonly key: string;
  readonly repeat: boolean;
  readonly defaultPrevented: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly target: EventTarget | null;
}

/**
 * Text-entry targets keep their own keys: every input type (range and number included) except
 * checkbox, so a focused checkbox does not swallow the arrow keys (UI_SPEC 5.2).
 */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') {
    return false;
  }
  const tag = el.tagName;
  if (tag === 'INPUT' && (el as HTMLInputElement).type === 'checkbox') {
    return false;
  }
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true ||
    (typeof el.closest === 'function' && el.closest('[contenteditable]') !== null)
  );
}

export function decideKey(event: KeyInput, ctx: KeyContext): KeyAction | null {
  if (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    ctx.modalOpen ||
    isTextEntry(event.target)
  ) {
    return null;
  }
  switch (event.key) {
    case 'ArrowUp':
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (!ctx.hasSelection) {
        return null;
      }
      if (event.repeat) {
        return { type: 'swallow' };
      }
      const kind = event.key === 'ArrowUp' ? 'MOVE' : event.key === 'ArrowLeft' ? 'LEFT' : 'RIGHT';
      return { type: 'command', kind };
    }
    case 'ArrowDown':
      return ctx.hasSelection ? { type: 'swallow' } : null;
    case 'Escape':
      if (ctx.gotoArmed) {
        return { type: 'disarm' };
      }
      return ctx.hasSelection ? { type: 'deselect' } : null;
    default:
      return null;
  }
}

/** Hands the keyboard back to the global handler: blur the focused text-entry control, if any (UI_SPEC 5.2). */
export function blurTextEntry(doc: Document = document): void {
  const active = doc.activeElement;
  if (active && active !== doc.body && isTextEntry(active)) {
    (active as HTMLElement).blur();
  }
}
