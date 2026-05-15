import type { HookDefinition, PluginDefinition } from "@oiap/core";
import { definePlugin, hook } from "@oiap/core";

const securityReminderHook = hook.beforeTool(
	"security-reminder",
	(context) => {
		const toolName = context.input.tool.name;

		if (!["Edit", "Write", "MultiEdit"].includes(toolName)) {
			return { decision: "allow" };
		}

		const toolArguments = context.input.arguments as Record<string, unknown>;
		const filePath =
			typeof toolArguments.file_path === "string"
				? toolArguments.file_path
				: "";

		if (!filePath) {
			return { decision: "allow" };
		}

		const contentParts: string[] = [];

		if (toolName === "Write" && typeof toolArguments.content === "string") {
			contentParts.push(toolArguments.content);
		}

		if (toolName === "Edit" && typeof toolArguments.new_string === "string") {
			contentParts.push(toolArguments.new_string);
		}

		if (toolName === "MultiEdit" && Array.isArray(toolArguments.edits)) {
			for (const edit of toolArguments.edits) {
				const editRecord =
					edit && typeof edit === "object" && !Array.isArray(edit)
						? (edit as Record<string, unknown>)
						: undefined;

				if (typeof editRecord?.new_string === "string") {
					contentParts.push(editRecord.new_string);
				}
			}
		}

		const content = contentParts.join("\n");
		const normalizedPath = filePath.replace(/^\/+/, "");
		const securityPatterns = [
			{
				id: "github-actions-workflow",
				matches:
					normalizedPath.includes(".github/workflows/") &&
					(normalizedPath.endsWith(".yml") || normalizedPath.endsWith(".yaml")),
				reminder:
					"You are editing a GitHub Actions workflow. Avoid placing untrusted event data directly inside run commands. Prefer passing event fields through env variables with normal shell quoting, and review pull request titles, issue bodies, comments, commit messages, and branch names as attacker-controlled input.",
			},
			{
				id: "child-process-exec",
				matches:
					content.includes("child_process.exec") ||
					content.includes("exec(") ||
					content.includes("execSync("),
				reminder:
					"This edit appears to use shell execution. Prefer execFile-style APIs with an argument array when any value could come from a user, file, network response, branch name, environment variable, or model output.",
			},
			{
				id: "dynamic-code-evaluation",
				matches: content.includes("new Function") || content.includes("eval("),
				reminder:
					"This edit appears to evaluate dynamic code. Avoid eval and new Function for untrusted data. Prefer parsers, lookup tables, schemas, or other explicit control flow.",
			},
			{
				id: "dom-xss",
				matches:
					content.includes("dangerouslySetInnerHTML") ||
					content.includes("document.write") ||
					content.includes(".innerHTML =") ||
					content.includes(".innerHTML="),
				reminder:
					"This edit appears to write HTML into the DOM. Treat content as untrusted unless it is sanitized. Prefer textContent or safe DOM construction when possible.",
			},
			{
				id: "python-unsafe-execution",
				matches:
					content.includes("pickle") ||
					content.includes("os.system") ||
					content.includes("from os import system"),
				reminder:
					"This edit appears to use Python APIs that can execute code or shell commands. Avoid pickle for untrusted data and avoid os.system for dynamic input; prefer safe serializers and subprocess APIs with argument arrays.",
			},
		];

		const warning = securityPatterns.find((pattern) => pattern.matches);

		if (!warning) {
			return { decision: "allow" };
		}

		return {
			decision: "block",
			reason: warning.reminder,
			message: warning.reminder,
			retryable: true,
		};
	},
	{
		match: { kind: "expression", expression: "Edit|Write|MultiEdit" },
		timeoutMs: 3_000,
		failureMode: "fail_open",
	},
) as HookDefinition;

export default definePlugin({
	manifest: {
		id: "security-guidance",
		name: "Security Guidance",
		version: "1.0.0",
		description:
			"Warns about security-sensitive file edits, including command injection, XSS, unsafe dynamic code, and unsafe deserialization patterns.",
		homepage:
			"https://github.com/anthropics/claude-code/tree/main/plugins/security-guidance",
		categories: ["example", "security", "hooks"],
		supportedTargets: [
			"claude-code",
			"codex",
			"openclaw",
			"vscode-copilot-chat",
		],
	},
	hooks: [securityReminderHook],
	policies: [
		{
			permissions: [
				{
					kind: "filesystem",
					access: "allow",
					resources: ["workspace edits only"],
					reason:
						"The hook inspects proposed edit content supplied by the host before the file is written.",
				},
			],
			destructiveActions: { mode: "ask", patterns: ["file edits"] },
			promptInjection: { mode: "warn" },
		},
	],
} satisfies PluginDefinition);
