/** One write in flight, with only the newest pending snapshot per conversation.
 * Keep different conversations queued separately so switching threads cannot
 * drop a finished page. Deletes replace pending writes and wait for active ones.
 */
export function createThreadSaver<Snapshot, Result>(
  write: (id: string, snapshot: Snapshot) => Promise<unknown>,
  remove: (id: string) => Promise<Result>,
  onError: () => void,
) {
  const pending = new Map<string, () => Promise<void>>();
  const deleting = new Map<string, Promise<Result>>();
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending.size) {
        const [id, job] = pending.entries().next().value!;
        pending.delete(id);
        await job();
      }
    } finally {
      running = false;
    }
  }

  return {
    save(id: string, snapshot: Snapshot) {
      if (deleting.has(id)) return;
      pending.set(id, async () => {
        try {
          await write(id, snapshot);
        } catch {
          onError();
        }
      });
      void drain();
    },
    remove(id: string): Promise<Result> {
      const existing = deleting.get(id);
      if (existing) return existing;
      // Install the guard before starting the drain (which can run immediately).
      let resolve!: (result: Result) => void;
      let reject!: (error: unknown) => void;
      const result = new Promise<Result>((ok, fail) => { resolve = ok; reject = fail; });
      deleting.set(id, result);
      pending.set(id, async () => {
        try {
          resolve(await remove(id));
        } catch (error) {
          reject(error);
        } finally {
          deleting.delete(id);
        }
      });
      void drain();
      return result;
    },
  };
}
