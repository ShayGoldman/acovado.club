import type { Identified, KebabCase, Paths, SupporteIds } from '@modules/types';

export interface MessageMetadata {
  messageId: string;
  correlationId: string;
  domain: string;
  queue: string;
  routingKey: string;
  retries?: {
    count: number;
    code?: string;
    lastRetriedAt?: string;
  };
  headers: Record<string, string>;
  timestamp: string;
  version: string;
}

export interface Message<T> {
  payload: T;
  metadata: MessageMetadata;
}

export type LifecycleStage = 'created' | 'updated' | 'deleted' | string;

export type LifecycleEvent<R extends string> = `${R}.${LifecycleStage}`;

export interface BasePayload<
  D extends Identified<SupporteIds> = Identified<SupporteIds>,
  R extends string = string,
  T extends LifecycleEvent<R> = LifecycleEvent<R>,
> {
  id: D['id'];
  resource: R;
  data: D;
  type: T;
  timestamp: Date;
}

export interface ModelCreatedEvent<D extends Identified<SupporteIds>, R extends string>
  extends BasePayload<D, R, `${R}.created`> {}

export interface ModelUpdatedEvent<D extends Identified<SupporteIds>, R extends string>
  extends BasePayload<D, R, `${R}.updated`> {
  updates: Array<Paths<D>>;
}
export interface ModelDeletedEvent<D extends Identified<SupporteIds>, R extends string>
  extends BasePayload<D, R, `${R}.deleted`> {}
