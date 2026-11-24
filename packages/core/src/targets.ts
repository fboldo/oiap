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
	const skills = keep(ir.skills);
	const agents = keep(ir.agents);
	const commands = keep(ir.commands);
	// An instruction used only by primitives scoped out goes with them, so it
	// doesn't reappear as a standalone rule or skill.
	const instructionRefs = (scoped: {
		skills: typeof ir.skills;
		agents: typeof ir.agents;
		commands: typeof ir.commands;
	}): Set<string> =>
		new Set([
			...scoped.skills.map((skill) => skill.instructions.id),
			...scoped.agents.map((agent) => agent.instructions.id),
			...scoped.commands.flatMap((command) =>
				command.prompt ? [command.prompt.id] : [],
			),
		]);
	const used = instructionRefs({ skills, agents, commands });
	const dropped = [...instructionRefs(ir)].filter((id) => !used.has(id));

	return {
		...ir,
		instructions: keep(ir.instructions).filter(
			(instruction) => !dropped.includes(instruction.id),
		),
		commands,
		workflows: keep(ir.workflows),
		rules: keep(ir.rules),
		skills,
		hooks: keep(ir.hooks),
		agents,
		tools: keep(ir.tools),
	};
}
