/**
 * The shared scenario run (DECISIONS 5.10): the tab driving a run publishes it, the server relays it
 * to the other sockets on the floor, hands it to a socket that joins later, and clears it when the
 * publisher leaves. Fences (a round trip on the same socket) stand in for "nothing else arrived".
 */
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FLOOR_ID,
  MAX_SHARED_SCENARIO_CHARS,
  SocketEvents,
  type FloorDto,
  type ScenarioRunPayload,
  type SharedScenarioRun,
} from '@fleet/protocol';
import { ManualTickTimer } from '../src/tick-timer.js';
import { listenOnLoopback, makeApp } from './support.js';

const WAIT_MS = 5_000;

class Client {
  readonly scenario: ScenarioRunPayload[] = [];
  private readonly listeners = new Set<() => void>();

  private constructor(readonly socket: Socket) {
    socket.on(SocketEvents.Scenario, (payload: ScenarioRunPayload) => {
      this.scenario.push(payload);
      for (const listener of [...this.listeners]) listener();
    });
  }

  static async connect(url: string): Promise<Client> {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return new Client(socket);
  }

  join(floorId = DEFAULT_FLOOR_ID): Promise<FloorDto | null> {
    return this.socket
      .timeout(WAIT_MS)
      .emitWithAck(SocketEvents.Join, { floorId }) as Promise<FloorDto | null>;
  }

  publish(run: unknown, floorId = DEFAULT_FLOOR_ID): void {
    this.socket.emit(SocketEvents.ScenarioPublish, { floorId, run });
  }

  /** A round trip: every event the server sent this socket before it has arrived. */
  async fence(): Promise<void> {
    expect(await this.join('fence-unknown-floor')).toBeNull();
  }

  waitFor(count: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.scenario.length < count) return;
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve();
      };
      const timer = setTimeout(
        () => reject(new Error(`waited for ${count} floor:scenario`)),
        WAIT_MS,
      );
      this.listeners.add(check);
      check();
    });
  }

  close(): void {
    this.socket.close();
  }
}

function sharedRun(over: Partial<SharedScenarioRun> = {}): SharedScenarioRun {
  return {
    id: 'brief-c',
    title: 'Brief c',
    group: 'brief',
    fileName: 'scenarios/brief-c.txt',
    text: 'PLACE R1 0,0,NORTH\nTICK\nREPORT\n',
    refused: false,
    live: [null],
    halted: null,
    cursor: 1,
    ...over,
  };
}

let app: INestApplication;
let url: string;
const clients: Client[] = [];

async function joined(): Promise<Client> {
  const client = await Client.connect(url);
  clients.push(client);
  expect(await client.join()).not.toBeNull();
  return client;
}

beforeEach(async () => {
  app = await makeApp(':memory:', new ManualTickTimer());
  await listenOnLoopback(app);
  url = await app.getUrl();
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await app.close();
});

describe('scenario relay', () => {
  it('relays a published run to the other sockets on the floor, not back to the sender', async () => {
    const a = await joined();
    const b = await joined();
    const run = sharedRun();
    a.publish(run);
    await b.waitFor(1);
    expect(b.scenario).toEqual([{ floorId: DEFAULT_FLOOR_ID, run }]);
    await a.fence();
    expect(a.scenario).toEqual([]);
  });

  it('gives a socket that joins later the current run', async () => {
    const a = await joined();
    const run = sharedRun({ live: [['R1 0,1,NORTH']], cursor: 3 });
    a.publish(run);
    await a.fence();
    const c = await joined();
    await c.waitFor(1);
    expect(c.scenario[0]?.run).toEqual(run);
  });

  it('clears the run when the publisher disconnects', async () => {
    const a = await joined();
    const b = await joined();
    a.publish(sharedRun());
    await b.waitFor(1);
    a.close();
    await b.waitFor(2);
    expect(b.scenario[1]?.run).toBeNull();
    const c = await joined();
    await c.fence();
    expect(c.scenario).toEqual([]);
  });

  it('ignores an end from a socket that is not driving the run', async () => {
    const a = await joined();
    const b = await joined();
    const run = sharedRun();
    a.publish(run);
    await b.waitFor(1);
    b.publish(null);
    await b.fence();
    const c = await joined();
    await c.waitFor(1);
    expect(c.scenario[0]?.run).toEqual(run);
  });

  it('drops a malformed or oversize run, and one from a socket outside the floor', async () => {
    const a = await joined();
    const b = await joined();
    const outsider = await Client.connect(url);
    clients.push(outsider);
    a.publish({ id: 'x' });
    a.publish(sharedRun({ text: 'x'.repeat(MAX_SHARED_SCENARIO_CHARS + 1) }));
    outsider.publish(sharedRun());
    await a.fence();
    await outsider.fence();
    await b.fence();
    expect(b.scenario).toEqual([]);
  });
});
