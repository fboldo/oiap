# OIAP Plugin Patterns

Use these patterns when creating OIAP plugins for users. Keep examples minimal
and expand only when the user's plugin needs more surfaces.

## Minimal Package Files

Create `package.json`:

```json
{
  "name": "my-oiap-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build:oiap": "oiap build oiap.plugin.ts --out dist/oiap",
    "targets": "oiap targets"
  },
  "devDependencies": {
    "@oiap/cli": "latest",
    "@oiap/core": "latest",
    "@types/node": "latest",
    "typescript": "latest"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["oiap.plugin.ts"]
}
```

## Command Plugin

Use a command plugin when the user wants a slash-command-like workflow or named
agent action.

```ts
import type { PluginDefinition } from "@oiap/core";
import { definePlugin, markdownFile } from "@oiap/core";

const commandPrompt = markdownFile("prompts/command.md", {
  baseUrl: import.meta.url,
});

export default definePlugin({
  manifest: {
    id: "review-guard",
    name: "Review Guard",
    version: "1.0.0",
    description: "Adds a portable review command for agent-assisted code review.",
    license: "MIT",
    categories: ["review", "quality", "commands"],
    supportedTargets: ["claude-code", "codex", "vscode-copilot-chat"],
  },
  invocations: [
    {
      id: "review-guard-invocation",
      canonical: "review-guard",
      targetAliases: {
        "claude-code": "review-guard",
        codex: "review-guard",
        "vscode-copilot-chat": "review-guard",
      },
      helpText: "Review the current change before it is merged.",
      examples: ["/review-guard", "/review-guard Focus on security"],
    },
  ],
  instructions: [
    {
      id: "review-guard-prompt",
      purpose: "command",
      triggers: ["review", "code review", "pre-merge review"],
      body: commandPrompt,
    },
  ],
  commands: [
    {
      id: "review-guard-command",
      invocation: { id: "review-guard-invocation", kind: "invocation" },
      prompt: { id: "review-guard-prompt", kind: "instruction" },
    },
  ],
} satisfies PluginDefinition);
```

## Hook Plugin

Use a hook plugin when behavior should run around lifecycle events such as tool
usage or prompt submission. Hooks should return standard decisions and declare
their timeout and failure mode.

```ts
import type { HookDefinition, PluginDefinition } from "@oiap/core";
import { definePlugin, hook } from "@oiap/core";

const protectEnvFiles = hook.beforeTool(
  "protect-env-files",
  (context) => {
    const filePath = String(
      (context.input.arguments as Record<string, unknown>).file_path ?? "",
    );

    if (!filePath.endsWith(".env")) {
      return { decision: "allow" };
    }

    return {
      decision: "block",
      reason: "protected_env_file",
      message: "Do not edit .env files through this agent workflow.",
      retryable: true,
    };
  },
  {
    match: { kind: "expression", expression: "Edit|Write|MultiEdit" },
    timeoutMs: 3000,
    failureMode: "fail_open",
  },
) as HookDefinition;

export default definePlugin({
  manifest: {
    id: "env-file-guard",
    name: "Env File Guard",
    version: "1.0.0",
    description: "Blocks agent edits to .env files.",
    license: "MIT",
    categories: ["security", "hooks"],
    supportedTargets: ["claude-code", "codex", "openclaw"],
  },
  hooks: [protectEnvFiles],
  policies: [
    {
      permissions: [
        {
          kind: "filesystem",
          access: "ask",
          resources: ["workspace files"],
          reason: "The hook inspects requested file edit paths before writes.",
        },
      ],
      destructiveActions: { mode: "ask", patterns: ["file edits"] },
      promptInjection: { mode: "warn" },
    },
  ],
} satisfies PluginDefinition);
```

## Agent And Command Plugin

Use this when a plugin needs a named command plus specialized agent personas.

```ts
import type { PluginDefinition } from "@oiap/core";
import { definePlugin, markdownFile } from "@oiap/core";

const workflowPrompt = markdownFile("prompts/workflow.md", {
  baseUrl: import.meta.url,
});
const reviewerInstructions = markdownFile("agents/reviewer.md", {
  baseUrl: import.meta.url,
});

export default definePlugin({
  manifest: {
    id: "feature-review",
    name: "Feature Review",
    version: "1.0.0",
    description: "Runs a feature review workflow with a dedicated reviewer agent.",
    license: "MIT",
    categories: ["workflow", "agents", "commands"],
    supportedTargets: ["antigravity", "claude-code", "codex"],
  },
  invocations: [
    {
      id: "feature-review-invocation",
      canonical: "feature-review",
      helpText: "Review a feature implementation for correctness and risks.",
      examples: ["/feature-review Check the dashboard filters"],
    },
  ],
  instructions: [
    {
      id: "feature-review-prompt",
      purpose: "command",
      triggers: ["feature review", "implementation review"],
      body: workflowPrompt,
    },
    {
      id: "reviewer-instructions",
      purpose: "agent",
      triggers: ["review code", "quality review"],
      body: reviewerInstructions,
    },
  ],
  commands: [
    {
      id: "feature-review-command",
      invocation: { id: "feature-review-invocation", kind: "invocation" },
      prompt: { id: "feature-review-prompt", kind: "instruction" },
    },
  ],
  agents: [
    {
      id: "reviewer",
      name: "reviewer",
      description: "Reviews changes for bugs, security risks, test gaps, and maintainability issues.",
      instructions: { id: "reviewer-instructions", kind: "instruction" },
      model: "sonnet",
    },
  ],
} satisfies PluginDefinition);
```

## Build Commands

After creating the plugin, run:

```sh
npm install
npx oiap targets
npx oiap build oiap.plugin.ts --target claude-code --out dist/claude-code
```

To build every registered target:

```sh
npx oiap build oiap.plugin.ts --out dist/oiap
```

Review the generated bundle metadata and capability reports before adopting or
publishing the generated artifacts.