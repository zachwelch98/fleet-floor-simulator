/**
 * Developer tests for the TickScheduler, play/pause endpoints and the socket.io FloorGateway.
 * A ManualTickTimer replaces real timers, so nothing sleeps; socket events are awaited with a timeout.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TICK_INTERVAL_MS,
  MAX_TICK_INTERVAL_MS,
  MIN_TICK_INTERVAL_MS,
  SocketEvents,
} from '@fleet/protocol';
import type {
  CommandSuccess,
  FloorDto,
  FloorUpdatedPayload,
  HistoryEntry,
  PlaybackPayload,
} from '@fleet/protocol';
import { createApp } from '../../src/app.factory.js';
import { ManualTickTimer } from '../../src/tick-timer.js';

const fixed = new Date('2026-01-02T03:04:05.000Z');

const apps: INestApplication[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }
  while (apps.length > 0) {
    await apps.pop()?.close();
  }
});

async function setup(): Promise<{ app: INestApplication; timer: ManualTickTimer }> {
  const timer = new ManualTickTimer();
  const app = await createApp({ dbPath: ':memory:', now: () => fixed, timer });
  apps.push(app);
  return { app, timer };
}

const api = (app: INestApplication) => request(app.getHttpServer());
const play = (app: INestApplication, body?: unknown, floorId = 'main') =>
  api(app)
    .post(`/api/floors/${floorId}/play`)
    .send(body as object);
const pause = (app: INestApplication, floorId = 'main') =>
  api(app).post(`/api/floors/${floorId}/pause`).send();
const getFloor = async (app: INestApplication): Promise<FloorDto> =>
  (await api(app).get('/api/floors/main')).body as FloorDto;
const getHistory = async (app: INestApplication): Promise<HistoryEntry[]> =>
  (await api(app).get('/api/floors/main/history')).body as HistoryEntry[];

describe('play / pause endpoints and TickScheduler', () => {
  it('Play starts one timer, reports playing, and each firing is one ordinary tick', async () => {
    const { app, timer } = await setup();
    const before = await getFloor(app);

    const res = await play(app, { intervalMs: 250 });
    expect(res.status).toBe(200);
    const dto = res.body as FloorDto;
    expect(dto).toMatchObject({
      id: 'main',
      playing: true,
      intervalMs: 250,
      version: before.version,
    });
    expect(timer.active).toEqual([{ intervalMs: 250 }]);
    expect(await getFloor(app)).toEqual(dto);

    timer.fire(3);
    const after = await getFloor(app);
    expect(after.version).toBe(before.version + 3);
    expect(after.state.tick).toBe(before.state.tick + 3);
    expect(after.playing).toBe(true);
    expect((await getHistory(app)).filter((h) => h.event.type === 'TICK_RESOLVED').length).toBe(3);
  });

  it('Play is idempotent: same interval, with or without a body, keeps the single timer', async () => {
    const { app, timer } = await setup();
    await play(app, { intervalMs: 300 });
    await play(app, { intervalMs: 300 });
    await play(app);
    await play(app, {});
    expect(timer.active).toEqual([{ intervalMs: 300 }]);
    timer.fire();
    expect((await getFloor(app)).state.tick).toBe(1);
  });

  it('Play with a different interval restarts that one timer', async () => {
    const { app, timer } = await setup();
    await play(app, { intervalMs: 300 });
    const res = await play(app, { intervalMs: 700 });
    expect((res.body as FloorDto).intervalMs).toBe(700);
    expect(timer.active).toEqual([{ intervalMs: 700 }]);
    timer.fire();
    expect((await getFloor(app)).state.tick).toBe(1);
  });

  it('Pause clears the timer, keeps the interval, and the next bare Play reuses it', async () => {
    const { app, timer } = await setup();
    await play(app, { intervalMs: 400 });
    const paused = await pause(app);
    expect(paused.status).toBe(200);
    expect(paused.body).toMatchObject({ playing: false, intervalMs: 400 });
    expect(timer.active).toEqual([]);
    timer.fire(2);
    expect((await getFloor(app)).state.tick).toBe(0);

    expect((await pause(app)).status).toBe(200); // idempotent
    const again = await play(app);
    expect(again.body).toMatchObject({ playing: true, intervalMs: 400 });
    expect(timer.active).toEqual([{ intervalMs: 400 }]);
  });

  it('Pause on a never-played floor leaves the default interval', async () => {
    const { app } = await setup();
    expect((await pause(app)).body).toMatchObject({
      playing: false,
      intervalMs: DEFAULT_TICK_INTERVAL_MS,
    });
  });

  it('Play and Pause never bump the version or write history', async () => {
    const { app } = await setup();
    const before = { floor: await getFloor(app), history: await getHistory(app) };
    await play(app, { intervalMs: 200 });
    await pause(app);
    const floor = await getFloor(app);
    expect(floor.version).toBe(before.floor.version);
    expect(floor.state).toEqual(before.floor.state);
    expect(await getHistory(app)).toEqual(before.history);
  });

  it('clamps intervalMs to [MIN, MAX]', async () => {
    const { app, timer } = await setup();
    expect(((await play(app, { intervalMs: 1 })).body as FloorDto).intervalMs).toBe(
      MIN_TICK_INTERVAL_MS,
    );
    expect(((await play(app, { intervalMs: 99_999 })).body as FloorDto).intervalMs).toBe(
      MAX_TICK_INTERVAL_MS,
    );
    expect(timer.active).toEqual([{ intervalMs: MAX_TICK_INTERVAL_MS }]);
  });

  it.each([
    ['a string interval', { intervalMs: '500' }],
    ['a null interval', { intervalMs: null }],
    ['a boolean interval', { intervalMs: true }],
    ['a non-object body', [1, 2]],
  ])('rejects %s with 400 and starts nothing', async (_name, body) => {
    const { app, timer } = await setup();
    const res = await play(app, body);
    expect(res.status).toBe(400);
    expect(timer.active).toEqual([]);
    expect((await getFloor(app)).playing).toBe(false);
  });

  it('rejects a non-JSON body with 400', async () => {
    const { app } = await setup();
    const res = await api(app)
      .post('/api/floors/main/play')
      .set('Content-Type', 'application/json')
      .send('{nope');
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown floor and starts nothing', async () => {
    const { app, timer } = await setup();
    expect((await play(app, { intervalMs: 300 }, 'nope')).status).toBe(404);
    expect((await pause(app, 'nope')).status).toBe(404);
    expect(timer.active).toEqual([]);
  });

  it('POST /step still works while playing (DECISIONS 7.6)', async () => {
    const { app, timer } = await setup();
    await play(app);
    const res = await api(app).post('/api/floors/main/step').send();
    expect(res.status).toBe(200);
    expect((res.body as CommandSuccess).floor.playing).toBe(true);
    timer.fire();
    expect((await getFloor(app)).state.tick).toBe(2);
  });

  it('keeps playing across CREATE_FLOOR (DECISIONS 7.6)', async () => {
    const { app, timer } = await setup();
    await play(app);
    const res = await api(app)
      .post('/api/floors/main/commands')
      .send({ action: { type: 'CREATE_FLOOR', width: 5, height: 5 } });
    expect(res.status).toBe(200);
    expect((res.body as CommandSuccess).floor).toMatchObject({ playing: true });
    expect(timer.active.length).toBe(1);
  });

  it('close() clears every timer', async () => {
    const { app, timer } = await setup();
    await play(app);
    await app.close();
    apps.length = 0;
    expect(timer.active).toEqual([]);
  });

  it('playback is in memory only: a new app is paused at the default interval', async () => {
    const first = await setup();
    await play(first.app, { intervalMs: 900 });
    const second = await setup();
    expect(await getFloor(second.app)).toMatchObject({
      playing: false,
      intervalMs: DEFAULT_TICK_INTERVAL_MS,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// socket.io gateway
// ---------------------------------------------------------------------------------------------

async function connect(app: INestApplication): Promise<Socket> {
  const socket = io(await app.getUrl(), { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

async function listening(): Promise<{
  app: INestApplication;
  timer: ManualTickTimer;
  url: string;
}> {
  const ctx = await setup();
  await ctx.app.listen(0, '127.0.0.1');
  return { ...ctx, url: await ctx.app.getUrl() };
}

function join(socket: Socket, floorId: string): Promise<FloorDto | null> {
  return socket
    .timeout(5_000)
    .emitWithAck(SocketEvents.Join, { floorId }) as Promise<FloorDto | null>;
}

/** Records every event of the given names, in arrival order. */
function record(socket: Socket, names: readonly string[]) {
  const seen: { name: string; payload: unknown }[] = [];
  for (const name of names) {
    socket.on(name, (payload: unknown) => seen.push({ name, payload }));
  }
  return seen;
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const EVENTS = [SocketEvents.Updated, SocketEvents.Playback] as const;

describe('FloorGateway', () => {
  it('floor:join acks the current FloorDto', async () => {
    const { app } = await listening();
    const socket = await connect(app);
    expect(await join(socket, 'main')).toEqual(await getFloor(app));
  });

  it('joining an unknown floor acks null and joins no room', async () => {
    const { app } = await listening();
    const socket = await connect(app);
    const seen = record(socket, EVENTS);
    expect(await join(socket, 'nope')).toBeNull();
    expect(await join(socket, undefined as unknown as string)).toBeNull();
    await api(app).post('/api/floors/main/step').send();
    await api(app).post('/api/floors/nope/step').send();
    // Round trip on the same socket: anything emitted before this ack has arrived by now.
    await join(socket, 'nope');
    expect(seen).toEqual([]);
  });

  it('broadcasts floor:updated to every client in the room, sender included, in version order', async () => {
    const { app } = await listening();
    const [a, b] = [await connect(app), await connect(app)];
    const seenA = record(a, EVENTS);
    const seenB = record(b, EVENTS);
    await join(a, 'main');
    await join(b, 'main');

    const send = (action: object) => api(app).post('/api/floors/main/commands').send({ action });
    const r1 = await send({ type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    const r2 = await api(app).post('/api/floors/main/step').send();
    await until(() => seenA.length === 2 && seenB.length === 2, 'two floor:updated');

    for (const seen of [seenA, seenB]) {
      expect(seen.map((s) => s.name)).toEqual([SocketEvents.Updated, SocketEvents.Updated]);
      const payloads = seen.map((s) => s.payload as FloorUpdatedPayload);
      expect(payloads[0]).toEqual({
        floor: (r1.body as CommandSuccess).floor,
        history: (r1.body as CommandSuccess).history,
      });
      expect(payloads[1]).toEqual({
        floor: (r2.body as CommandSuccess).floor,
        history: (r2.body as CommandSuccess).history,
      });
      expect(payloads[1]?.floor.version).toBe((payloads[0]?.floor.version ?? 0) + 1);
    }
  });

  it('does not broadcast rejected or malformed commands', async () => {
    const { app } = await listening();
    const socket = await connect(app);
    const seen = record(socket, EVENTS);
    await join(socket, 'main');
    const send = (body: object) => api(app).post('/api/floors/main/commands').send(body);
    expect((await send({ action: { type: 'REMOVE_ROBOT', id: 'R9' } })).status).toBe(409);
    expect((await send({ action: { type: 'NOPE' } })).status).toBe(400);
    // barrier: one real commit, which must be the first and only event
    await send({ action: { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'EAST' } });
    await until(() => seen.length === 1, 'the barrier commit');
    expect(seen).toHaveLength(1);
  });

  it('a scheduler tick broadcasts floor:updated like any commit', async () => {
    const { app, timer } = await listening();
    const socket = await connect(app);
    const seen = record(socket, [SocketEvents.Updated]);
    await join(socket, 'main');
    await play(app);
    timer.fire(2);
    await until(() => seen.length === 2, 'two ticks');
    const versions = seen.map((s) => (s.payload as FloorUpdatedPayload).floor.version);
    expect(versions[1]).toBe((versions[0] ?? 0) + 1);
    expect((seen[0]?.payload as FloorUpdatedPayload).floor.playing).toBe(true);
  });

  it('floor:playback fires only when playing or intervalMs really changes', async () => {
    const { app } = await listening();
    const socket = await connect(app);
    const seen = record(socket, EVENTS);
    await join(socket, 'main');

    await pause(app); // already paused: silent
    await play(app, { intervalMs: 300 }); // change
    await play(app, { intervalMs: 300 }); // silent
    await play(app); // silent
    await play(app, { intervalMs: 600 }); // interval change
    await pause(app); // change
    await pause(app); // silent
    await api(app).post('/api/floors/main/step').send(); // barrier

    await until(() => seen.some((s) => s.name === SocketEvents.Updated), 'the barrier');
    const playback = seen
      .filter((s) => s.name === SocketEvents.Playback)
      .map((s) => s.payload as PlaybackPayload);
    expect(playback).toEqual([
      { floorId: 'main', playing: true, intervalMs: 300 },
      { floorId: 'main', playing: true, intervalMs: 600 },
      { floorId: 'main', playing: false, intervalMs: 600 },
    ]);
  });

  it('floor:leave stops delivery; leaving a room you are not in is a no-op', async () => {
    const { app } = await listening();
    const socket = await connect(app);
    const other = await connect(app);
    const seen = record(socket, EVENTS);
    const seenOther = record(other, EVENTS);
    await join(socket, 'main');
    await join(other, 'main');
    socket.emit(SocketEvents.Leave, { floorId: 'nope' });
    socket.emit(SocketEvents.Leave, { floorId: 'main' });
    socket.emit(SocketEvents.Leave, { floorId: 'main' });
    await join(socket, 'nope'); // the server has processed the leaves (same-socket order)
    await api(app).post('/api/floors/main/step').send();
    await until(() => seenOther.length === 1, 'the other client to get the tick');
    expect(seen).toEqual([]);
  });

  it('a client that did not join receives nothing', async () => {
    const { app } = await listening();
    const lurker = await connect(app);
    const member = await connect(app);
    const seen = record(lurker, EVENTS);
    const seenMember = record(member, EVENTS);
    await join(member, 'main');
    await play(app);
    await api(app).post('/api/floors/main/step').send();
    await until(() => seenMember.length >= 2, 'member events');
    expect(seen).toEqual([]);
  });

  it('allows the dev UI origin via CORS on the socket.io handshake', async () => {
    const { url } = await listening();
    const res = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'http://localhost:4200' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4200');
  });

  it('app.close() disconnects clients and shuts down cleanly', async () => {
    const { app } = await listening();
    const socket = await connect(app);
    const disconnected = new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
    await app.close();
    apps.length = 0;
    await disconnected;
  });
});
