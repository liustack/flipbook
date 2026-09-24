import { openSession, type Session } from '../src/engine/session.ts';

let shared: Promise<Session> | null = null;

/** One browser session per test file. */
export function session(): Promise<Session> {
    shared ??= openSession();
    return shared;
}

export async function closeSession(): Promise<void> {
    if (shared) await (await shared).close();
    shared = null;
}
