import type { Logger } from '@modules/logger';
import type { Attributes } from '@opentelemetry/api';

export interface TracerOptions {
  serviceName: string;
  exporterUrl?: string;
  logger: Logger;
}

export interface Context {
  with<T>(name: string, fn: (context: Context) => Promise<T>): Promise<T>;
  with<T>(
    name: string,
    opts: { attributes?: Attributes },
    fn: (context: Context) => Promise<T>,
  ): Promise<T>;

  log: Logger;
  annotations: Map<string, string | number | boolean>;
  annotate(key: string, value: string | number | boolean): void;
  setName(name: string): void;
}

export interface Tracer {
  with<T>(name: string, fn: (context: Context) => Promise<T>): Promise<T>;
  with<T>(
    name: string,
    opts: {
      attributes?: Attributes;
      headers?: Record<string, unknown>;
      attach?: boolean;
    },
    fn: (context: Context) => Promise<T>,
  ): Promise<T>;
}
