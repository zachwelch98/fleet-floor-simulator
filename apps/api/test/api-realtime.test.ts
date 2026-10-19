/**
 * Module D, real time: two socket.io clients against an in-process app (DECISIONS 7.1-7.7).
 *
 * Written black-box from the protocol (`SocketEvents`, `FloorUpdatedPayload`, `PlaybackPayload`), the
 * `ManualTickTimer` contract and DECISIONS section 7. Nothing here sleeps: the app's Play timer is a
 * `ManualTickTimer` that only fires when the test calls `fire()`, and every "nothing else arrived" check
 * uses a fence (see `TestClient.fence`) instead of waiting for silence.
 *
 * Phase 3 note: until the scheduler and gateway exist these tests fail with "not implemented" symptoms
 * (404 on play/pause, a join that is never acknowledged).
 */
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Action } from '@fleet/engine';
import {
  API_PREFIX,
  DEFAULT_FLOOR_ID,
  DEFAULT_TICK_INTERVAL_MS,
  MAX_TICK_INTERVAL_MS,
  MIN_TICK_INTERVAL_MS,
  SocketEvents,
  type CommandRejected,
  type CommandSuccess,
  type FloorDto,
  type FloorUpdatedPayload,
  type PlaybackPayload,
} from '@fleet/protocol';
import { ManualTickTimer } from '../src/tick-timer.js';
import {
  getFloor,
  getHistory,
  http,
  listenOnLoopback,
  makeApp,
  mustOk,
  mustStep,
  post,
  postStep,
  removeDb,
  snapshotOf,
  tempDbPath,
} from './support.js';

const WAIT_MS = 5_000;
const floorUrl = (suffix: string, id = DEFAULT_FLOOR_ID) => `${API_PREFIX}/floors/${id}${suffix}`;

/** A socket.io client that records every floor event it receives, in arrival order. */
class TestClient {
  readonly updated: FloorUpdatedPayload[] = [];
  readonly playback: PlaybackPayload[] = [];
  private readonly listeners = new Set<() => void>();

  private constructor(readonly socket: Socket) {
    socket.on(SocketEvents.Updated, (payload: FloorUpdatedPayload) => {
      this.updated.push(payload);
      this.notify();
    });
    socket.on(SocketEvents.Playback, (payload: PlaybackPayload) => {
      this.playback.push(payload);
      this.notify();
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    const client = new TestClient(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket did not connect')), WAIT_MS);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return client;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Resolves once `condition` holds (checked now and after every event). Rejects after WAIT_MS. */
  waitUntil(condition: () => boolean, what: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const check = () => {
        if (!condition()) return;
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve();
      };
      const timer = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error(`timed out after ${WAIT_MS} ms waiting for ${what}`));
      }, WAIT_MS);
      this.listeners.add(check);
      check();
    });
  }

  waitForUpdates(count: number): Promise<void> {
    return this.waitUntil(
      () => this.updated.length >= count,
      `${count} ${SocketEvents.Updated} event(s) (have ${this.updated.length})`,
    );
  }

  waitForPlayback(count: number): Promise<void> {
    return this.waitUntil(
      () => this.playback.length >= count,
      `${count} ${SocketEvents.Playback} event(s) (have ${this.playback.length})`,
    );
  }

  /** floor:join with an ack. Resolves to the ack value (a FloorDto, or null for an unknown floor). */
  join(floorId = DEFAULT_FLOOR_ID): Promise<FloorDto | null> {
    return new Promise((resolve, reject) => {
      this.socket
        .timeout(WAIT_MS)
        .emit(SocketEvents.Join, { floorId }, (error: Error | null, ack: FloorDto | null) => {
          if (error) reject(new Error(`floor:join "${floorId}" was not acknowledged: ${error}`));
          else resolve(ack);
        });
    });
  }

  /** floor:leave has no ack in the protocol; follow it with `fence()` before asserting. */
  leave(floorId = DEFAULT_FLOOR_ID): void {
    this.socket.emit(SocketEvents.Leave, { floorId });
  }

  /**
   * A round trip through this socket. Messages on one socket are delivered in order, so when the fence
   * returns, every broadcast the server emitted to this client before the fence was processed has already
   * arrived. Joining an unknown floor is specified to ack `null` and change nothing (DECISIONS 7.7).
   */
  async fence(): Promise<void> {
    const ack = await this.join('fence-unknown-floor');
    expect(ack).toBeNull();
  }

  close(): void {
    this.socket.close();
  }
}

let app: INestApplication;
let timer: ManualTickTimer;
let url: string;
let a: TestClient;
let b: TestClient;
let appClosed: boolean;

beforeEach(async () => {
  timer = new ManualTickTimer();
  app = await makeApp(':memory:', timer);
  await listenOnLoopback(app);
  url = await app.getUrl();
  appClosed = false;
  a = await TestClient.connect(url);
  b = await TestClient.connect(url);
});

afterEach(async () => {
  // `a`/`b` are undefined when connecting failed (e.g. no gateway yet); keep the real error visible.
  (a as TestClient | undefined)?.close();
  (b as TestClient | undefined)?.close();
  if (!appClosed) await app.close();
});

async function joinBoth(): Promise<void> {
  expect(await a.join()).not.toBeNull();
  expect(await b.join()).not.toBeNull();
}

async function fenceBoth(): Promise<void> {
  await a.fence();
  await b.fence();
}

const play = (body?: unknown) => {
  const request = http(app).post(floorUrl('/play'));
  return body === undefined ? request.send() : request.send(body as object);
};
const pause = () => http(app).post(floorUrl('/pause')).send();

const place = (x: number, y: number, facing: 'NORTH' | 'EAST' | 'SOUTH' | 'WEST' = 'NORTH') =>
  ({ type: 'PLACE_ROBOT', x, y, facing }) satisfies Action;

describe('realtime: joining', () => {
  it('acks the FloorDto, equal to GET', async () => {
    const ack = await a.join();
    expect(ack).toEqual(await getFloor(app));
  });

  it('acks the up-to-date FloorDto after changes were made before joining', async () => {
    await mustOk(app, place(2, 2));
    await mustStep(app);
    const ack = await a.join();
    expect(ack).toEqual(await getFloor(app));
    expect(ack?.version).toBe(3);
  });

  it('acks null for an unknown floor and the socket then receives nothing', async () => {
    expect(await a.join('nope')).toBeNull();
    await mustOk(app, place(1, 1));
    await play({});
    await pause();
    await a.fence();
    expect(a.updated).toEqual([]);
    expect(a.playback).toEqual([]);
  });

  it('a client that did not join the floor receives no broadcasts', async () => {
    expect(await a.join()).not.toBeNull();
    await mustOk(app, place(1, 1));
    await a.waitForUpdates(1);
    await b.fence();
    expect(b.updated).toEqual([]);
  });

  it('joining twice does not duplicate deliveries', async () => {
    await a.join();
    await a.join();
    await mustOk(app, place(1, 1));
    await a.waitForUpdates(1);
    await a.fence();
    expect(a.updated).toHaveLength(1);
  });
});

describe('realtime: broadcasts of committed commands', () => {
  it('a committed command gives each client exactly one floor:updated equal to the REST response', async () => {
    await joinBoth();
    const result = await mustOk(app, place(3, 2, 'EAST'));
    await a.waitForUpdates(1);
    await b.waitForUpdates(1);
    await fenceBoth();
    for (const client of [a, b]) {
      expect(client.updated).toHaveLength(1);
      expect(client.updated[0]?.floor).toEqual(result.floor);
      expect(client.updated[0]?.history).toEqual(result.history);
    }
    expect(result.floor.version).toBe(2);
    // The broadcast floor is also what GET serves.
    expect(result.floor).toEqual(await getFloor(app));
  });

  it('every accepted action type is broadcast: payloads equal the responses, in version order', async () => {
    await joinBoth();
    const actions: Action[] = [
      place(0, 0, 'NORTH'),
      { type: 'SET_OBSTACLE', x: 5, y: 5, present: true },
      { type: 'TOGGLE_OBSTACLE', x: 6, y: 6 },
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'MOVE' }, { kind: 'LEFT' }] },
      { type: 'TICK' },
      { type: 'CLEAR_QUEUE', id: 'R1' },
      { type: 'REMOVE_ROBOT', id: 'R1' },
      { type: 'CREATE_FLOOR', width: 4, height: 4 },
    ];
    const responses: CommandSuccess[] = [];
    for (const action of actions) {
      const res = action.type === 'TICK' ? await postStep(app) : await post(app, action);
      expect(res.status, JSON.stringify(action)).toBe(200);
      responses.push(res.body as CommandSuccess);
    }
    await a.waitForUpdates(actions.length);
    await b.waitForUpdates(actions.length);
    await fenceBoth();
    for (const client of [a, b]) {
      expect(client.updated).toHaveLength(actions.length);
      expect(client.updated.map((u) => u.floor.version)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
      client.updated.forEach((payload, index) => {
        expect(payload.floor).toEqual(responses[index]?.floor);
        expect(payload.history).toEqual(responses[index]?.history);
      });
    }
  });

  it('a successful no-op still commits and is broadcast (DECISIONS 6.1c)', async () => {
    await joinBoth();
    await mustOk(app, { type: 'SET_OBSTACLE', x: 1, y: 1, present: true });
    await mustOk(app, { type: 'SET_OBSTACLE', x: 1, y: 1, present: true });
    await a.waitForUpdates(2);
    await b.waitForUpdates(2);
    await fenceBoth();
    expect(a.updated.map((u) => u.floor.version)).toEqual([2, 3]);
    expect(b.updated.map((u) => u.floor.version)).toEqual([2, 3]);
    expect(a.updated[1]?.history).toEqual([]);
  });

  it('rejected commands broadcast nothing and change nothing', async () => {
    await joinBoth();
    await mustOk(app, place(2, 2));
    await a.waitForUpdates(1);
    await b.waitForUpdates(1);
    const before = await snapshotOf(app);

    const occupied = await post(app, place(2, 2));
    expect(occupied.status).toBe(409);
    expect((occupied.body as CommandRejected).reason).toBe('CELL_OCCUPIED');
    const unknownRobot = await post(app, { type: 'CLEAR_QUEUE', id: 'R9' });
    expect(unknownRobot.status).toBe(409);
    const outOfBounds = await post(app, place(99, 99));
    expect(outOfBounds.status).toBe(409);

    await fenceBoth();
    expect(a.updated).toHaveLength(1);
    expect(b.updated).toHaveLength(1);
    expect(await snapshotOf(app)).toEqual(before);
  });

  it('malformed commands (400) broadcast nothing', async () => {
    await joinBoth();
    const bodies: unknown[] = [{}, { action: null }, { action: { type: 'DANCE' } }, { action: 5 }];
    for (const body of bodies) {
      const res = await http(app)
        .post(floorUrl('/commands'))
        .send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const notJson = await http(app)
      .post(floorUrl('/commands'))
      .set('Content-Type', 'text/plain')
      .send('hello');
    expect(notJson.status).toBe(400);
    await fenceBoth();
    expect(a.updated).toEqual([]);
    expect(b.updated).toEqual([]);
    expect((await getFloor(app)).version).toBe(1);
  });

  it('two simultaneous PLACEs on one cell: one 200, one 409 CELL_OCCUPIED, one broadcast each', async () => {
    await joinBoth();
    for (let round = 0; round < 5; round++) {
      const x = round;
      const [first, second] = await Promise.all([
        post(app, { type: 'PLACE_ROBOT', x, y: 3, facing: 'NORTH' }),
        post(app, { type: 'PLACE_ROBOT', x, y: 3, facing: 'SOUTH' }),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses, `round ${round}`).toEqual([200, 409]);
      const winner = first.status === 200 ? first : second;
      const loser = first.status === 200 ? second : first;
      const winnerBody = winner.body as CommandSuccess;
      const loserBody = loser.body as CommandRejected;
      expect(loserBody.ok).toBe(false);
      expect(loserBody.reason).toBe('CELL_OCCUPIED');
      // The loser is told the authoritative floor, which already contains the winner's robot.
      expect(loserBody.floor).toEqual(winnerBody.floor);
      expect(winnerBody.floor.version).toBe(round + 2);

      await a.waitForUpdates(round + 1);
      await b.waitForUpdates(round + 1);
      await fenceBoth();
      for (const client of [a, b]) {
        expect(client.updated, `round ${round}`).toHaveLength(round + 1);
        expect(client.updated[round]?.floor).toEqual(winnerBody.floor);
        expect(client.updated[round]?.history).toEqual(winnerBody.history);
      }
    }
  });

  it('10 simultaneous PLACEs on distinct cells are broadcast once each, in version order', async () => {
    await joinBoth();
    const results = await Promise.all(Array.from({ length: 10 }, (_, x) => post(app, place(x, 0))));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    await a.waitForUpdates(10);
    await b.waitForUpdates(10);
    await fenceBoth();
    for (const client of [a, b]) {
      expect(client.updated.map((u) => u.floor.version)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    }
  });
});

describe('realtime: leaving rooms', () => {
  it('floor:leave stops delivery to that client only', async () => {
    await joinBoth();
    b.leave();
    await b.fence();
    await mustOk(app, place(1, 1));
    await a.waitForUpdates(1);
    await fenceBoth();
    expect(a.updated).toHaveLength(1);
    expect(b.updated).toEqual([]);
    // Playback events stop too.
    await play({ intervalMs: 300 });
    await a.waitForPlayback(1);
    await fenceBoth();
    expect(b.playback).toEqual([]);
  });

  it('a client can rejoin after leaving and receives later broadcasts again', async () => {
    await joinBoth();
    b.leave();
    await b.fence();
    await mustOk(app, place(1, 1));
    expect(await b.join()).toEqual(await getFloor(app));
    await mustOk(app, place(2, 2));
    await b.waitForUpdates(1);
    await b.fence();
    expect(b.updated).toHaveLength(1);
    expect(b.updated[0]?.floor.version).toBe(3);
  });

  it('floor:leave for a room the socket is not in is a no-op (the socket stays usable)', async () => {
    b.leave('nope');
    b.leave(); // never joined "main" either
    await b.fence();
    expect(b.socket.connected).toBe(true);
    expect(await b.join()).toEqual(await getFloor(app));
  });
});

describe('realtime: Play, Pause and the one server clock', () => {
  it('Play from two users at once starts exactly one interval and broadcasts one floor:playback', async () => {
    await joinBoth();
    const [first, second] = await Promise.all([
      play({ intervalMs: 250 }),
      play({ intervalMs: 250 }),
    ]);
    for (const res of [first, second]) {
      expect(res.status).toBe(200);
      const dto = res.body as FloorDto;
      expect(dto.playing).toBe(true);
      expect(dto.intervalMs).toBe(250);
    }
    expect(timer.active).toEqual([{ intervalMs: 250 }]);
    await a.waitForPlayback(1);
    await b.waitForPlayback(1);
    await fenceBoth();
    for (const client of [a, b]) {
      expect(client.playback).toEqual([
        { floorId: DEFAULT_FLOOR_ID, playing: true, intervalMs: 250 },
      ]);
      expect(client.updated).toEqual([]); // starting to play commits nothing
    }
    expect(await getFloor(app)).toMatchObject({ playing: true, intervalMs: 250, version: 1 });
  });

  it('Play, Pause and interval changes never bump the version or write history', async () => {
    await mustOk(app, place(1, 1));
    const before = await snapshotOf(app);
    await play({ intervalMs: 300 });
    await play({ intervalMs: 800 });
    await play({ intervalMs: 800 });
    await pause();
    await pause();
    const after = await snapshotOf(app);
    expect(after.floor.version).toBe(before.floor.version);
    expect(after.floor.state).toEqual(before.floor.state);
    expect(after.history).toEqual(before.history);
  });

  it('timer.fire() commits one TICK per firing: version +1, floor:updated to both, in version order', async () => {
    await joinBoth();
    await mustOk(app, place(0, 0, 'NORTH'));
    await mustOk(app, {
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'MOVE' }, { kind: 'MOVE' }, { kind: 'MOVE' }],
    });
    await a.waitForUpdates(2);
    await b.waitForUpdates(2);
    await play({ intervalMs: 200 });
    expect(timer.active).toHaveLength(1);

    timer.fire();
    await a.waitForUpdates(3);
    await b.waitForUpdates(3);
    await fenceBoth();
    for (const client of [a, b]) {
      expect(client.updated).toHaveLength(3);
      const tick = client.updated[2];
      expect(tick?.floor.version).toBe(4);
      expect(tick?.floor.state.tick).toBe(1);
      expect(tick?.floor.playing).toBe(true);
      expect(tick?.history.map((h) => h.event.type)).toEqual(['TICK_RESOLVED']);
      expect(tick?.floor.state.robots[0]).toMatchObject({ x: 0, y: 1 });
    }
    expect(await getFloor(app)).toEqual(a.updated[2]?.floor);

    timer.fire(2);
    await a.waitForUpdates(5);
    await b.waitForUpdates(5);
    await fenceBoth();
    for (const client of [a, b]) {
      expect(client.updated.map((u) => u.floor.version)).toEqual([2, 3, 4, 5, 6]);
      expect(client.updated.map((u) => u.floor.state.tick)).toEqual([0, 0, 1, 2, 3]);
      expect(client.updated[4]?.floor.state.robots[0]).toMatchObject({ x: 0, y: 3 });
      // History seq is strictly increasing across broadcasts.
      const seqs = client.updated.flatMap((u) => u.history.map((h) => h.seq));
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
      expect(new Set(seqs).size).toBe(seqs.length);
    }
    // Ticks from Play are ordinary commits: the stored history shows them.
    const ticks = (await getHistory(app)).filter((h) => h.event.type === 'TICK_RESOLVED');
    expect(ticks.map((h) => h.tick)).toEqual([1, 2, 3]);
  });

  it('Play with a different interval restarts the one interval and broadcasts the new playback', async () => {
    await joinBoth();
    await play({ intervalMs: 200 });
    expect(timer.active).toEqual([{ intervalMs: 200 }]);
    const res = await play({ intervalMs: 700 });
    expect(res.status).toBe(200);
    expect((res.body as FloorDto).intervalMs).toBe(700);
    expect(timer.active).toEqual([{ intervalMs: 700 }]);
    await a.waitForPlayback(2);
    await b.waitForPlayback(2);
    await fenceBoth();
    for (const client of [a, b]) {
      expect(client.playback).toEqual([
        { floorId: DEFAULT_FLOOR_ID, playing: true, intervalMs: 200 },
        { floorId: DEFAULT_FLOOR_ID, playing: true, intervalMs: 700 },
      ]);
    }
    // The old interval is really gone: a single fire is a single tick.
    timer.fire();
    await a.waitForUpdates(1);
    await fenceBoth();
    expect(a.updated).toHaveLength(1);
    expect((await getFloor(app)).version).toBe(2);
  });

  it('Play with the same interval again is silent but still returns 200 with the current FloorDto', async () => {
    await joinBoth();
    await play({ intervalMs: 400 });
    await a.waitForPlayback(1);
    await b.waitForPlayback(1);
    const again = await play({ intervalMs: 400 });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(await getFloor(app));
    expect((again.body as FloorDto).playing).toBe(true);
    const noBody = await play();
    expect(noBody.status).toBe(200);
    expect((noBody.body as FloorDto).intervalMs).toBe(400);
    await fenceBoth();
    expect(a.playback).toHaveLength(1);
    expect(b.playback).toHaveLength(1);
    expect(timer.active).toEqual([{ intervalMs: 400 }]);
  });

  it('Pause clears the interval, broadcasts once, and a repeated Pause is silent', async () => {
    await joinBoth();
    await play({ intervalMs: 600 });
    await a.waitForPlayback(1);
    await b.waitForPlayback(1);

    const first = await pause();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ playing: false, intervalMs: 600 });
    expect(timer.active).toEqual([]);
    await a.waitForPlayback(2);
    await b.waitForPlayback(2);

    const second = await pause();
    expect(second.status).toBe(200);
    expect((second.body as FloorDto).playing).toBe(false);
    await fenceBoth();
    for (const client of [a, b]) {
      expect(client.playback).toEqual([
        { floorId: DEFAULT_FLOOR_ID, playing: true, intervalMs: 600 },
        { floorId: DEFAULT_FLOOR_ID, playing: false, intervalMs: 600 },
      ]);
    }
    // Nothing ticks any more.
    timer.fire(3);
    await fenceBoth();
    expect(a.updated).toEqual([]);
    expect((await getFloor(app)).version).toBe(1);
  });

  it('Pause on a floor that was never playing is a silent 200', async () => {
    await joinBoth();
    const res = await pause();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(await getFloor(app));
    await fenceBoth();
    expect(a.playback).toEqual([]);
    expect(b.playback).toEqual([]);
    expect(timer.active).toEqual([]);
  });

  it('keeps intervalMs while paused: Play without a value reuses it (DECISIONS 7.5)', async () => {
    expect((await getFloor(app)).intervalMs).toBe(DEFAULT_TICK_INTERVAL_MS);
    await play({ intervalMs: 700 });
    await pause();
    expect(await getFloor(app)).toMatchObject({ playing: false, intervalMs: 700 });
    const res = await play();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ playing: true, intervalMs: 700 });
    expect(timer.active).toEqual([{ intervalMs: 700 }]);
    await pause();
    const withEmptyObject = await play({});
    expect(withEmptyObject.status).toBe(200);
    expect(withEmptyObject.body).toMatchObject({ playing: true, intervalMs: 700 });
    expect(timer.active).toEqual([{ intervalMs: 700 }]);
  });

  it('first Play without a value uses the default interval', async () => {
    const res = await play();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ playing: true, intervalMs: DEFAULT_TICK_INTERVAL_MS });
    expect(timer.active).toEqual([{ intervalMs: DEFAULT_TICK_INTERVAL_MS }]);
  });

  it.each([
    ['below the minimum', 1, MIN_TICK_INTERVAL_MS],
    ['zero', 0, MIN_TICK_INTERVAL_MS],
    ['negative', -500, MIN_TICK_INTERVAL_MS],
    ['the minimum', MIN_TICK_INTERVAL_MS, MIN_TICK_INTERVAL_MS],
    ['the maximum', MAX_TICK_INTERVAL_MS, MAX_TICK_INTERVAL_MS],
    ['above the maximum', 999_999, MAX_TICK_INTERVAL_MS],
  ])('clamps an intervalMs %s (%d) to %d', async (_name, requested, expected) => {
    await joinBoth();
    const res = await play({ intervalMs: requested });
    expect(res.status).toBe(200);
    expect((res.body as FloorDto).intervalMs).toBe(expected);
    expect(timer.active).toEqual([{ intervalMs: expected }]);
    await a.waitForPlayback(1);
    expect(a.playback[0]).toEqual({
      floorId: DEFAULT_FLOOR_ID,
      playing: true,
      intervalMs: expected,
    });
  });

  it.each([
    ['a string', { intervalMs: '500' }],
    ['null', { intervalMs: null }],
    ['a boolean', { intervalMs: true }],
    ['an object', { intervalMs: { ms: 500 } }],
    ['an array', { intervalMs: [500] }],
  ])('rejects a non-number intervalMs (%s) with 400 and starts nothing', async (_name, body) => {
    await joinBoth();
    const res = await play(body);
    expect(res.status).toBe(400);
    await fenceBoth();
    expect(timer.active).toEqual([]);
    expect(a.playback).toEqual([]);
    expect(await getFloor(app)).toMatchObject({
      playing: false,
      intervalMs: DEFAULT_TICK_INTERVAL_MS,
    });
  });

  it.each([
    ['a JSON string', '"fast"'],
    ['a JSON number', '5'],
  ])('rejects a non-object body (%s) with 400', async (_name, raw) => {
    const res = await http(app)
      .post(floorUrl('/play'))
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(res.status).toBe(400);
    expect(timer.active).toEqual([]);
  });

  it('a 400 while playing leaves the running interval untouched', async () => {
    await play({ intervalMs: 300 });
    const res = await play({ intervalMs: 'soon' });
    expect(res.status).toBe(400);
    expect(timer.active).toEqual([{ intervalMs: 300 }]);
    expect(await getFloor(app)).toMatchObject({ playing: true, intervalMs: 300 });
  });

  it('Play and Pause on an unknown floor are 404 and start no interval', async () => {
    const unknownPlay = await http(app).post(floorUrl('/play', 'nope')).send({ intervalMs: 300 });
    expect(unknownPlay.status).toBe(404);
    const unknownPause = await http(app).post(floorUrl('/pause', 'nope')).send();
    expect(unknownPause.status).toBe(404);
    expect(timer.active).toEqual([]);
  });

  it('POST /step is still accepted while playing (DECISIONS 7.6)', async () => {
    await joinBoth();
    await play({ intervalMs: 300 });
    const res = await postStep(app);
    expect(res.status).toBe(200);
    expect((res.body as CommandSuccess).floor.version).toBe(2);
    expect((res.body as CommandSuccess).floor.playing).toBe(true);
    await a.waitForUpdates(1);
    await fenceBoth();
    expect(a.updated).toHaveLength(1);
  });

  it('edits made while playing are allowed and broadcast (DECISIONS 7.3)', async () => {
    await joinBoth();
    await play({ intervalMs: 300 });
    await mustOk(app, place(4, 4));
    timer.fire();
    await a.waitForUpdates(2);
    await b.waitForUpdates(2);
    await fenceBoth();
    expect(a.updated.map((u) => u.floor.version)).toEqual([2, 3]);
    expect(b.updated.map((u) => u.floor.version)).toEqual([2, 3]);
  });

  it('CREATE_FLOOR while playing keeps playing (DECISIONS 7.6)', async () => {
    await joinBoth();
    await play({ intervalMs: 300 });
    const res = await mustOk(app, { type: 'CREATE_FLOOR', width: 5, height: 5 });
    expect(res.floor.playing).toBe(true);
    expect(res.floor.state).toMatchObject({ width: 5, height: 5, tick: 0 });
    expect(timer.active).toEqual([{ intervalMs: 300 }]);
    timer.fire();
    await a.waitForUpdates(2);
    await fenceBoth();
    expect(a.updated.map((u) => u.floor.state.tick)).toEqual([0, 1]);
  });

  it('a rejected command during Play changes nothing and does not stop the clock', async () => {
    await joinBoth();
    await mustOk(app, place(1, 1));
    await play({ intervalMs: 300 });
    await a.waitForUpdates(1);
    const rejected = await post(app, place(1, 1));
    expect(rejected.status).toBe(409);
    timer.fire();
    await a.waitForUpdates(2);
    await b.waitForUpdates(2);
    await fenceBoth();
    expect(a.updated.map((u) => u.floor.version)).toEqual([2, 3]);
  });
});

describe('realtime: shutdown and restart', () => {
  it('app.close() clears every active interval', async () => {
    await play({ intervalMs: 300 });
    expect(timer.active).toHaveLength(1);
    await app.close();
    appClosed = true;
    expect(timer.active).toEqual([]);
  });

  it('disconnects clients when the app closes', async () => {
    await joinBoth();
    const disconnected = new Promise<void>((resolve) =>
      a.socket.once('disconnect', () => resolve()),
    );
    await app.close();
    appClosed = true;
    await disconnected;
    expect(a.socket.connected).toBe(false);
  });

  it('after a restart the floor comes back paused with the default interval and no interval running (DECISIONS 6.2, 7.5)', async () => {
    await app.close();
    appClosed = true;
    const dbPath = tempDbPath();
    const firstTimer = new ManualTickTimer();
    const first = await makeApp(dbPath, firstTimer);
    try {
      await listenOnLoopback(first);
      expect((await http(first).post(floorUrl('/play')).send({ intervalMs: 900 })).status).toBe(
        200,
      );
      await mustOk(first, place(1, 1));
      expect(firstTimer.active).toEqual([{ intervalMs: 900 }]);
    } finally {
      await first.close();
    }
    expect(firstTimer.active).toEqual([]);

    const secondTimer = new ManualTickTimer();
    const second = await makeApp(dbPath, secondTimer);
    try {
      await listenOnLoopback(second);
      const dto = await getFloor(second);
      expect(dto).toMatchObject({
        playing: false,
        intervalMs: DEFAULT_TICK_INTERVAL_MS,
        version: 2,
      });
      expect(dto.state.robots).toHaveLength(1);
      expect(secondTimer.active).toEqual([]);
      secondTimer.fire();
      expect((await getFloor(second)).version).toBe(2);
    } finally {
      await second.close();
      removeDb(dbPath);
    }
  });
});

describe('realtime: several floors', () => {
  // The protocol has no endpoint that creates a second floor (CREATE_FLOOR replaces floor "main"'s world, and
  // commands on an unknown floor are 404), so independence between floors cannot be tested black-box yet.
  it.todo('two floors have independent rooms, intervals and versions');
});
