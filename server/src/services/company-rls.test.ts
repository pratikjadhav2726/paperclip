import { describe, expect, it, vi } from "vitest";
import { withCompanyRls } from "./company-rls.js";

describe("withCompanyRls", () => {
  it("sets transaction-local company context before running work", async () => {
    const execute = vi.fn(async () => []);
    const tx = { execute };
    const db = {
      transaction: vi.fn(async (callback) => callback(tx)),
    };
    const operation = vi.fn(async () => "ok");

    await expect(withCompanyRls(db as never, "company-1", operation)).resolves.toBe("ok");

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledWith(tx);
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(operation.mock.invocationCallOrder[0] ?? 0);
  });
});
