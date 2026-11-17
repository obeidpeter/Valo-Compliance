import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withPrivacyCaseLock,
  ErasureLockBusyError,
  type PrivacyLockClient,
  type PrivacyLockQuery,
} from "./valo-erasure-lock";

class Capacity {
  active = 0;
  peak = 0;
  private waiting: ((release: () => void) => void)[] = [];
  constructor(readonly maximum: number) {}
  private release() {
    let used = false;
    return () => {
      assert.equal(used, false);
      used = true;
      const next = this.waiting.shift();
      if (next) next(this.release());
      else this.active--;
    };
  }
  async take(): Promise<() => void> {
    if (this.active === this.maximum) return new Promise((resolve) => this.waiting.push(resolve));
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    return this.release();
  }
}

class LockPool {
  readonly slots: Capacity;
  readonly held = new Map<string, number>();
  readonly queries: { session: number; config: PrivacyLockQuery }[] = [];
  readonly releases: { session: number; destroy: boolean }[] = [];
  private serial = 0;
  constructor(
    maximum = 2,
    readonly fault?: "acquire_lost" | "acquire_unknown" | "unlock_lost" | "unlock_false",
  ) {
    this.slots = new Capacity(maximum);
  }
  async connect(): Promise<PrivacyLockClient> {
    const releaseSlot = await this.slots.take(),
      session = ++this.serial;
    return {
      query: async (config) => {
        this.queries.push({ session, config });
        assert.ok(Number.isFinite(config.query_timeout) && config.query_timeout > 0);
        const key = config.values[0]!;
        if (config.text.includes("pg_try_advisory_lock")) {
          if (this.held.has(key)) return { rows: [{ held: false }] };
          this.held.set(key, session);
          if (this.fault === "acquire_lost") throw Error("CONTROLLED_ACQUIRE_RESPONSE_LOST");
          if (this.fault === "acquire_unknown") return { rows: [] };
          return { rows: [{ held: true }] };
        }
        assert.match(config.text, /pg_advisory_unlock/);
        if (this.fault === "unlock_lost") throw Error("CONTROLLED_UNLOCK_RESPONSE_LOST");
        if (this.fault === "unlock_false") return { rows: [{ released: false }] };
        const owned = this.held.get(key) === session;
        if (owned) this.held.delete(key);
        return { rows: [{ released: owned }] };
      },
      release: (destroy) => {
        this.releases.push({ session, destroy: !!destroy });
        if (destroy) for (const [key, owner] of this.held) if (owner === session) this.held.delete(key);
        releaseSlot();
      },
    };
  }
}

test(
  "dedicated lock capacity two and shared data capacity one drain distinct-case work",
  { timeout: 2000 },
  async () => {
    const locks = new LockPool(2),
      data = new Capacity(1),
      completed: string[] = [];
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, n) =>
        withPrivacyCaseLock(locks, `case-${n}`, async () => {
          const release = await data.take();
          try {
            await new Promise<void>((resolve) => setImmediate(resolve));
            completed.push(`case-${n}`);
            return n;
          } finally {
            release();
          }
        }),
      ),
    );
    assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
    assert.equal(new Set(completed).size, 6);
    assert.equal(locks.slots.peak, 2);
    assert.equal(data.peak, 1);
    assert.equal(locks.slots.active, 0);
    assert.equal(data.active, 0);
    assert.equal(locks.held.size, 0);
    assert.equal(locks.releases.length, 6);
    assert.ok(locks.releases.every((r) => !r.destroy));
  },
);

test(
  "same-case conflict releases its slot without unlocking the active owner",
  { timeout: 2000 },
  async () => {
    const locks = new LockPool(2);
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
    const active = withPrivacyCaseLock(locks, "same-case", async () => {
      entered();
      await barrier;
      return "first";
    });
    await ready;
    try {
      let calls = 0;
      await assert.rejects(
        () =>
          withPrivacyCaseLock(locks, "same-case", async () => {
            calls++;
          }),
        (error) => error instanceof ErasureLockBusyError && error.code === "ERASURE_LOCK_BUSY",
      );
      assert.equal(calls, 0);
      assert.equal(locks.held.size, 1);
      assert.equal(locks.slots.active, 1);
      assert.deepEqual(locks.releases, [{ session: 2, destroy: false }]);
      assert.equal(locks.queries.filter((q) => q.session === 2).length, 1);
      assert.equal(await withPrivacyCaseLock(locks, "other-case", async () => "other"), "other");
    } finally {
      release();
    }
    assert.equal(await active, "first");
    assert.equal(await withPrivacyCaseLock(locks, "same-case", async () => "retry"), "retry");
    assert.equal(locks.slots.active, 0);
    assert.equal(locks.held.size, 0);
  },
);

test("callback rejection still unlocks and preserves the original error", async () => {
  const locks = new LockPool(),
    failure = Error("CONTROLLED_CALLBACK_FAILURE");
  await assert.rejects(
    () =>
      withPrivacyCaseLock(locks, "case", async () => {
        throw failure;
      }),
    (error) => error === failure,
  );
  assert.equal(locks.held.size, 0);
  assert.deepEqual(locks.releases, [{ session: 1, destroy: false }]);
});

test("uncertain acquisition destroys the session without dispatching work", async () => {
  for (const fault of ["acquire_lost", "acquire_unknown"] as const) {
    const locks = new LockPool(2, fault);
    let calls = 0;
    await assert.rejects(() =>
      withPrivacyCaseLock(locks, "case", async () => {
        calls++;
      }),
    );
    assert.equal(calls, 0);
    assert.equal(locks.held.size, 0);
    assert.equal(locks.slots.active, 0);
    assert.deepEqual(locks.releases, [{ session: 1, destroy: true }]);
  }
});

test("failed or unconfirmed unlock destroys the session and retains callback outcome", async () => {
  for (const fault of ["unlock_lost", "unlock_false"] as const) {
    const locks = new LockPool(2, fault);
    assert.equal(await withPrivacyCaseLock(locks, "case", async () => "committed"), "committed");
    assert.equal(locks.held.size, 0);
    assert.equal(locks.slots.active, 0);
    assert.deepEqual(locks.releases, [{ session: 1, destroy: true }]);
    const failure = Error("CONTROLLED_CALLBACK_FAILURE");
    await assert.rejects(
      () =>
        withPrivacyCaseLock(locks, "case", async () => {
          throw failure;
        }),
      (error) => error === failure,
    );
    assert.equal(locks.held.size, 0);
    assert.equal(locks.releases[1]?.destroy, true);
  }
});
