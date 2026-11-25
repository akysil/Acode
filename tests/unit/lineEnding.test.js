// @vitest-environment happy-dom

import { EditorSelection, EditorState, Text } from "@codemirror/state";
import tag from "html-tag-js";
import { afterEach, expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

function setup() {
	const manager = {
		files: [],
		getFile: () => null,
		addFile: (file) => manager.files.push(file),
		emit: vi.fn(),
		onupdate: vi.fn(),
		activeFile: null,
		TIMEOUT_VALUE: 0,
	};
	const defaults = Object.fromEntries(
		[
			"fileSystem",
			"components/quickTools",
			"components/toast",
			"dialogs/confirm",
			"handlers/editorFileTab",
			"handlers/quickTools",
			"lib/quickToolsAdapter",
			"handlers/tabContextMenu",
			"dompurify",
			"mime-types",
			"utils/codeHighlight",
			"utils/Path",
			"utils/remoteFilePreview",
			"utils/Url",
			"./loadPlugins",
			"./openFolder",
			"./run",
			"./saveFile",
			"cm/editorReadOnly",
		].map((id) => [id, {}]),
	);
	const getDocText = (doc) => doc.toString();
	const { default: EditorFile } = loadSourceModule(
		"src/lib/editorFile.js",
		{
			...defaults,
			"components/sidebar": { hide: vi.fn() },
			"@codemirror/state": { EditorState, EditorSelection },
			"cm/editorUtils": { getDocText },
			"cm/modelist": {
				getModeForPath: () => "text",
				getMode: () => ({
					name: "text",
					extensions: [],
					getExtension: () => [],
				}),
			},
			"html-tag-js": tag,
			"components/tile": (options) => {
				const element = document.createElement("li");
				element.innerHTML = '<span class="text"></span>';
				element.tail = vi.fn();
				element.text = options.text;
				return element;
			},
			"utils/helpers": {
				normalizeMtime: () => null,
				getIconForFile: () => "file",
			},
			"./config": { DEFAULT_FILE_SESSION: "default" },
			"./settings": { value: {}, on: vi.fn(), off: vi.fn() },
		},
		{ document, window, tag, editorManager: manager },
	);
	EditorFile.prototype.setMode = vi.fn();
	EditorFile.prototype.writeToCache = vi.fn(async () => {});
	const file = (text, options = {}) =>
		new EditorFile("test.txt", {
			id: String(manager.files.length),
			uri: "file:///test.txt",
			render: false,
			text,
			...options,
		});

	const disk = { text: "", write: vi.fn() };
	const fileOnDevice = {
		readFile: async () => disk.text,
		writeFile: async (data) => {
			disk.text = data;
			disk.write(data);
		},
		stat: async () => null,
	};
	const { default: saveFile } = loadSourceModule(
		"src/lib/saveFile.js",
		{
			fileSystem: {
				__esModule: true,
				default: () => fileOnDevice,
				hasProvider: () => true,
			},
			"@codemirror/state": { Text },
			"cm/editorUtils": { getDocText },
			"components/toast": vi.fn(),
			"dialogs/confirm": vi.fn(async () => true),
			"dialogs/prompt": vi.fn(),
			"dialogs/select": vi.fn(),
			"lib/recents": {},
			"pages/fileBrowser": vi.fn(),
			"utils/helpers": { getStatMtime: () => null, error: vi.fn() },
			"utils/Url": {},
			"./config": {},
			"./editorFile": EditorFile,
			"./openFolder": {},
			"./settings": { value: {} },
		},
		{ editorManager: manager, strings: {}, acode: { exec: vi.fn() } },
	);
	return { file, saveFile, disk, manager };
}
afterEach(() => document.body.replaceChildren());

it("detects the line ending of the opened text", () => {
	const f = setup();
	expect(f.file("a\r\nb\r\n").eol).toBe("windows");
	expect(f.file("a\nb\n").eol).toBe("unix");
	expect(f.file("a\r\nb", { eol: "unix" }).eol).toBe("unix");
});

it("keeps a switched line ending as an unsaved change", () => {
	const f = setup();
	const file = f.file("a\nb");
	expect(file.isUnsaved).toBe(false);
	file.eol = "windows";
	expect(file.eol).toBe("windows");
	expect(file.refreshUnsavedState()).toBe(true);
	file.eol = "unix";
	expect(file.refreshUnsavedState()).toBe(false);
});

it("saves CRLF files with CRLF and writes the switched line ending", async () => {
	const f = setup();
	f.disk.text = "a\r\nb\r\n";
	const file = f.file(f.disk.text);
	file.session.setValue("a\nb\nc\n");
	expect(await f.saveFile(file)).toBe(true);
	expect(f.disk.write).toHaveBeenLastCalledWith("a\r\nb\r\nc\r\n");

	file.eol = "unix";
	expect(file.isUnsaved).toBe(true);
	expect(await f.saveFile(file)).toBe(true);
	expect(f.disk.write).toHaveBeenLastCalledWith("a\nb\nc\n");
	expect(file.isUnsaved).toBe(false);
});
