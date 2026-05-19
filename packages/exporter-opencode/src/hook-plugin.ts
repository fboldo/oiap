import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createOpenCodeHookHandlers,
	loadHookDescriptors,
	runHookRuntime,
} from "./hook-plugin-runtime";

const OPENCODE_TARGET_ID = "opencode";
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const runnerPath = join(pluginRoot, ".oiap/runtime/runner.mjs");
const manifestPath = join(pluginRoot, ".oiap/runtime/manifest.json");
const descriptorPath = join(pluginRoot, ".oiap/opencode-hooks.json");

export const OiapHooksPlugin = async (ctx: unknown) => {
	const hookDescriptors = await loadHookDescriptors(descriptorPath);

	return createOpenCodeHookHandlers({
		ctx,
		hookDescriptors,
		runHook: (hook, payload) =>
			runHookRuntime({
				hook,
				payload,
				pluginRoot,
				runnerPath,
				manifestPath,
				target: OPENCODE_TARGET_ID,
			}),
	});
};

export default OiapHooksPlugin;
