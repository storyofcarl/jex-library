/**
 * Scheduler data stores — thin, typed wrappers over the framework-free
 * `@jects/core` Store. They add no behaviour beyond default model coercion and a
 * convenient `coerceStore` helper that accepts either an existing Store or a raw
 * array (so consumers can pass either form in `SchedulerConfig`).
 *
 * Keeping these as factories (rather than subclasses) avoids leaking Store's
 * large surface into the scheduler's public types while still reusing all of its
 * add/remove/update/sort/filter machinery and reactive `events` emitter.
 */

import { Store } from '@jects/core';
import type {
  ResourceModel,
  EventModel,
  AssignmentModel,
} from '../contract.js';

/** A Store of resource lanes. */
export type ResourceStore = Store<ResourceModel>;
/** A Store of scheduled events. */
export type EventStore = Store<EventModel>;
/** A Store of event⇄resource assignments. */
export type AssignmentStore = Store<AssignmentModel>;

/** Build a resource store from raw data. */
export function createResourceStore(data: ResourceModel[] = []): ResourceStore {
  return new Store<ResourceModel>({ data, idField: 'id' });
}

/** Build an event store, normalizing `endDate` from `duration` when needed. */
export function createEventStore(data: EventModel[] = []): EventStore {
  return new Store<EventModel>({
    data,
    idField: 'id',
    model: (raw) => normalizeEvent(raw as Partial<EventModel>),
  });
}

/** Build an assignment store. */
export function createAssignmentStore(data: AssignmentModel[] = []): AssignmentStore {
  return new Store<AssignmentModel>({ data, idField: 'id' });
}

/**
 * Accept either a live Store or a plain array and return a Store. When an array
 * is supplied the appropriate factory is used so model coercion still applies.
 */
export function coerceResourceStore(src: ResourceStore | ResourceModel[]): ResourceStore {
  return src instanceof Store ? src : createResourceStore(src);
}
export function coerceEventStore(src: EventStore | EventModel[]): EventStore {
  return src instanceof Store ? src : createEventStore(src);
}
export function coerceAssignmentStore(
  src: AssignmentStore | AssignmentModel[] | undefined,
): AssignmentStore {
  if (!src) return createAssignmentStore();
  return src instanceof Store ? src : createAssignmentStore(src);
}

/**
 * Normalize an event record: ensure a concrete `endDate` exists, deriving it
 * from `duration` when only a duration was supplied, and clamp a degenerate span
 * to a minimum 1ms so geometry never produces a zero/negative width box.
 */
export function normalizeEvent(raw: Partial<EventModel>): EventModel {
  const start = Number(raw.startDate ?? 0);
  let end: number;
  if (raw.endDate != null) {
    end = Number(raw.endDate);
  } else if (raw.duration != null) {
    end = start + Number(raw.duration);
  } else {
    end = start;
  }
  if (end <= start) end = start + 1;
  return { ...(raw as EventModel), startDate: start, endDate: end };
}
