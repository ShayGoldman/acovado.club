import { customAlphabet } from 'nanoid';
import type { ExtractIdPrefix, MessageId } from './types';

export const nanoId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789');
export const hexId = customAlphabet('0123456789abcdef');

export * from './types';

export function makeMessageId() {
  return makeId({ prefix: 'msg', length: 24 }) as MessageId;
}

export interface GenerateIdOpts {
  prefix?: ExtractIdPrefix<`${string}_${string}`>;
  length?: number;
  delimiter?: string;
  idGeneration?: (size: number) => string;
}

export function makeId(opts: GenerateIdOpts = {}) {
  const { prefix = '', length = 24, delimiter = '_', idGeneration = nanoId } = opts;

  return [prefix, idGeneration(length - prefix.length)].join(delimiter);
}
