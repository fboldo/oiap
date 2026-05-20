import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import type * as TypeScript from "typescript";

type TypeScriptModule = typeof TypeScript;

export type DiscoveredPluginExportKind = "default" | "named" | "unexported";

export type DiscoveredPluginMetadataStatus =
	| "complete"
	| "partial"
	| "unavailable";

export interface DiscoverPluginDeclarationsOptions {
	includeExtensions?: readonly string[];
	ignoreDirectories?: readonly string[];
	includeUnexported?: boolean;
	maxFileSizeBytes?: number;
}

export interface DiscoveredPluginManifest {
	id?: string;
	name?: string;
	version?: string;
	description?: string;
	supportedTargets?: string[];
}

export interface DiscoveredPluginDeclaration {
	filePath: string;
	relativePath: string;
	exportName?: string;
	exportKind: DiscoveredPluginExportKind;
	localName?: string;
	line: number;
	column: number;
	manifest?: DiscoveredPluginManifest;
	metadataStatus: DiscoveredPluginMetadataStatus;
}

interface CoreImports {
	definePluginIdentifiers: Set<string>;
	namespaceIdentifiers: Set<string>;
}

interface InternalPluginCall {
	filePath: string;
	relativePath: string;
	line: number;
	column: number;
	localName?: string;
	exports: PluginExport[];
	manifest?: DiscoveredPluginManifest;
	metadataStatus: DiscoveredPluginMetadataStatus;
}

interface PluginExport {
	exportName?: string;
	exportKind: DiscoveredPluginExportKind;
}

interface ExtractedManifest {
	manifest?: DiscoveredPluginManifest;
	metadataStatus: DiscoveredPluginMetadataStatus;
}

const DEFAULT_INCLUDE_EXTENSIONS = [
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
] as const;

const DEFAULT_IGNORE_DIRECTORIES = [
	".git",
	".hg",
	".svn",
	".next",
	".turbo",
	".cache",
	"coverage",
	"dist",
	"build",
	"out",
	"node_modules",
] as const;

const DEFAULT_MAX_FILE_SIZE_BYTES = 1_000_000;

let typescriptModulePromise: Promise<TypeScriptModule> | undefined;

export async function discoverPluginDeclarations(
	rootPath: string,
	options: DiscoverPluginDeclarationsOptions = {},
): Promise<DiscoveredPluginDeclaration[]> {
	const absoluteRootPath = resolve(rootPath);
	const rootStats = await stat(absoluteRootPath);
	const rootDirectory = rootStats.isDirectory()
		? absoluteRootPath
		: dirname(absoluteRootPath);
	const filePaths = rootStats.isDirectory()
		? await collectSourceFiles(absoluteRootPath, options)
		: [absoluteRootPath];
	const declarations: DiscoveredPluginDeclaration[] = [];

	for (const filePath of filePaths) {
		const content = await readCandidateFile(filePath, options);

		if (!content) {
			continue;
		}

		const relativePath = normalizePath(relative(rootDirectory, filePath));
		const fileDeclarations = await parsePluginDeclarations({
			content,
			filePath,
			includeUnexported: options.includeUnexported ?? false,
			relativePath,
		});

		declarations.push(...fileDeclarations);
	}

	return declarations.sort(compareDiscoveredPluginDeclarations);
}

async function collectSourceFiles(
	directoryPath: string,
	options: DiscoverPluginDeclarationsOptions,
): Promise<string[]> {
	const includeExtensions = new Set(
		options.includeExtensions ?? DEFAULT_INCLUDE_EXTENSIONS,
	);
	const ignoreDirectories = new Set(
		options.ignoreDirectories ?? DEFAULT_IGNORE_DIRECTORIES,
	);
	const filePaths: string[] = [];
	const directoryEntries = await readdir(directoryPath, {
		withFileTypes: true,
	});

	for (const directoryEntry of directoryEntries) {
		const entryPath = resolve(directoryPath, directoryEntry.name);

		if (directoryEntry.isDirectory()) {
			if (!ignoreDirectories.has(directoryEntry.name)) {
				filePaths.push(...(await collectSourceFiles(entryPath, options)));
			}

			continue;
		}

		if (!directoryEntry.isFile()) {
			continue;
		}

		if (isDeclarationFile(entryPath)) {
			continue;
		}

		if (includeExtensions.has(extname(entryPath))) {
			filePaths.push(entryPath);
		}
	}

	return filePaths;
}

async function readCandidateFile(
	filePath: string,
	options: DiscoverPluginDeclarationsOptions,
): Promise<string | undefined> {
	const includeExtensions = new Set(
		options.includeExtensions ?? DEFAULT_INCLUDE_EXTENSIONS,
	);

	if (isDeclarationFile(filePath)) {
		return undefined;
	}

	if (!includeExtensions.has(extname(filePath))) {
		return undefined;
	}

	const fileStats = await stat(filePath);
	const maxFileSizeBytes =
		options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;

	if (fileStats.size > maxFileSizeBytes) {
		return undefined;
	}

	const content = await readFile(filePath, "utf8");

	if (!content.includes("definePlugin") || !content.includes("@oiap/core")) {
		return undefined;
	}

	return content;
}

interface ParsePluginDeclarationsOptions {
	content: string;
	filePath: string;
	includeUnexported: boolean;
	relativePath: string;
}

async function parsePluginDeclarations(
	options: ParsePluginDeclarationsOptions,
): Promise<DiscoveredPluginDeclaration[]> {
	const typescript = await loadTypescript();
	const sourceFile = typescript.createSourceFile(
		options.filePath,
		options.content,
		typescript.ScriptTarget.Latest,
		true,
		scriptKindForPath(typescript, options.filePath),
	);
	const coreImports = collectCoreImports(typescript, sourceFile);

	if (
		coreImports.definePluginIdentifiers.size === 0 &&
		coreImports.namespaceIdentifiers.size === 0
	) {
		return [];
	}

	const pluginCalls = collectPluginCalls(
		typescript,
		sourceFile,
		coreImports,
		options,
	);
	const exportsByLocalName = collectLocalExports(typescript, sourceFile);

	return pluginCalls.flatMap((pluginCall) => {
		const pluginExports = [
			...pluginCall.exports,
			...(pluginCall.localName
				? (exportsByLocalName.get(pluginCall.localName) ?? [])
				: []),
		];
		const dedupedExports = dedupePluginExports(pluginExports);

		if (dedupedExports.length === 0 && options.includeUnexported) {
			dedupedExports.push({ exportKind: "unexported" });
		}

		return dedupedExports.map((pluginExport) => ({
			filePath: pluginCall.filePath,
			relativePath: pluginCall.relativePath,
			exportName: pluginExport.exportName,
			exportKind: pluginExport.exportKind,
			localName: pluginCall.localName,
			line: pluginCall.line,
			column: pluginCall.column,
			manifest: pluginCall.manifest,
			metadataStatus: pluginCall.metadataStatus,
		}));
	});
}

function collectCoreImports(
	typescript: TypeScriptModule,
	sourceFile: TypeScript.SourceFile,
): CoreImports {
	const definePluginIdentifiers = new Set<string>();
	const namespaceIdentifiers = new Set<string>();

	for (const statement of sourceFile.statements) {
		if (!typescript.isImportDeclaration(statement)) {
			continue;
		}

		if (!typescript.isStringLiteral(statement.moduleSpecifier)) {
			continue;
		}

		if (!isCoreModuleSpecifier(statement.moduleSpecifier.text)) {
			continue;
		}

		const importClause = statement.importClause;

		if (
			!importClause ||
			importClause.isTypeOnly ||
			!importClause.namedBindings
		) {
			continue;
		}

		const namedBindings = importClause.namedBindings;

		if (typescript.isNamespaceImport(namedBindings)) {
			namespaceIdentifiers.add(namedBindings.name.text);
			continue;
		}

		for (const importSpecifier of namedBindings.elements) {
			if (importSpecifier.isTypeOnly) {
				continue;
			}

			const importedName =
				importSpecifier.propertyName?.text ?? importSpecifier.name.text;

			if (importedName === "definePlugin") {
				definePluginIdentifiers.add(importSpecifier.name.text);
			}
		}
	}

	return { definePluginIdentifiers, namespaceIdentifiers };
}

function collectPluginCalls(
	typescript: TypeScriptModule,
	sourceFile: TypeScript.SourceFile,
	coreImports: CoreImports,
	options: ParsePluginDeclarationsOptions,
): InternalPluginCall[] {
	const pluginCalls: InternalPluginCall[] = [];

	function visit(node: TypeScript.Node): void {
		if (
			typescript.isCallExpression(node) &&
			isDefinePluginCallExpression(typescript, node, coreImports)
		) {
			const position = sourceFile.getLineAndCharacterOfPosition(
				node.getStart(sourceFile),
			);
			const localName = localNameForPluginCall(typescript, node);
			const pluginExports = directExportsForPluginCall(
				typescript,
				node,
				localName,
			);
			const extractedManifest = extractPluginManifest(typescript, node);

			pluginCalls.push({
				filePath: options.filePath,
				relativePath: options.relativePath,
				line: position.line + 1,
				column: position.character + 1,
				localName,
				exports: pluginExports,
				manifest: extractedManifest.manifest,
				metadataStatus: extractedManifest.metadataStatus,
			});
		}

		typescript.forEachChild(node, visit);
	}

	visit(sourceFile);

	return pluginCalls;
}

function collectLocalExports(
	typescript: TypeScriptModule,
	sourceFile: TypeScript.SourceFile,
): Map<string, PluginExport[]> {
	const exportsByLocalName = new Map<string, PluginExport[]>();

	for (const statement of sourceFile.statements) {
		if (typescript.isExportAssignment(statement)) {
			const exportedExpression = unwrapExpression(
				typescript,
				statement.expression,
			);

			if (typescript.isIdentifier(exportedExpression)) {
				appendLocalExport(exportsByLocalName, exportedExpression.text, {
					exportName: "default",
					exportKind: "default",
				});
			}

			continue;
		}

		if (
			!typescript.isExportDeclaration(statement) ||
			statement.isTypeOnly ||
			statement.moduleSpecifier ||
			!statement.exportClause ||
			!typescript.isNamedExports(statement.exportClause)
		) {
			continue;
		}

		for (const exportSpecifier of statement.exportClause.elements) {
			const localName =
				exportSpecifier.propertyName?.text ?? exportSpecifier.name.text;
			const exportName = exportSpecifier.name.text;

			appendLocalExport(exportsByLocalName, localName, {
				exportName,
				exportKind: exportName === "default" ? "default" : "named",
			});
		}
	}

	return exportsByLocalName;
}

function appendLocalExport(
	exportsByLocalName: Map<string, PluginExport[]>,
	localName: string,
	pluginExport: PluginExport,
): void {
	const localExports = exportsByLocalName.get(localName) ?? [];
	localExports.push(pluginExport);
	exportsByLocalName.set(localName, localExports);
}

function isDefinePluginCallExpression(
	typescript: TypeScriptModule,
	callExpression: TypeScript.CallExpression,
	coreImports: CoreImports,
): boolean {
	const expression = unwrapExpression(typescript, callExpression.expression);

	if (typescript.isIdentifier(expression)) {
		return coreImports.definePluginIdentifiers.has(expression.text);
	}

	if (!typescript.isPropertyAccessExpression(expression)) {
		return false;
	}

	return (
		expression.name.text === "definePlugin" &&
		typescript.isIdentifier(expression.expression) &&
		coreImports.namespaceIdentifiers.has(expression.expression.text)
	);
}

function directExportsForPluginCall(
	typescript: TypeScriptModule,
	callExpression: TypeScript.CallExpression,
	localName: string | undefined,
): PluginExport[] {
	const pluginExports: PluginExport[] = [];

	if (isDirectDefaultExport(typescript, callExpression)) {
		pluginExports.push({ exportName: "default", exportKind: "default" });
	}

	if (!localName) {
		return pluginExports;
	}

	const variableDeclaration = directVariableDeclarationForPluginCall(
		typescript,
		callExpression,
	);
	const variableStatement = variableDeclaration?.parent.parent;

	if (
		variableStatement &&
		typescript.isVariableStatement(variableStatement) &&
		hasExportModifier(typescript, variableStatement)
	) {
		pluginExports.push({ exportName: localName, exportKind: "named" });
	}

	return pluginExports;
}

function localNameForPluginCall(
	typescript: TypeScriptModule,
	callExpression: TypeScript.CallExpression,
): string | undefined {
	const variableDeclaration = directVariableDeclarationForPluginCall(
		typescript,
		callExpression,
	);

	if (
		!variableDeclaration ||
		!typescript.isIdentifier(variableDeclaration.name)
	) {
		return undefined;
	}

	return variableDeclaration.name.text;
}

function directVariableDeclarationForPluginCall(
	typescript: TypeScriptModule,
	callExpression: TypeScript.CallExpression,
): TypeScript.VariableDeclaration | undefined {
	const parent = parentAfterExpressionWrappers(typescript, callExpression);

	if (!parent || !typescript.isVariableDeclaration(parent)) {
		return undefined;
	}

	return parent;
}

function isDirectDefaultExport(
	typescript: TypeScriptModule,
	callExpression: TypeScript.CallExpression,
): boolean {
	const parent = parentAfterExpressionWrappers(typescript, callExpression);

	return Boolean(parent && typescript.isExportAssignment(parent));
}

function parentAfterExpressionWrappers(
	typescript: TypeScriptModule,
	node: TypeScript.Expression,
): TypeScript.Node | undefined {
	let current: TypeScript.Node = node;
	let parent = current.parent;

	while (parent && isExpressionWrapperForChild(typescript, parent, current)) {
		current = parent;
		parent = parent.parent;
	}

	return parent;
}

function isExpressionWrapperForChild(
	typescript: TypeScriptModule,
	parent: TypeScript.Node,
	child: TypeScript.Node,
): boolean {
	return (
		(typescript.isParenthesizedExpression(parent) &&
			parent.expression === child) ||
		(typescript.isAsExpression(parent) && parent.expression === child) ||
		(typescript.isSatisfiesExpression(parent) && parent.expression === child) ||
		(typescript.isTypeAssertionExpression(parent) &&
			parent.expression === child)
	);
}

function extractPluginManifest(
	typescript: TypeScriptModule,
	callExpression: TypeScript.CallExpression,
): ExtractedManifest {
	const firstArgument = callExpression.arguments[0];

	if (!firstArgument) {
		return { metadataStatus: "unavailable" };
	}

	const pluginObject = unwrapExpression(typescript, firstArgument);

	if (!typescript.isObjectLiteralExpression(pluginObject)) {
		return { metadataStatus: "unavailable" };
	}

	const manifestExpression = objectLiteralPropertyExpression(
		typescript,
		pluginObject,
		"manifest",
	);

	if (!manifestExpression) {
		return { metadataStatus: "unavailable" };
	}

	const manifestObject = unwrapExpression(typescript, manifestExpression);

	if (!typescript.isObjectLiteralExpression(manifestObject)) {
		return { metadataStatus: "unavailable" };
	}

	return extractManifestObject(typescript, manifestObject);
}

function extractManifestObject(
	typescript: TypeScriptModule,
	manifestObject: TypeScript.ObjectLiteralExpression,
): ExtractedManifest {
	const manifest: DiscoveredPluginManifest = {};
	let hasDynamicMetadata = false;

	for (const stringProperty of [
		"id",
		"name",
		"version",
		"description",
	] as const) {
		const propertyExpression = objectLiteralPropertyExpression(
			typescript,
			manifestObject,
			stringProperty,
		);

		if (!propertyExpression) {
			continue;
		}

		const stringValue = staticStringExpression(typescript, propertyExpression);

		if (stringValue === undefined) {
			hasDynamicMetadata = true;
			continue;
		}

		manifest[stringProperty] = stringValue;
	}

	const supportedTargetsExpression = objectLiteralPropertyExpression(
		typescript,
		manifestObject,
		"supportedTargets",
	);

	if (supportedTargetsExpression) {
		const supportedTargets = staticStringArrayExpression(
			typescript,
			supportedTargetsExpression,
		);

		if (supportedTargets) {
			manifest.supportedTargets = supportedTargets;
		} else {
			hasDynamicMetadata = true;
		}
	}

	return {
		manifest,
		metadataStatus: hasDynamicMetadata ? "partial" : "complete",
	};
}

function objectLiteralPropertyExpression(
	typescript: TypeScriptModule,
	objectLiteral: TypeScript.ObjectLiteralExpression,
	propertyName: string,
): TypeScript.Expression | undefined {
	for (const property of objectLiteral.properties) {
		if (!typescript.isPropertyAssignment(property)) {
			continue;
		}

		if (staticPropertyName(typescript, property.name) === propertyName) {
			return property.initializer;
		}
	}

	return undefined;
}

function staticPropertyName(
	typescript: TypeScriptModule,
	propertyName: TypeScript.PropertyName,
): string | undefined {
	if (
		typescript.isIdentifier(propertyName) ||
		typescript.isStringLiteral(propertyName) ||
		typescript.isNumericLiteral(propertyName)
	) {
		return propertyName.text;
	}

	return undefined;
}

function staticStringExpression(
	typescript: TypeScriptModule,
	expression: TypeScript.Expression,
): string | undefined {
	const unwrappedExpression = unwrapExpression(typescript, expression);

	if (
		typescript.isStringLiteral(unwrappedExpression) ||
		typescript.isNoSubstitutionTemplateLiteral(unwrappedExpression)
	) {
		return unwrappedExpression.text;
	}

	return undefined;
}

function staticStringArrayExpression(
	typescript: TypeScriptModule,
	expression: TypeScript.Expression,
): string[] | undefined {
	const unwrappedExpression = unwrapExpression(typescript, expression);

	if (!typescript.isArrayLiteralExpression(unwrappedExpression)) {
		return undefined;
	}

	const values: string[] = [];

	for (const element of unwrappedExpression.elements) {
		const value = staticStringExpression(typescript, element);

		if (value === undefined) {
			return undefined;
		}

		values.push(value);
	}

	return values;
}

function unwrapExpression(
	typescript: TypeScriptModule,
	expression: TypeScript.Expression,
): TypeScript.Expression {
	let currentExpression = expression;

	while (
		typescript.isParenthesizedExpression(currentExpression) ||
		typescript.isAsExpression(currentExpression) ||
		typescript.isSatisfiesExpression(currentExpression) ||
		typescript.isTypeAssertionExpression(currentExpression)
	) {
		currentExpression = currentExpression.expression;
	}

	return currentExpression;
}

function hasExportModifier(
	typescript: TypeScriptModule,
	node: TypeScript.Node,
): boolean {
	const modifiers = typescript.canHaveModifiers(node)
		? typescript.getModifiers(node)
		: undefined;

	return Boolean(
		modifiers?.some(
			(modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword,
		),
	);
}

function dedupePluginExports(pluginExports: PluginExport[]): PluginExport[] {
	const seen = new Set<string>();
	const dedupedExports: PluginExport[] = [];

	for (const pluginExport of pluginExports) {
		const key = `${pluginExport.exportKind}:${pluginExport.exportName ?? ""}`;

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		dedupedExports.push(pluginExport);
	}

	return dedupedExports;
}

async function loadTypescript(): Promise<TypeScriptModule> {
	typescriptModulePromise ??= import("typescript") as Promise<TypeScriptModule>;

	return typescriptModulePromise;
}

function scriptKindForPath(
	typescript: TypeScriptModule,
	filePath: string,
): TypeScript.ScriptKind {
	if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
		return typescript.ScriptKind.TSX;
	}

	if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
		return typescript.ScriptKind.JS;
	}

	if (filePath.endsWith(".cjs")) {
		return typescript.ScriptKind.JS;
	}

	return typescript.ScriptKind.TS;
}

function isCoreModuleSpecifier(moduleSpecifier: string): boolean {
	return (
		moduleSpecifier === "@oiap/core" ||
		moduleSpecifier.startsWith("@oiap/core/")
	);
}

function isDeclarationFile(filePath: string): boolean {
	return (
		filePath.endsWith(".d.ts") ||
		filePath.endsWith(".d.mts") ||
		filePath.endsWith(".d.cts")
	);
}

function normalizePath(filePath: string): string {
	return sep === "/" ? filePath : filePath.split(sep).join("/");
}

function compareDiscoveredPluginDeclarations(
	left: DiscoveredPluginDeclaration,
	right: DiscoveredPluginDeclaration,
): number {
	return (
		left.relativePath.localeCompare(right.relativePath) ||
		left.line - right.line ||
		(left.exportName ?? "").localeCompare(right.exportName ?? "")
	);
}
