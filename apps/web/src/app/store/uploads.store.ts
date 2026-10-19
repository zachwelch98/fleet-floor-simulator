import { Injectable, computed, signal } from '@angular/core';
import { buildScenario, type ScenarioDef } from '../core/scenarios';

/** localStorage key (DECISIONS 5.8). */
export const UPLOADS_KEY = 'fleet.scenarioUploads.v1';
export const MAX_UPLOAD_BYTES = 64 * 1024;
export const MAX_UPLOADS = 20;

/** What is stored for one upload: the script, and the `.expected` file once one is attached. */
export interface StoredUpload {
  readonly id: string;
  readonly fileName: string;
  readonly text: string;
  readonly expectedText?: string;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function slugOf(fileName: string): string {
  const slug = fileName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return slug === '' ? 'scenario' : slug;
}

function isStored(value: unknown): value is StoredUpload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    v['id'].startsWith('upload:') &&
    typeof v['fileName'] === 'string' &&
    typeof v['text'] === 'string' &&
    (v['expectedText'] === undefined || typeof v['expectedText'] === 'string')
  );
}

/** The browser's storage, or null when it is missing or blocked (private window, site data off). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStored(): StoredUpload[] {
  try {
    const raw = storage()?.getItem(UPLOADS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    const list =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { uploads?: unknown }).uploads
        : undefined;
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(isStored).slice(0, MAX_UPLOADS);
  } catch {
    return [];
  }
}

function tryBuild(upload: StoredUpload): ScenarioDef | null {
  try {
    return buildScenario(
      upload.id,
      upload.fileName,
      'uploaded',
      upload.text,
      upload.expectedText,
      upload.fileName,
    );
  } catch {
    return null;
  }
}

/**
 * Scenarios the user uploaded (DECISIONS 5.8). Kept in this browser's localStorage under one key;
 * every read and write is wrapped, so when storage is unavailable the uploads live in memory only.
 */
@Injectable({ providedIn: 'root' })
export class UploadsStore {
  private readonly stored = signal<readonly StoredUpload[]>(readStored());
  /** Built scenarios are cached per stored object (uploads are never mutated in place). */
  private readonly built = new WeakMap<StoredUpload, ScenarioDef | null>();

  /** The last upload problem, shown inline by the panel; cleared by the next successful action. */
  readonly error = signal<string | null>(null);

  readonly uploads = computed<readonly ScenarioDef[]>(() => {
    const out: ScenarioDef[] = [];
    for (const u of this.stored()) {
      let def = this.built.get(u);
      if (def === undefined) {
        def = tryBuild(u);
        this.built.set(u, def);
      }
      if (def) {
        out.push(def);
      }
    }
    return out;
  });

  clearError(): void {
    this.error.set(null);
  }

  /** Adds a scenario file. Returns it, or null (with `error` set) when it is refused. */
  add(fileName: string, text: string): ScenarioDef | null {
    const name = fileName.trim() === '' ? 'scenario' : fileName.trim();
    if (this.stored().length >= MAX_UPLOADS) {
      this.error.set(`You can keep up to ${MAX_UPLOADS} uploads. Remove one first.`);
      return null;
    }
    const tooBig = this.sizeProblem(name, text);
    if (tooBig) {
      this.error.set(tooBig);
      return null;
    }
    if (text.includes('\u0000')) {
      this.error.set(`${name} does not look like a text file.`);
      return null;
    }
    const upload: StoredUpload = { id: this.nextId(name), fileName: name, text };
    const def = tryBuild(upload);
    if (!def) {
      this.error.set(`${name} has too many ticks to run here.`);
      return null;
    }
    this.built.set(upload, def);
    this.error.set(null);
    this.stored.update((list) => [...list, upload]);
    this.persist();
    return def;
  }

  /** Attaches (or replaces) the `.expected` file of an upload. Returns the rebuilt scenario. */
  attachExpected(id: string, text: string): ScenarioDef | null {
    const current = this.stored().find((u) => u.id === id);
    if (!current) {
      return null;
    }
    const tooBig = this.sizeProblem('The expected file', text);
    if (tooBig) {
      this.error.set(tooBig);
      return null;
    }
    if (text.includes('\u0000')) {
      this.error.set('The expected file does not look like a text file.');
      return null;
    }
    const next: StoredUpload = { ...current, expectedText: text };
    const def = tryBuild(next);
    if (!def) {
      return null;
    }
    this.built.set(next, def);
    this.error.set(null);
    this.stored.update((list) => list.map((u) => (u.id === id ? next : u)));
    this.persist();
    return def;
  }

  remove(id: string): void {
    if (!this.stored().some((u) => u.id === id)) {
      return;
    }
    this.error.set(null);
    this.stored.update((list) => list.filter((u) => u.id !== id));
    this.persist();
  }

  private sizeProblem(label: string, text: string): string | null {
    return byteLength(text) > MAX_UPLOAD_BYTES
      ? `${label} is larger than ${MAX_UPLOAD_BYTES / 1024} KB.`
      : null;
  }

  /** `upload:<slug>-<n>` with n one past the highest in use, so ids are never reused after a Remove. */
  private nextId(fileName: string): string {
    const slug = slugOf(fileName);
    let max = 0;
    for (const u of this.stored()) {
      const m = /-(\d+)$/.exec(u.id);
      if (m) {
        max = Math.max(max, Number(m[1]));
      }
    }
    return `upload:${slug}-${max + 1}`;
  }

  private persist(): void {
    try {
      storage()?.setItem(UPLOADS_KEY, JSON.stringify({ uploads: this.stored() }));
    } catch {
      // Storage full or blocked: the uploads stay in memory for this session.
    }
  }
}
