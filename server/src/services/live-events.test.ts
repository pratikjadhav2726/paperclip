import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureLiveEventFanout,
  publishLiveEvent,
  receiveRemoteLiveEvent,
  subscribeCompanyLiveEvents,
  type LiveEventFanoutTransport,
} from "./live-events.js";

let cleanupFanout: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanupFanout?.();
  cleanupFanout = null;
});

describe("live events", () => {
  it("publishes events to local subscribers and configured fanout", async () => {
    const publish = vi.fn(async () => undefined);
    const transport: LiveEventFanoutTransport = { publish };
    cleanupFanout = configureLiveEventFanout({ transport });
    const listener = vi.fn();
    const unsubscribe = subscribeCompanyLiveEvents("company-1", listener);

    const event = publishLiveEvent({
      companyId: "company-1",
      type: "agent.status",
      payload: { agentId: "agent-1" },
    });

    expect(listener).toHaveBeenCalledWith(event);
    expect(publish).toHaveBeenCalledWith(event);

    unsubscribe();
  });

  it("delivers remote events locally without re-publishing them", () => {
    const publish = vi.fn(async () => undefined);
    cleanupFanout = configureLiveEventFanout({ transport: { publish } });
    const listener = vi.fn();
    const unsubscribe = subscribeCompanyLiveEvents("company-1", listener);

    receiveRemoteLiveEvent({
      id: 100,
      companyId: "company-1",
      type: "activity.logged",
      createdAt: new Date(0).toISOString(),
      payload: { activityId: "activity-1" },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("reports fanout publish failures without failing local delivery", async () => {
    const error = new Error("notify failed");
    const onError = vi.fn();
    cleanupFanout = configureLiveEventFanout({
      transport: {
        publish: vi.fn(async () => {
          throw error;
        }),
      },
      onError,
    });
    const listener = vi.fn();
    const unsubscribe = subscribeCompanyLiveEvents("company-1", listener);

    const event = publishLiveEvent({
      companyId: "company-1",
      type: "agent.status",
    });

    expect(listener).toHaveBeenCalledWith(event);
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(error, event);
    });

    unsubscribe();
  });
});
