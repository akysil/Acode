// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "@babel/parser";
import {
	Compartment,
	EditorSelection,
	EditorState,
	Text,
} from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";
import {
	blurEditorIfReadOnly,
	createEditorReadOnlyExtension,
} from "cm/editorReadOnly";
import { detectEol } from "cm/editorUtils";
import tag from "html-tag-js";
import lineEnding from "lib/lineEnding";
import { readRemoteFilePreview } from "utils/remoteFilePreview";
import { afterEach, expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	document.body.replaceChildren();
});

const managerSource = readFileSync("src/lib/editorManager.js", "utf8");
const managerBody = parse(managerSource, {
	sourceType: "module",
	plugins: ["jsx"],
}).program.body.find(
	(node) =>
		node.type === "FunctionDeclaration" && node.id.name === "EditorManager",
).body.body;

function setup() {
	vi.useFakeTimers();
	const cache = new Map([["file:///local.js", "local content"]]);
	const read = vi.fn(async (uri, encoding) => {
		const value = cache.get(uri);
		return ArrayBuffer.isView(value)
			? new TextDecoder(encoding).decode(value)
			: value;
	});
	const write = vi.fn(async (uri, text) => cache.set(uri, text));
	const stat = vi.fn(async () => ({}));
	const remote = {
		exists: async () => true,
		stat,
		readFile: vi.fn(async () => "remote content"),
	};
	const remoteFactory = vi.fn(() => remote);
	const localFs = (uri) => ({
		exists: async () => cache.has(uri),
		readFile: (encoding) => read(uri, encoding),
		stat,
		writeFile: (text) => write(uri, text),
		createFile: (name, text) => write(`${uri}/${name}`, text),
		delete: async () => cache.delete(uri),
	});
	const url = {
		join: (...parts) => parts.join("/"),
		basename: (value) => value.split("/").at(-1),
		getProtocol: (value) => `${value.split(":")[0]}:`,
	};
	const filesystem = loadSourceModule("src/fileSystem/index.js", {
		"lib/ajax": { get: remote.readFile },
		"utils/encodings": { decode: (value) => value },
		"utils/Url": url,
		"./internalFs": {
			test: (uri) => uri.startsWith("file:"),
			createFs: localFs,
		},
		"./externalFs": {
			test: (uri) => uri.startsWith("content:"),
			createFs: localFs,
		},
		"./ftp": {
			test: (uri) => uri.startsWith("ftp:"),
			fromUrl: remoteFactory,
		},
		"./sftp": {
			test: (uri) => uri.startsWith("sftp:"),
			fromUrl: remoteFactory,
		},
	});
	const { default: fs, onProviderRegistered } = filesystem;
	const settings = { value: {}, on: vi.fn(), off: vi.fn() };
	const manager = {
		TIMEOUT_VALUE: 0,
		files: [],
		activeFile: null,
		header: {},
		emit: vi.fn(),
		onupdate: vi.fn(),
		getFile: (id, key = "id") => manager.files.find((file) => file[key] === id),
		addFile: (file) => manager.files.push(file),
	};
	// Use the actual registration handler, with the same registry used by EditorFile.
	const registration = managerBody.find(
		(node) =>
			node.type === "ExpressionStatement" &&
			node.expression.callee?.name === "onProviderRegistered",
	);
	vm.runInNewContext(
		managerSource.slice(registration.start, registration.end),
		{ onProviderRegistered, manager, console },
	);
	const toast = vi.fn(),
		log = vi.fn();
	const confirm = vi.fn(async () => false);
	const prompt = vi.fn(async () => "");
	const error = vi.fn();
	const helpers = {
		normalizeMtime: (value) => value ?? null,
		getStatMtime: (value) => value?.modifiedDate ?? null,
		error,
		getIconForFile: () => "file",
		getVirtualPath: (value) => value,
		fixFilename: (value) => value,
		uuid: () => "promoted",
	};
	const selectLocation = vi.fn(async () => ({
		val: { url: "file:///export" },
	}));
	const { default: saveFile } = loadSourceModule(
		"src/lib/saveFile.js",
		{
			fileSystem: filesystem,
			"@codemirror/state": { Text },
			"cm/editorUtils": { detectEol, getDocText: (doc) => doc.toString() },
			"components/toast": toast,
			"dialogs/confirm": confirm,
			"dialogs/prompt": prompt,
			"dialogs/select": {},
			"lib/recents": {
				select: selectLocation,
				addFile: vi.fn(),
				addFolder: vi.fn(),
			},
			"pages/fileBrowser": {},
			"utils/helpers": helpers,
			"utils/Url": url,
			"./config": {},
			"./editorFile": {},
			"./lineEnding": lineEnding,
			"./openFolder": { find: () => null },
			"./settings": settings,
		},
		{ editorManager: manager, strings: {} },
	);
	const unused = Object.fromEntries(
		[
			"components/quickTools",
			"dialogs/confirm",
			"handlers/editorFileTab",
			"handlers/quickTools",
			"handlers/tabContextMenu",
			"dompurify",
			"mime-types",
			"utils/codeHighlight",
			"utils/Path",
			"./openFolder",
			"./run",
			"cm/editorReadOnly",
			"lib/quickToolsAdapter",
		].map((id) => [id, {}]),
	);
	const { default: EditorFile, AUTO_SAVE } = loadSourceModule(
		"src/lib/editorFile.js",
		{
			...unused,
			fileSystem: filesystem,
			"@codemirror/state": { EditorState, EditorSelection },
			"cm/editorUtils": { detectEol, getDocText: (doc) => doc.toString() },
			"cm/modelist": {
				getModeForPath: () => "text",
				getMode: () => ({ name: "text" }),
			},
			"components/sidebar": { hide: vi.fn() },
			"components/toast": toast,
			"components/tile": () => {
				const tile = document.createElement("li");
				tile.innerHTML = '<span class="text"></span>';
				tile.tail = vi.fn();
				return tile;
			},
			"html-tag-js": tag,
			"utils/Url": url,
			"utils/remoteFilePreview": { readRemoteFilePreview },
			"utils/helpers": helpers,
			"./config": { DEFAULT_FILE_SESSION: "default" },
			"./lineEnding": lineEnding,
			"./loadPlugins": { isInitialPluginLoadComplete: () => false },
			"./settings": settings,
			"./saveFile": saveFile,
		},
		{
			document,
			window: { log },
			tag,
			editorManager: manager,
			CACHE_STORAGE: "file:///cache",
			strings: {},
		},
	);
	EditorFile.prototype.setMode = vi.fn();
	EditorFile.prototype.render = function () {
		manager.activeFile = this;
	};
	const { default: restoreFiles } = loadSourceModule(
		"src/lib/restoreFiles.js",
		{ fileSystem: filesystem, "./editorFile": EditorFile },
	);
	return {
		AUTO_SAVE,
		EditorFile,
		confirm,
		prompt,
		error,
		stat,
		cache,
		read,
		write,
		remote,
		remoteFactory,
		fs,
		manager,
		toast,
		log,
		selectLocation,
		restoreFiles,
	};
}

it("restores populated and empty recovery caches as usable documents for every filesystem", async () => {
	const f = setup();
	const records = [
		"file",
		"content",
		"ftp",
		"sftp",
		"https",
		"gh",
		"plugin",
	].map((protocol, index) => {
		const text = index % 2 ? "unsaved content" : "";
		f.cache.set(`file:///cache/${protocol}`, text);
		return {
			id: protocol,
			filename: "file.js",
			uri: `${protocol}://example/file.js`,
			render: protocol === "gh",
			isUnsaved: !!text,
			docVersion: 7,
			savedVersion: text ? 4 : 7,
			cacheVersion: 7,
			savedMtime: 100,
			diskMtime: 200,
			hasDiskConflict: !!text,
			pinned: true,
			editable: protocol !== "https",
			encoding: "utf-16le",
			scrollTop: 120,
			cursorPos: { ranges: [{ from: text ? 5 : 0, to: text ? 5 : 0 }] },
		};
	});
	await f.restoreFiles(records);
	await Promise.all(f.manager.files.map((file) => file.load()));
	for (const [index, file] of f.manager.files.entries()) {
		const record = records[index];
		expect(file.loaded).toBe(true);
		expect(file.loading).toBe(false);
		expect(file.session.doc.toString()).toBe(f.cache.get(file.cacheFile));
		expect(file.session.selection.main.head).toBe(
			record.cursorPos.ranges[0].to,
		);
		for (const key of [
			"isUnsaved",
			"docVersion",
			"savedVersion",
			"cacheVersion",
			"savedMtime",
			"diskMtime",
			"hasDiskConflict",
			"pinned",
			"editable",
			"encoding",
		])
			expect(file[key]).toBe(record[key]);
		expect(file.lastScrollTop).toBe(120);
		expect(file.canSave).toBe(true);
		expect(f.read).toHaveBeenCalledWith(file.cacheFile, "utf-8");
	}
	const github = f.manager.activeFile;
	await github.save();
	expect(f.toast).toHaveBeenCalledWith("File provider unavailable");
	await github.saveAs(); // Cancelling the filename prompt still proves Save As is available.
	expect(f.selectLocation).toHaveBeenCalledOnce();
	github.session = EditorState.create({ doc: "new offline edit" });
	github.markEdited();
	await github.writeToCache();
	expect(f.cache.get(github.cacheFile)).toBe("new offline edit");
	expect(github.isUnsaved).toBe(true);
	await vi.advanceTimersByTimeAsync(65000);
	expect(github.tab).not.toBeNull();
	expect(f.cache.get(github.cacheFile)).toBe("new offline edit");
	f.fs.extend((uri) => /^(gh|plugin):/.test(uri), f.remoteFactory);
	await vi.runAllTimersAsync();
	expect(f.remoteFactory).not.toHaveBeenCalled();
	expect(f.remote.readFile).not.toHaveBeenCalled();
	expect(f.log).not.toHaveBeenCalled();
});

it("keeps uncached tabs idle, then resumes only matching open files without blocking local restoration", async () => {
	const f = setup();
	let finish;
	const response = new Promise((resolve) => {
		finish = resolve;
	});
	f.remote.readFile.mockReturnValue(response);
	await f.restoreFiles([
		{
			id: "pending",
			filename: "pending.js",
			uri: "custom://pending",
			cursorPos: { ranges: [{ from: 5, to: 5 }] },
		},
		{ id: "closed", filename: "closed.js", uri: "custom://closed" },
		{ id: "missing", filename: "missing.js", uri: "disabled://missing" },
		{
			id: "local",
			filename: "local.js",
			uri: "file:///local.js",
			render: true,
		},
		{ id: "http", filename: "remote.js", uri: "https://example/remote.js" },
		{ id: "closing", filename: "closing.js", uri: "custom://closing" },
	]);
	const [pending, closed, missing, local, http, closing] = f.manager.files;
	await local.flushCacheWrite();
	f.write.mockClear();
	expect(local.session.doc.toString()).toBe("local content");
	expect(http.loading).toBe(true);
	const firstAttempt = pending.load();
	await firstAttempt;
	expect(pending.load()).not.toBe(firstAttempt); // No promise is waiting for a plugin.
	await pending.load();
	expect(pending.loaded).toBe(false);
	expect(pending.loading).toBe(false);
	await pending.writeToCache();
	expect(await pending.save()).toBe(false);
	expect(await pending.saveAs()).toBe(false);
	expect(f.write).not.toHaveBeenCalled();
	expect(f.selectLocation).not.toHaveBeenCalled();
	await closed.remove(true);
	await vi.advanceTimersByTimeAsync(65000);
	expect(pending.tab).not.toBeNull();
	expect(missing.tab).not.toBeNull();
	f.fs.extend((uri) => uri.startsWith("custom:"), f.remoteFactory);
	f.fs.extend((uri) => uri.startsWith("custom:"), f.remoteFactory);
	await vi.advanceTimersByTimeAsync(0);
	expect(f.remote.readFile).toHaveBeenCalledTimes(3);
	expect(pending.loading).toBe(true);
	const completion = Promise.all([pending.load(), http.load(), closing.load()]);
	await closing.remove(true);
	finish("remote content");
	await completion;
	expect(pending.session.doc.toString()).toBe("remote content");
	expect(pending.session.selection.main.head).toBe(5);
	expect(pending.loading).toBe(false);
	expect(pending.loaded).toBe(true);
	expect(closed.session).toBeNull();
	expect(closing.session).toBeNull();
	expect(http.session.doc.toString()).toBe("remote content");
	expect(f.manager.activeFile).toBe(local);
	expect(missing.loaded).toBe(false);
	expect(missing.loading).toBe(false);
	await pending.flushCacheWrite();
	expect(f.cache.get(pending.cacheFile)).toBe("remote content");
	expect(f.toast).not.toHaveBeenCalled();
	expect(f.log).not.toHaveBeenCalled();
});

it("caches unchanged and empty documents from both opening paths, then restores without source reads", async () => {
	for (const supplied of [false, true]) {
		for (const text of ["café", ""]) {
			const f = setup();
			f.cache.set("file:///local.js", text);
			const record = {
				id: "initial",
				uri: "file:///local.js",
				filename: "local.js",
				encoding: "utf-16le",
				isUnsaved: false,
			};
			await f.restoreFiles([{ ...record, ...(supplied ? { text } : {}) }]);
			const file = f.manager.files[0];
			await file.flushCacheWrite();
			expect(f.cache.get(file.cacheFile)).toBe(text);
			expect(file.isUnsaved).toBe(false);
			await file.flushCacheWrite();
			expect(f.write).toHaveBeenCalledOnce();
			// Recovery bytes are UTF-8 even when the original file uses UTF-16.
			const reopened = setup();
			reopened.cache.set(file.cacheFile, new TextEncoder().encode(text));
			await reopened.restoreFiles([record]);
			const restored = reopened.manager.files[0];
			expect(restored.session.doc.toString()).toBe(text);
			expect(restored.encoding).toBe("utf-16le");
			expect(reopened.read.mock.calls.map(([uri]) => uri)).toEqual([
				file.cacheFile,
			]);
			expect(reopened.write).not.toHaveBeenCalled();
		}
	}
});

it("retries a failed initial cache write and removes an in-flight cache when its tab closes", async () => {
	const f = setup();
	f.write.mockRejectedValueOnce(Error("disk full"));
	await f.restoreFiles([
		{ id: "retry", uri: "file:///local.js", filename: "local.js" },
	]);
	await vi.runAllTimersAsync();
	const file = f.manager.files[0];
	expect(f.cache.has(file.cacheFile)).toBe(false);
	expect(file.cacheVersion).not.toBe(file.docVersion);
	await file.flushCacheWrite();
	expect(f.cache.get(file.cacheFile)).toBe("local content");
	let finish;
	f.write.mockImplementationOnce(
		(uri, text) =>
			new Promise((resolve) => {
				finish = () => {
					f.cache.set(uri, text);
					resolve();
				};
			}),
	);
	file.session.setValue("new edit");
	const writing = file.flushCacheWrite();
	await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
	await file.remove(true);
	finish();
	await writing;
	await vi.runAllTimersAsync();
	expect(f.cache.has(file.cacheFile)).toBe(false);
	expect(file.session).toBeNull();
});

it("checks a clean cache before saving, cancels safely, and shares overlapping overwrite requests", async () => {
	const f = setup();
	f.cache.set("file:///cache/stale", "old text");
	f.cache.set("file:///local.js", "external changes");
	await f.restoreFiles([
		{
			id: "stale",
			uri: "file:///local.js",
			filename: "local.js",
			isUnsaved: false,
		},
	]);
	const file = f.manager.files[0];
	expect(await file.save()).toBe(false);
	expect(f.cache.get(file.uri)).toBe("external changes");
	expect(f.cache.get(file.cacheFile)).toBe("old text");
	expect(file.hasDiskConflict).toBe(true);
	expect(file.isSaving).toBe(false);
	f.confirm.mockClear();
	expect(await file.save(f.AUTO_SAVE)).toBe(false);
	expect(f.confirm).not.toHaveBeenCalled();
	let approve;
	f.confirm.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				approve = resolve;
			}),
	);
	const saving = file.save();
	expect(file.save()).toBe(saving);
	await vi.waitFor(() => expect(approve).toBeTypeOf("function"));
	approve(true);
	expect(await saving).toBe(true);
	expect(f.confirm).toHaveBeenCalledOnce();
	expect(f.cache.get(file.uri)).toBe("old text");
	expect(file.isUnsaved).toBe(false);
	expect(file.hasDiskConflict).toBe(false);
});

it("verifies dirty recovery metadata and preserves unverifiable edits", async () => {
	for (const mtime of [10, 20, null]) {
		const f = setup();
		f.stat.mockResolvedValue({ modifiedDate: mtime });
		f.cache.set("file:///cache/dirty", "recovered edits");
		await f.restoreFiles([
			{
				id: "dirty",
				uri: "file:///local.js",
				filename: "local.js",
				isUnsaved: true,
				savedMtime: 10,
			},
		]);
		const file = f.manager.files[0];
		expect(await file.save()).toBe(mtime === 10);
		expect(f.confirm).toHaveBeenCalledTimes(mtime === 10 ? 0 : 1);
		expect(f.cache.get(file.uri)).toBe(
			mtime === 10 ? "recovered edits" : "local content",
		);
		expect(f.cache.get(file.cacheFile)).toBe("recovered edits");
	}
});

it("allows unchanged-source edits and stops failed or obsolete source verification", async () => {
	const f = setup();
	f.cache.set("file:///local.js", "local\r\ncontent");
	await f.restoreFiles([
		{ id: "safe", uri: "file:///local.js", filename: "local.js" },
	]);
	const file = f.manager.files[0];
	await file.flushCacheWrite();
	file.session.setValue("my edit");
	expect(await file.save(f.AUTO_SAVE)).toBe(true);
	expect(f.confirm).not.toHaveBeenCalled();
	expect(f.cache.get(file.uri)).toBe("my edit");
	f.read.mockRejectedValueOnce(Error("offline"));
	expect(await file.save()).toBe(false);
	expect(f.error).toHaveBeenCalledOnce();
	let finish;
	f.read.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const saving = file.save();
	await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
	await file.remove(true);
	const writes = f.write.mock.calls.length;
	finish("my edit");
	expect(await saving).toBe(false);
	expect(f.write).toHaveBeenCalledTimes(writes);
	await vi.runAllTimersAsync();
	expect(f.cache.has(file.cacheFile)).toBe(false);
});

function loadEolHelpers(f) {
	const { default: checkFiles } = loadSourceModule(
		"src/lib/checkFiles.js",
		{
			fileSystem: f.fs,
			"@codemirror/state": { Text },
			"cm/editorUtils": { detectEol },
			"dialogs/alert": vi.fn(),
			"dialogs/confirm": f.confirm,
			"utils/helpers": { getStatMtime: () => null },
			"./lineEnding": lineEnding,
		},
		{ editorManager: f.manager, strings: {}, app: { focus: vi.fn() } },
	);
	const storage = {};
	const { default: saveState } = loadSourceModule(
		"src/lib/saveState.js",
		{
			"cm/editorUtils": {
				getAllFolds: () => [],
				getScrollPosition: vi.fn(() => ({})),
				getSelection: vi.fn(),
			},
			"./config": { DEFAULT_FILE_SESSION: "default" },
			"./lineEnding": lineEnding,
			"./openFolder": { addedFolder: [] },
			"./settings": { value: { rememberFiles: true } },
		},
		{
			window: { editorManager: f.manager },
			editorManager: f.manager,
			localStorage: storage,
		},
	);
	return {
		checkFiles: async () => {
			// An inactive tab is reloaded through its stored session.
			f.manager.activeFile = null;
			f.manager.editor = { getCursorPosition: () => ({}), gotoLine: vi.fn() };
			for (const file of f.manager.files) file.makeActive = vi.fn();
			await checkFiles();
			delete f.manager.editor;
		},
		persist: () => {
			saveState();
			return JSON.parse(storage.files);
		},
	};
}

it("saves the opened line ending, writes both switched line endings, and keeps a saved CRLF file clean", async () => {
	const f = setup();
	const { checkFiles } = loadEolHelpers(f);
	f.cache.set("file:///local.js", "a\r\nb\r\n");
	await f.restoreFiles([
		{ id: "crlf", uri: "file:///local.js", filename: "local.js" },
	]);
	const file = f.manager.files[0];
	expect(file.eol).toBe("windows");
	file.session.setValue("a\nb\nc\n");
	expect(await file.save()).toBe(true);
	expect(f.cache.get(file.uri)).toBe("a\r\nb\r\nc\r\n");
	for (const [eol, text] of [
		["unix", "a\nb\nc\n"],
		["windows", "a\r\nb\r\nc\r\n"],
	]) {
		file.eol = eol;
		expect(file.isUnsaved).toBe(true);
		expect(await file.save()).toBe(true);
		expect(f.cache.get(file.uri)).toBe(text);
		expect(file.isUnsaved).toBe(false);
	}
	await checkFiles();
	expect(f.confirm).not.toHaveBeenCalled();

	// A switch made while the write is pending is kept after it completes.
	file.eol = "unix";
	f.write.mockImplementationOnce(async (uri, text) => {
		file.eol = "windows";
		f.cache.set(uri, text);
	});
	expect(await file.save()).toBe(true);
	expect(f.cache.get(file.uri)).toBe("a\nb\nc\n");
	expect(file.eol).toBe("windows");
	expect(file.isUnsaved).toBe(true);
});

it("takes the line ending from an accepted reload and refuses to overwrite a line-ending-only change", async () => {
	const f = setup();
	const { checkFiles } = loadEolHelpers(f);
	f.cache.set("file:///local.js", "a\r\nb\r\n");
	await f.restoreFiles([
		{ id: "crlf", uri: "file:///local.js", filename: "local.js" },
	]);
	const file = f.manager.files[0];
	file.eol = "windows";
	f.cache.set(file.uri, "a\nb\n");
	f.confirm.mockResolvedValueOnce(true);
	await checkFiles();
	expect(f.confirm).toHaveBeenCalledOnce();
	expect(file.eol).toBe("unix");
	expect(file.isUnsaved).toBe(false);
	file.session.setValue("a\nb\nc\n");
	expect(await file.save()).toBe(true);
	expect(f.cache.get(file.uri)).toBe("a\nb\nc\n");

	f.cache.set(file.uri, "a\r\nb\r\nc\r\n");
	file.session.setValue("my edit\n");
	expect(await file.save()).toBe(false);
	expect(f.confirm).toHaveBeenCalledTimes(2);
	expect(f.cache.get(file.uri)).toBe("a\r\nb\r\nc\r\n");

	// A matching mtime does not hide the change for a dirty cached tab.
	const g = setup();
	g.stat.mockResolvedValue({ modifiedDate: 5 });
	g.cache.set(file.uri, "a\nb\n");
	g.cache.set("file:///cache/dirty", "my edit\n");
	await g.restoreFiles([
		{
			id: "dirty",
			uri: file.uri,
			filename: "local.js",
			isUnsaved: true,
			savedMtime: 5,
			eol: "windows",
			savedEol: "windows",
		},
	]);
	expect(await g.manager.files[0].save()).toBe(false);
	expect(g.confirm).toHaveBeenCalledOnce();
	expect(g.cache.get(file.uri)).toBe("a\nb\n");
});

it("keeps a pending line-ending switch across restarts and saves legacy tabs with the source line ending", async () => {
	const f = setup();
	const { persist } = loadEolHelpers(f);
	f.cache.set("file:///local.js", "a\nb\n");
	await f.restoreFiles([
		{ id: "lf", uri: "file:///local.js", filename: "local.js" },
	]);
	const file = f.manager.files[0];
	await file.flushCacheWrite();
	file.eol = "windows";
	const pending = persist();
	let records = pending;
	for (const cached of [false, true]) {
		const g = setup();
		g.cache.set(file.uri, "a\nb\n");
		if (cached) g.cache.set(file.cacheFile, "a\nb\n");
		await g.restoreFiles(records);
		const restored = g.manager.files[0];
		expect(restored.eol).toBe("windows");
		expect(restored.isUnsaved).toBe(true);
		restored.eol = "unix";
		expect(restored.isUnsaved).toBe(false);
		restored.eol = "windows";
		expect(await restored.save()).toBe(true);
		expect(g.cache.get(file.uri)).toBe("a\r\nb\r\n");
		if (cached) records = loadEolHelpers(g).persist();
	}
	const saved = setup();
	saved.cache.set(file.cacheFile, "a\nb\n");
	await saved.restoreFiles(records);
	expect(saved.manager.files[0].eol).toBe("windows");
	expect(saved.manager.files[0].refreshUnsavedState()).toBe(false);

	// Without the cache, a source that already has the pending line ending is
	// clean, so a later external change still prompts.
	const c = setup();
	c.cache.set(file.uri, "a\r\nb\r\n");
	await c.restoreFiles(pending);
	expect(c.manager.files[0].eol).toBe("windows");
	expect(c.manager.files[0].isUnsaved).toBe(false);
	c.cache.set(file.uri, "a\nb\n");
	await loadEolHelpers(c).checkFiles();
	expect(c.confirm).toHaveBeenCalledOnce();

	// Sessions saved before line endings were recorded only have the cache.
	const g = setup();
	g.cache.set(file.uri, "a\r\nb\r\n");
	g.cache.set("file:///cache/legacy", "a\nb\n");
	await g.restoreFiles([
		{ id: "legacy", uri: file.uri, filename: "local.js", isUnsaved: false },
	]);
	const legacy = g.manager.files[0];
	legacy.session.setValue("a\nb\nc\n");
	expect(await legacy.save()).toBe(true);
	expect(g.cache.get(file.uri)).toBe("a\r\nb\r\nc\r\n");
	expect(legacy.eol).toBe("windows");
	legacy.eol = "unix";
	expect(await legacy.save()).toBe(true);
	expect(g.cache.get(file.uri)).toBe("a\nb\nc\n");

	// A choice on an older tab wins; Replace in Files text keeps the source's.
	const h = setup();
	h.cache.set(file.uri, "a\r\nb\r\n");
	h.cache.set("file:///cache/legacy", "a\nb\n");
	h.cache.set("file:///other.js", "a\nb\n");
	await h.restoreFiles([
		{ id: "legacy", uri: file.uri, filename: "local.js" },
		{
			id: "replaced",
			uri: "file:///other.js",
			filename: "other.js",
			text: "x\r\ny\n",
			isUnsaved: true,
			savedMtime: 5,
		},
	]);
	h.stat.mockResolvedValue({ modifiedDate: 5 });
	h.manager.files[0].eol = "unix";
	// Save All only saves tabs marked unsaved.
	expect(h.manager.files[0].isUnsaved).toBe(true);
	expect(await h.manager.files[0].save()).toBe(true);
	expect(h.cache.get(file.uri)).toBe("a\nb\n");
	expect(await h.manager.files[1].save()).toBe(true);
	expect(h.cache.get("file:///other.js")).toBe("x\ny\n");

	// Switching the initial untitled tab makes it part of the session.
	const untitled = new h.EditorFile();
	untitled.eol = "windows";
	expect(untitled.isUnsaved).toBe(true);
	const record = loadEolHelpers(h)
		.persist()
		.find((item) => item.id === untitled.id);
	expect(record).toMatchObject({ eol: "windows" });
});

it("keeps the source line ending when Save As copies a tab restored from an older session", async () => {
	const f = setup();
	f.cache.set("file:///local.js", "a\r\nb\r\n");
	f.cache.set("file:///cache/legacy", "a\nb\n");
	await f.restoreFiles([
		{ id: "legacy", uri: "file:///local.js", filename: "local.js" },
	]);
	expect(f.read.mock.calls.map(([uri]) => uri)).toEqual([
		"file:///cache/legacy",
	]);
	f.prompt.mockResolvedValueOnce("local.js");
	// The new URI gives the tab an id from Acode's String#hashCode, which the
	// realm EditorFile runs in doesn't have.
	new f.EditorFile.constructor("String.prototype.hashCode = () => 1")();
	expect(await f.manager.files[0].saveAs()).toBe(true);
	expect(f.cache.get("file:///export/local.js")).toBe("a\r\nb\r\n");
});

it("drops a pending line-ending switch when the file is reopened with another encoding", async () => {
	const f = setup();
	f.cache.set("file:///local.js", "a\nb\n");
	await f.restoreFiles([
		{ id: "lf", uri: "file:///local.js", filename: "local.js" },
	]);
	const file = f.manager.files[0];
	await file.load();
	file.eol = "windows";
	const { reopenWithNewEncoding } = loadSourceModule(
		"src/palettes/changeEncoding/index.js",
		{
			fileSystem: f.fs,
			"cm/editorUtils": { detectEol },
			"components/palette": vi.fn(),
			"dialogs/confirm": async () => true,
			"lib/lineEnding": lineEnding,
			"utils/encodings": {},
		},
		{
			editorManager: {
				...f.manager,
				activeFile: file,
				editor: {
					getCursorPosition: () => ({}),
					moveCursorToPosition: vi.fn(),
				},
			},
			strings: { "change encoding": "" },
		},
	);
	await reopenWithNewEncoding("utf-8");
	expect(file.eol).toBe("unix");
	expect(file.isUnsaved).toBe(false);
	file.session.setValue("a\nb\nc\n");
	expect(await file.save()).toBe(true);
	expect(f.cache.get(file.uri)).toBe("a\nb\nc\n");
});

it("continues resume checks past unavailable, failing, and read-only HTTP providers", async () => {
	const f = setup();
	f.cache.set("file:///cache/offline", "cached");
	f.cache.set("file:///cache/broken", "cached");
	f.cache.set("file:///cache/http", "remote content");
	await f.restoreFiles([
		{
			id: "local",
			uri: "file:///local.js",
			filename: "local.js",
			encoding: "utf-8",
		},
		{
			id: "http",
			uri: "https://example/file",
			filename: "file",
			readOnly: true,
		},
		{ id: "broken", uri: "broken://file", filename: "file" },
		{
			id: "offline",
			uri: "disabled://file",
			filename: "file",
			isUnsaved: true,
		},
		{ id: "pending", uri: "disabled://pending", filename: "pending" },
	]);
	await Promise.all(f.manager.files.map((file) => file.load()));
	f.fs.extend(
		(uri) => uri.startsWith("broken:"),
		() => ({
			exists: async () => {
				throw Error("offline");
			},
		}),
	);
	const warn = vi.fn();
	const { default: checkFiles } = loadSourceModule(
		"src/lib/checkFiles.js",
		{
			fileSystem: f.fs,
			"@codemirror/state": { Text },
			"cm/editorUtils": { detectEol },
			"dialogs/alert": vi.fn(),
			"dialogs/confirm": f.confirm,
			"utils/helpers": { getStatMtime: () => null },
			"./lineEnding": lineEnding,
		},
		{ editorManager: f.manager, strings: {}, console: { warn } },
	);
	f.read.mockClear();
	await checkFiles();
	expect(warn).toHaveBeenCalledOnce();
	expect(f.read).toHaveBeenCalledWith("file:///local.js", "utf-8");
	expect(f.confirm).not.toHaveBeenCalled();
	expect(f.cache.get("file:///cache/offline")).toBe("cached");
	expect(f.manager.files.every((file) => file.tab)).toBe(true);
});

it.each([
	"cached text",
	"",
	undefined,
])("keeps the loading view for cache %j until the session is ready", (cached) => {
	const source = managerSource;
	const body = managerBody;
	const names = [
		"showLoadingEditor",
		"applyFileToEditor",
		"recreateActiveEditorState",
		"getRawEditorState",
		"isReusableEditorState",
	];
	const editor = new EditorView({ parent: document.body });
	const file = {
		type: "editor",
		filename: "file.js",
		loaded: false,
		loading: false,
		session: EditorState.create(),
		__cmSessionReady: true,
		__cmExtensionSignature: "test",
	};
	const loadingPreviews = new WeakMap();
	if (cached !== undefined) loadingPreviews.set(file, cached);
	const context = vm.createContext({
		editor,
		EditorState,
		placeholder,
		createEditorReadOnlyExtension,
		blurEditorIfReadOnly,
		canvasRenderer: false,
		loadingPreviews,
		manager: { activeFile: file },
		touchSelectionController: null,
		themeCompartment: new Compartment(),
		languageCompartment: new Compartment(),
		lspCompartment: new Compartment(),
		readOnlyCompartment: new Compartment(),
		getConfiguredThemeExtension: () => [],
		getBaseExtensionsFromOptions: () => [],
		getEditorExtensionSignature: () => "test",
		getFileLanguageSignature: () => "text",
		applyCurrentEditorOptions: vi.fn(),
		shouldApplyLanguage: () => false,
		restoreFileScrollPosition: vi.fn(),
		scheduleLspForFile: vi.fn(),
	});
	// Run the actual render functions with a real EditorView; omit the unrelated app shell.
	vm.runInContext(
		body
			.filter(
				(node) =>
					node.type === "FunctionDeclaration" && names.includes(node.id.name),
			)
			.map((node) => source.slice(node.start, node.end))
			.join("\n"),
		context,
	);
	try {
		const savedSession = file.session;
		context.applyFileToEditor(file);
		const preview = editor.state;
		context.recreateActiveEditorState();
		expect(editor.state).toBe(preview);
		context.applyFileToEditor(file, { forceRecreate: true });
		expect(editor.state.doc.toString()).toBe(cached ?? "");
		expect(editor.state.readOnly).toBe(true);
		expect(editor.contentDOM.getAttribute("contenteditable")).toBe("false");
		expect(
			editor.dom.querySelector(".cm-placeholder")?.textContent ?? null,
		).toBe(cached === undefined ? "Loading file.js..." : null);
		expect(file.session).toBe(savedSession);
		file.session = EditorState.create({ doc: cached ?? "loaded text" });
		file.loaded = true;
		file.loading = false;
		context.applyFileToEditor(file);
		expect(editor.state).toBe(file.session);
		expect(editor.state.readOnly).toBe(false);
		expect(editor.dom.querySelector(".cm-placeholder")).toBeNull();
	} finally {
		editor.destroy();
	}
});
