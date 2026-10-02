import "server-only";
import { readJson, writeJson } from "./store";
import type { BookedAppt } from "./types";

const key = (clientId: string) => `appointments/${clientId}.json`;
const queues = new Map<string, Promise<unknown>>();

export async function listBooked(clientId: string): Promise<BookedAppt[]> {
  return (await readJson<BookedAppt[]>(key(clientId))) ?? [];
}

/** Read-modify-write of a client's booked appointments, one at a time. */
export function withBooked<T>(clientId: string, fn: (list: BookedAppt[]) => T | Promise<T>): Promise<T> {
  const prev = queues.get(clientId) ?? Promise.resolve();
  const run = prev.then(async () => {
    const list = await listBooked(clientId);
    const result = await fn(list);
    await writeJson(key(clientId), list);
    return result;
  });
  queues.set(clientId, run.catch(() => undefined));
  return run;
}
