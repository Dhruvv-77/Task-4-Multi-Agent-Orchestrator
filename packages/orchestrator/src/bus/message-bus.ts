import { Plan, Patch, Review, RevisionRequest, EscalationResult } from '../types/messages.js';

export type EventMap = {
  'plan:created': Plan;
  'patch:submitted': Patch;
  'review:completed': Review;
  'revision:requested': RevisionRequest;
  'escalation:triggered': EscalationResult;
};

export type EventType = keyof EventMap;
export type Handler<T extends EventType> = (data: EventMap[T]) => Promise<void> | void;

export class MessageBus {
  private handlers: { [K in EventType]?: Handler<K>[] } = {};
  private eventHistory: { type: EventType; payload: any; timestamp: number }[] = [];

  public subscribe<T extends EventType>(event: T, handler: Handler<T>): () => void {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    (this.handlers[event] as Handler<T>[]).push(handler);

    return () => {
      this.handlers[event] = (this.handlers[event] as Handler<T>[]).filter((h) => h !== handler) as any;
    };
  }

  public async publish<T extends EventType>(event: T, payload: EventMap[T]): Promise<void> {
    this.eventHistory.push({
      type: event,
      payload,
      timestamp: Date.now(),
    });

    const eventHandlers = this.handlers[event];
    if (eventHandlers) {
      for (const handler of eventHandlers as Handler<T>[]) {
        await handler(payload);
      }
    }
  }

  public getHistory() {
    return [...this.eventHistory];
  }

  public clearHistory() {
    this.eventHistory = [];
  }
}
