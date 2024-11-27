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
