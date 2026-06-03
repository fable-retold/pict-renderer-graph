/**
 * Pict-Renderer-Graph-FileTree-Parse.js
 *
 * Parse an ASCII directory-tree block into a flat list of rows the filetree
 * handler can lay out.  Handles the two conventions the docs use:
 *
 *   box-drawing:   │   ├── source/        # comment
 *                  │   └── package.json
 *   ascii:         |   |-- source/
 *                  |   `-- package.json
 *
 * The first non-empty, non-connector line is the root.  Every other line is a
 * child: the run of indentation columns before its connector gives its depth,
 * the vertical bars in that run tell us which ancestor branches are still open
 * (so the renderer can draw the guide rails), and a trailing `# …` or a
 * run of 2+ spaces splits an inline comment off the name.
 *
 * Output:
 *   {
 *     root: '<name>' | null,
 *     rows:
 *     [
 *       {
 *         depth:    int,        // root children are depth 1
 *         name:     string,     // trailing '/' stripped (the icon shows dir-ness)
 *         kind:     'dir'|'file',
 *         comment:  string,     // '' when none
 *         last:     bool,       // this node is the last child of its parent (└)
 *         bars:     [bool,...]  // ancestor levels 0..depth-2: rail still open?
 *       }, ...
 *     ]
 *   }
 */

// A branch connector: ├── └── (box) or |-- `-- (ascii), any dash count, with the
// indentation rails (spaces / │ / |) it hangs off captured ahead of it.  The
// full match ends exactly where the node's name begins.
const _ConnRe = /^([ \t│|]*)([├└]─+|`-+|\|-+)[ \t]?/;

function _stripComment(pRest)
{
	let tmpRest = String(pRest == null ? '' : pRest);
	// An inline comment is introduced by ` # ` or by a run of 2+ spaces that
	// pads the name out to an aligned description column.
	let tmpMatch = tmpRest.match(/^(.*?)(?:\s+#\s?|\s{2,})(.+)$/);
	if (tmpMatch)
	{
		return { name: tmpMatch[1].trim(), comment: tmpMatch[2].trim().replace(/^#\s?/, '') };
	}
	return { name: tmpRest.trim(), comment: '' };
}

function parseFileTree(pSource)
{
	let tmpLines = String(pSource == null ? '' : pSource).replace(/\r/g, '').split('\n');

	// Each non-empty line -> the column where its NAME starts (its content
	// column).  This is uniform whether the line uses a branch connector or
	// plain indentation, so depth, forests (several top-level nodes), and
	// glyph-less trees all rank the same way.
	let tmpItems = [];
	for (let i = 0; i < tmpLines.length; i++)
	{
		let tmpLine = tmpLines[i];
		if (!tmpLine.trim()) { continue; }

		let tmpConn = tmpLine.match(_ConnRe);
		let tmpCol  = tmpConn ? tmpConn[0].length : (tmpLine.match(/^[ \t]*/) || [ '' ])[0].length;
		let tmpNC   = _stripComment(tmpLine.slice(tmpCol));
		if (!tmpNC.name && !tmpNC.comment) { continue; }
		let tmpSlash = /\/\s*$/.test(tmpNC.name);
		tmpItems.push({ col: tmpCol, name: tmpNC.name.replace(/\/+$/, ''), comment: tmpNC.comment, slash: tmpSlash });
	}
	if (!tmpItems.length) { return { rows: [] }; }

	// Rank distinct content columns -> depth (0-based; top-level nodes = depth 0).
	let tmpCols = [];
	for (let i = 0; i < tmpItems.length; i++)
	{
		if (tmpCols.indexOf(tmpItems[i].col) < 0) { tmpCols.push(tmpItems[i].col); }
	}
	tmpCols.sort((a, b) => a - b);

	let tmpRows = tmpItems.map((pItem) => (
	{
		depth:   tmpCols.indexOf(pItem.col),
		name:    pItem.name,
		comment: pItem.comment,
		slash:   pItem.slash,
		kind:    pItem.slash ? 'dir' : 'file'
	}));

	// A node with a deeper node beneath it is a directory even without a slash.
	for (let i = 0; i < tmpRows.length; i++)
	{
		if (tmpRows[i].kind === 'file' && i + 1 < tmpRows.length && tmpRows[i + 1].depth > tmpRows[i].depth)
		{
			tmpRows[i].kind = 'dir';
		}
	}

	// Structural last-child + open-ancestor rails (derived from the depth
	// sequence, not from │ glyphs -- some trees draw none).  A node is its
	// parent's last child when the next same-or-shallower node is shallower.
	let _isLast = (pIdx) =>
	{
		let tmpD = tmpRows[pIdx].depth;
		for (let j = pIdx + 1; j < tmpRows.length; j++)
		{
			if (tmpRows[j].depth < tmpD) { return true; }
			if (tmpRows[j].depth === tmpD) { return false; }
		}
		return true;
	};
	let tmpPath = [];   // tmpPath[d] = index of the current node at depth d
	for (let i = 0; i < tmpRows.length; i++)
	{
		let tmpD = tmpRows[i].depth;
		tmpPath[tmpD] = i;
		tmpPath.length = tmpD + 1;
		tmpRows[i].last = _isLast(i);
		// Ancestor rails 0..depth-2: open when the path node one level deeper than
		// the ancestor is NOT a last child (the ancestor has more to come).
		let tmpBars = [];
		for (let L = 0; L < tmpD - 1; L++)
		{
			let tmpAnc = tmpPath[L + 1];
			tmpBars.push(tmpAnc != null ? !_isLast(tmpAnc) : false);
		}
		tmpRows[i].bars = tmpBars;
	}

	return { rows: tmpRows };
}

module.exports =
{
	parseFileTree: parseFileTree,
	// exported for tests
	_stripComment: _stripComment
};
