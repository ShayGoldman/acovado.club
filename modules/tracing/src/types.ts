import type { Logger } from '@modules/logger';
import type { Attributes } from '@opentelemetry/api';

export interface TracerOptions {
  serviceName: string;
  exporterUrls: string[];
  logger: Logger;
  logExporterUrls?: string[];
  logExportEnabled?: boolean;
  /** Semantic resource attribute `deployment.environment`. Defaults to `NODE_ENV` or `development`. */
  deploymentEnvironment?: string;
  /**
   * Root trace sampling ratio (0–1]. Nested spans follow the parent decision.
   * Defaults to `1` (always sample).
   */
  traceSampleRatio?: number;
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
      links?: Array<{
        context: import('@opentelemetry/api').SpanContext;
        attributes?: Attributes;
      }>;
    },
    fn: (context: Context) => Promise<T>,
  ): Promise<T>;
  /** Flush and shutdown OTLP trace and log providers (call on process exit). */
  shutdown(): Promise<void>;
}
