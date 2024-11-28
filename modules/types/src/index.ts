export * from 'type-fest';

export type SupporteIds = string | number;

export interface Identified<T extends SupporteIds> extends Record<string, any> {
  id: T;
}
