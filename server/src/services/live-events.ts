import { EventEmitter } from "node:events";
import type { LiveEvent, LiveEventType } from "@paperclipai/shared";

type LiveEventPayload = Record<string, unknown>;
type LiveEventListener = (event: LiveEvent) => void;
type LiveEventFanoutErrorHandler = (error: unknown, event: LiveEvent) => void;

export interface LiveEventFanoutTransport {
  publish(event: LiveEvent): Promise<void>;
  close?(): Promise<void>;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let nextEventId = 0;
let fanoutTransport: LiveEventFanoutTransport | null = null;
let fanoutErrorHandler: LiveEventFanoutErrorHandler | null = null;

function toLiveEvent(input: {
  companyId: string;
  type: LiveEventType;
  payload?: LiveEventPayload;
}): LiveEvent {
  nextEventId += 1;
  return {
    id: nextEventId,
    companyId: input.companyId,
    type: input.type,
    createdAt: new Date().toISOString(),
    payload: input.payload ?? {},
  };
}

function emitLiveEvent(event: LiveEvent) {
  emitter.emit(event.companyId, event);
}

function publishToFanout(event: LiveEvent) {
  if (!fanoutTransport) return;
  void fanoutTransport.publish(event).catch((error) => {
    fanoutErrorHandler?.(error, event);
  });
}

export function configureLiveEventFanout(input: {
  transport: LiveEventFanoutTransport;
  onError?: LiveEventFanoutErrorHandler;
}) {
  fanoutTransport = input.transport;
  fanoutErrorHandler = input.onError ?? null;

  return async () => {
    if (fanoutTransport === input.transport) {
      fanoutTransport = null;
      fanoutErrorHandler = null;
    }
    await input.transport.close?.();
  };
}

export function receiveRemoteLiveEvent(event: LiveEvent) {
  emitLiveEvent(event);
}

export function publishLiveEvent(input: {
  companyId: string;
  type: LiveEventType;
  payload?: LiveEventPayload;
}) {
  const event = toLiveEvent(input);
  emitLiveEvent(event);
  publishToFanout(event);
  return event;
}

export function publishGlobalLiveEvent(input: {
  type: LiveEventType;
  payload?: LiveEventPayload;
}) {
  const event = toLiveEvent({ companyId: "*", type: input.type, payload: input.payload });
  emitLiveEvent(event);
  publishToFanout(event);
  return event;
}

export function subscribeCompanyLiveEvents(companyId: string, listener: LiveEventListener) {
  emitter.on(companyId, listener);
  return () => emitter.off(companyId, listener);
}

export function subscribeGlobalLiveEvents(listener: LiveEventListener) {
  emitter.on("*", listener);
  return () => emitter.off("*", listener);
}
