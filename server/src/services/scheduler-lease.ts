import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";

type SchedulerLeaseTx = {
  execute(query: unknown): Promise<unknown>;
};

type SchedulerLeaseDb = Pick<Db, "transaction">;

export type SchedulerLeaseSkippedReason = "local_in_flight" | "remote_lock_held";

export type SchedulerLeaseResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; reason: SchedulerLeaseSkippedReason };

function readAcquired(result: unknown): boolean {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object" && Symbol.iterator in result
      ? Array.from(result as Iterable<unknown>)
      : [];
  const first = rows[0];
  if (!first || typeof first !== "object") return false;
  return (first as { acquired?: unknown }).acquired === true;
}

export function createSchedulerLeaseRunner(db: SchedulerLeaseDb) {
  const localInFlight = new Set<string>();

  return {
    async run<T>(leaseName: string, operation: () => Promise<T>): Promise<SchedulerLeaseResult<T>> {
      if (localInFlight.has(leaseName)) {
        return { acquired: false, reason: "local_in_flight" };
      }

      localInFlight.add(leaseName);
      try {
        return await db.transaction(async (tx: SchedulerLeaseTx) => {
          const result = await tx.execute(sql`
            select pg_try_advisory_xact_lock(hashtext(${leaseName})) as acquired
          `);
          if (!readAcquired(result)) {
            return { acquired: false, reason: "remote_lock_held" };
          }

          const value = await operation();
          return { acquired: true, value };
        });
      } finally {
        localInFlight.delete(leaseName);
      }
    },
  };
}
