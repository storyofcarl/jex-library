/**
 * Factory / type registry — declarative composition. Components register a
 * `type` name; `create({ type:'button', text:'Go' }, host)` instantiates them.
 * Enables config-driven trees (toolbars, forms) without importing each class.
 */

import type { Widget } from './widget.js';

/** Anything constructible as `new Ctor(host, config)`. */
export interface WidgetCtor {
  new (host: HTMLElement | string, config?: Record<string, unknown>): Widget;
}

/** A declarative widget config carrying its registered `type`. */
export interface TypedConfig {
  type: string;
  [key: string]: unknown;
}

const registry = new Map<string, WidgetCtor>();

/** Register a widget constructor under a `type` name (idempotent; last wins). */
export function register(type: string, ctor: WidgetCtor): void {
  registry.set(type, ctor);
}

/** True if `type` is registered. */
export function isRegistered(type: string): boolean {
  return registry.has(type);
}

/** Look up a registered constructor. */
export function getCtor(type: string): WidgetCtor | undefined {
  return registry.get(type);
}

/** All registered type names. */
export function registeredTypes(): string[] {
  return [...registry.keys()];
}

/**
 * Instantiate a widget from a `{ type, ...config }` object. If `host` is omitted,
 * a detached `<div>` is created (the caller mounts `widget.el` later).
 */
export function create(config: TypedConfig, host?: HTMLElement | string): Widget {
  const { type, ...rest } = config;
  const Ctor = registry.get(type);
  if (!Ctor) {
    throw new Error(
      `Jects factory: unknown type "${type}". Registered: ${registeredTypes().join(', ') || '(none)'}`,
    );
  }
  const mount = host ?? document.createElement('div');
  return new Ctor(mount, rest);
}

/** Instantiate many configs against the same host (e.g. toolbar items). */
export function createAll(configs: TypedConfig[], host?: HTMLElement | string): Widget[] {
  return configs.map((c) => create(c, host));
}

/** Clear the registry — primarily for tests. */
export function clearRegistry(): void {
  registry.clear();
}
