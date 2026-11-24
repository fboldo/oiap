import type { PluginIr, TargetId } from "./primitives.ts";

/**
 * Merge author overrides into a generated host file: plain objects merge
 * deeply, `null` removes the key, anything else replaces it.
 */
export function mergeTargetMetadata<T extends Record<string, unknown>>(
	base: T,
	overrides: Record<string, unknown> | undefined,
): T {
	if (!overrides) {
		return base;
	}

	const merged: Record<string, unknown> = { ...base };

	for (const [key, value] of Object.entries(overrides)) {
		const current = merged[key];

		if (value === null) {
			delete merged[key];
		} else if (isPlainObject(value) && isPlainObject(current)) {
			merged[key] = mergeTargetMetadata(current, value);
		} else {
			merged[key] = value;
		}
	}

	return merged as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

/**
 * Drop primitives limited to other targets with `targets: [...]`, so an
 * exporter only sees what the author meant for its host.
 */
export function scopeToTarget(ir: PluginIr, target: TargetId): PluginIr {
	const keep = <T extends { targets?: readonly string[] }>(items: T[]): T[] =>
		items.filter((item) => !item.targets || item.targets.includes(target));

	return {
		...ir,
		instructions: keep(ir.instructions),
		commands: keep(ir.commands),
		workflows: keep(ir.workflows),
		rules: keep(ir.rules),
		skills: keep(ir.skills),
		hooks: keep(ir.hooks),
		agents: keep(ir.agents),
		tools: keep(ir.tools),
	};
}
