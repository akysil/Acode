const savedEols = new WeakMap();
const choices = new WeakMap();

/**
 * Line-ending state of an EditorFile, kept out of the class exposed to plugins
 * and shared with saveFile, checkFiles and saveState. The document always uses
 * "\n"; the line ending is applied when the file is written.
 */
export default {
	/**
	 * Line ending of the file on disk: null when there is none to keep,
	 * undefined when not read yet (older session, unsaved replacement text).
	 * @param {object} file
	 * @returns {'windows'|'unix'|null|undefined}
	 */
	saved: (file) => savedEols.get(file),
	/**
	 * Line ending the user selected, null when none.
	 * @param {object} file
	 * @returns {'windows'|'unix'|null}
	 */
	choice: (file) => choices.get(file) ?? null,
	/**
	 * Sets the line ending on disk; a reload also drops the selected one.
	 * @param {object} file
	 * @param {'windows'|'unix'|null} savedEol
	 * @param {boolean} [reload]
	 */
	setSaved(file, savedEol, reload = false) {
		savedEols.set(file, savedEol);
		if (reload) choices.delete(file);
	},
	/**
	 * @param {object} file
	 * @param {'windows'|'unix'} eol
	 */
	choose(file, eol) {
		choices.set(file, eol);
	},
};
