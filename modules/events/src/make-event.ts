import type { Identified, KebabCase, Paths, SupporteIds } from '@modules/types';
import type {
  BasePayload,
  ModelCreatedEvent,
  ModelDeletedEvent,
  ModelUpdatedEvent,
  LifecycleStage,
} from './types';

export function makeModelCreatedEvent<
  M extends Identified<SupporteIds>,
  R extends Lowercase<KebabCase<string>>,
>(resource: R, model: M): ModelCreatedEvent<M, R> {
  return {
    id: model.id,
    resource,
    data: model,
    type: `${resource}.created`,
    timestamp: new Date(),
  };
}

export function makeModelUpdatedEvent<
  M extends Identified<SupporteIds>,
  R extends Lowercase<KebabCase<string>>,
>(resource: R, model: M, updates: Array<Paths<M>>): ModelUpdatedEvent<M, R> {
  return {
    id: model.id,
    resource,
    data: model,
    updates,
    type: `${resource}.updated`,
    timestamp: new Date(),
  };
}

export function makeModelDeletedEvent<
  M extends Identified<SupporteIds>,
  R extends Lowercase<KebabCase<string>>,
>(resource: R, model: M): ModelDeletedEvent<M, R> {
  return {
    id: model.id,
    resource,
    data: model,
    type: `${resource}.deleted`,
    timestamp: new Date(),
  };
}

export function makeEvent<
  M extends Identified<SupporteIds>,
  R extends Lowercase<KebabCase<string>>,
  L extends Lowercase<LifecycleStage>,
>(resource: R, stage: L, model: M): BasePayload<M, R, `${R}.${L}`> {
  return {
    id: model.id,
    resource,
    data: model,
    type: `${resource}.${stage}`,
    timestamp: new Date(),
  };
}
