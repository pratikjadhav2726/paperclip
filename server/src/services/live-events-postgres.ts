import { randomUUID } from "node:crypto";
import type { LiveEvent } from "@paperclipai/shared";
import { LIVE_EVENT_TYPES } from "@paperclipai/shared";
import postgres from "postgres";
import { receiveRemoteLiveEvent, type LiveEventFanoutTransport } from "./live-events.js";

const DEFAULT_CHANNEL = "paperclip_live_events";
const DEFAULT_MAX_NOTIFY_PAYLOAD_BYTES = 7500;

interface WireLiveEvent {
  origin: string;
  event: LiveEvent;
}

export interface PostgresLiveEventFanoutOptions {
  databaseUrl: string;
  channel?: string;
  instanceId?: string;
  maxPayloadBytes?: number;
  onError?: (error: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiveEvent(value: unknown): value is LiveEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.companyId === "string" &&
    typeof value.type === "string" &&
    LIVE_EVENT_TYPES.includes(value.type as never) &&
    typeof value.createdAt === "string" &&
    isRecord(value.payload)
  );
}

function parseWireLiveEvent(payload: string): WireLiveEvent | null {
  const parsed = JSON.parse(payload) as unknown;
  if (!isRecord(parsed)) return null;
  if (typeof parsed.origin !== "string") return null;
  if (!isLiveEvent(parsed.event)) return null;
  return {
    origin: parsed.origin,
    event: parsed.event,
  };
}

export async function createPostgresLiveEventFanout(
  options: PostgresLiveEventFanoutOptions,
): Promise<LiveEventFanoutTransport> {
  const instanceId = options.instanceId ?? randomUUID();
  const channel = options.channel ?? DEFAULT_CHANNEL;
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_NOTIFY_PAYLOAD_BYTES;
  const sql = postgres(options.databaseUrl, { max: 2, onnotice: () => {} });

  const listener = await sql.listen(channel, (payload) => {
    try {
      const wireEvent = parseWireLiveEvent(payload);
      if (!wireEvent || wireEvent.origin === instanceId) return;
      receiveRemoteLiveEvent(wireEvent.event);
    } catch (error) {
      options.onError?.(error);
    }
  });

  return {
    async publish(event) {
      const payload = JSON.stringify({ origin: instanceId, event });
      if (Buffer.byteLength(payload, "utf8") > maxPayloadBytes) {
        return;
      }
      await sql.notify(channel, payload);
    },
    async close() {
      await listener.unlisten();
      await sql.end();
    },
  };
}
