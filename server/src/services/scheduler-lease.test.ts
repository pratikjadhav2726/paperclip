import { describe, expect, it, vi } from "vitest";
import { createSchedulerLeaseRunner } from "./scheduler-lease.js";

function createDb(acquired: boolean) {
  return {
    transaction: vi.fn(async (callback) =>
      callback({
        execute: vi.fn(async () => [{ acquired }]),
      }),
    ),
  };
}

describe("scheduler lease runner", () => {
  it("runs the operation when the advisory lock is acquired", async () => {
    const db = createDb(true);
    const runner = createSchedulerLeaseRunner(db as never);
    const operation = vi.fn(async () => "done");

    await expect(runner.run("paperclip:test", operation)).resolves.toEqual({
      acquired: true,
      value: "done",
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("skips the operation when another process holds the advisory lock", async () => {
    const db = createDb(false);
    const runner = createSchedulerLeaseRunner(db as never);
    const operation = vi.fn(async () => "done");

    await expect(runner.run("paperclip:test", operation)).resolves.toEqual({
      acquired: false,
      reason: "remote_lock_held",
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it("skips overlapping work in the same process", async () => {
    const db = createDb(true);
    const runner = createSchedulerLeaseRunner(db as never);
    let releaseOperation: () => void = () => {};
    const firstRun = runner.run(
      "paperclip:test",
      () =>
        new Promise((resolve) => {
          releaseOperation = () => resolve("done");
        }),
    );

    await expect(runner.run("paperclip:test", async () => "overlap")).resolves.toEqual({
      acquired: false,
      reason: "local_in_flight",
    });

    releaseOperation();
    await expect(firstRun).resolves.toEqual({ acquired: true, value: "done" });
  });
});
