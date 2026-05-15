import type { JsonObject } from "./primitives";

export interface NetworkCapability {
	kind: "network";
	host: string;
	methods?: string[];
	timeoutMs?: number;
}

export interface DatabaseCapability {
	kind: "database";
	ref: string;
	driver?: "postgres" | "sqlite" | "mysql" | "redis" | "custom";
	operations: ("read" | "write" | "migrate" | "transaction")[];
}

export interface ProcessCapability {
	kind: "process";
	command: string;
	args?: string[];
	cwd?: string;
	timeoutMs?: number;
	allowedExitCodes?: number[];
}

export interface FilesystemCapability {
	kind: "filesystem";
	read?: string[];
	write?: string[];
	delete?: string[];
}

export interface SecretCapability {
	kind: "secret";
	ref: string;
	purpose: string;
	required?: boolean;
}

export interface McpCapability {
	kind: "mcp";
	serverRef: string;
	tools?: string[];
	resources?: string[];
	prompts?: string[];
}

export interface CustomCapability {
	kind: "custom";
	id: string;
	metadata?: JsonObject;
}

export interface HookCapabilities {
	network?: NetworkCapability[];
	database?: DatabaseCapability[];
	process?: ProcessCapability[];
	filesystem?: FilesystemCapability[];
	secrets?: SecretCapability[];
	mcp?: McpCapability[];
	custom?: CustomCapability[];
}

export type HookCapability =
	| NetworkCapability
	| DatabaseCapability
	| ProcessCapability
	| FilesystemCapability
	| SecretCapability
	| McpCapability
	| CustomCapability;

export function networkCapability(
	capability: Omit<NetworkCapability, "kind">,
): NetworkCapability {
	return { kind: "network", ...capability };
}

export function databaseCapability(
	capability: Omit<DatabaseCapability, "kind">,
): DatabaseCapability {
	return { kind: "database", ...capability };
}

export function processCapability(
	capability: Omit<ProcessCapability, "kind">,
): ProcessCapability {
	return { kind: "process", ...capability };
}

export function filesystemCapability(
	capability: Omit<FilesystemCapability, "kind">,
): FilesystemCapability {
	return { kind: "filesystem", ...capability };
}

export function secretCapability(
	capability: Omit<SecretCapability, "kind">,
): SecretCapability {
	return { kind: "secret", ...capability };
}

export function mcpCapability(
	capability: Omit<McpCapability, "kind">,
): McpCapability {
	return { kind: "mcp", ...capability };
}

export function customCapability(
	capability: Omit<CustomCapability, "kind">,
): CustomCapability {
	return { kind: "custom", ...capability };
}
