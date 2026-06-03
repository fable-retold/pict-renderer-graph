/**
 * Pict-Renderer-Graph-Convert.js
 *
 * Pure logic for the bulk "convert inline mermaid -> native diagram" pass:
 * find the fenced ```mermaid blocks in a markdown document, classify each by
 * diagram type, derive a stable file name + alt text, and rewrite the document
 * so each SUPPORTED fence (flow / sequence / er) becomes an image reference to
 * a rendered SVG sidecar -- the same shape the hand-authored architecture docs
 * use:
 *
 *     <!-- bespoke diagram: edit diagrams/<name>.mmd, then: npx pict-renderer-graph build <dir> -->
 *     ![<alt>](diagrams/<name>.svg)
 *
 * Unsupported types (class / state / gantt / pie / gitGraph / ...) are left as
 * inline mermaid so they keep rendering through the client-side fallback.
 *
 * No file I/O or rendering here -- the CLI command orchestrates that. This
 * module is deterministic + unit-testable.
 */

// Map a mermaid body to its diagram bucket + (where we render natively) the
// renderer `type`.
function classifyMermaid(pBody)
{
	let tmpBody = String(pBody == null ? '' : pBody);
	let tmpBucket =
		/^\s*sequenceDiagram\b/m.test(tmpBody) ? 'sequence'
		: /^\s*erDiagram\b/m.test(tmpBody)      ? 'er'
		: /^\s*classDiagram\b/m.test(tmpBody)   ? 'class'
		: /^\s*stateDiagram/m.test(tmpBody)     ? 'state'
		: /^\s*(?:graph|flowchart)\b/m.test(tmpBody) ? 'flow'
		: /^\s*gantt\b/m.test(tmpBody)          ? 'gantt'
		: /^\s*pie\b/m.test(tmpBody)            ? 'pie'
		: /^\s*gitGraph\b/m.test(tmpBody)       ? 'gitGraph'
		: /^\s*mindmap\b/m.test(tmpBody)        ? 'mindmap'
		: 'other';
	let tmpNative = { flow: 'flowgraph', sequence: 'seqgraph', er: 'ergraph' };
	return { bucket: tmpBucket, supported: !!tmpNative[tmpBucket], type: tmpNative[tmpBucket] || null };
}

// Find every ```mermaid fence, with its character span, body, classification,
// and the nearest preceding markdown heading (used to name + describe it).
function extractMermaidFences(pMarkdown)
{
	let tmpText = String(pMarkdown == null ? '' : pMarkdown);
	let tmpFences = [];
	// Capture the optional leading indentation so the rewrite can preserve it.
	let tmpFenceRe = /(^|\n)([ \t]*)```mermaid[^\n]*\n([\s\S]*?)```/g;
	let tmpMatch;
	while ((tmpMatch = tmpFenceRe.exec(tmpText)))
	{
		let tmpLead    = tmpMatch[1];                 // '' or '\n'
		let tmpIndent  = tmpMatch[2] || '';
		let tmpStart   = tmpMatch.index + tmpLead.length;   // start of the indentation/fence
		let tmpEnd     = tmpFenceRe.lastIndex;              // just past the closing ```
		let tmpBody    = tmpMatch[3];
		tmpFences.push(
		{
			start:   tmpStart,
			end:     tmpEnd,
			indent:  tmpIndent,
			body:    tmpBody,
			heading: _nearestHeading(tmpText.slice(0, tmpStart)),
			class:   classifyMermaid(tmpBody)
		});
	}
	return tmpFences;
}

// A fenced block is a directory tree (not a box diagram / table / code) when it
// has at least two box-drawing branch connectors (├── / └──) and NO box top
// corners (┌ ┐ ╔ ╗ — those mark a drawn box or wireframe, never a tree).  This
// is the same discriminator the ASCII audit used to separate the 96 trees from
// the box-art, so it routes exactly the tree blocks to the filetree renderer.
function _looksLikeTree(pBody)
{
	let tmpLines = String(pBody == null ? '' : pBody).replace(/\r/g, '').split('\n');
	let tmpConnectors = 0;
	for (let i = 0; i < tmpLines.length; i++)
	{
		if (/[┌┐╔╗]/.test(tmpLines[i])) { return false; }
		if (/^[ \t│]*[├└][─-]+/.test(tmpLines[i])) { tmpConnectors++; }
	}
	return tmpConnectors >= 2;
}

// Find every fenced code block that is a directory tree (any language tag except
// `mermaid`, which the mermaid path owns), with its span, indentation, body, and
// nearest heading -- the same record shape extractMermaidFences returns, so the
// CLI can plan tree jobs alongside diagram jobs.
function extractTreeBlocks(pMarkdown)
{
	let tmpText = String(pMarkdown == null ? '' : pMarkdown);
	let tmpBlocks = [];
	let tmpFenceRe = /(^|\n)([ \t]*)```([^\n]*)\n([\s\S]*?)```/g;
	let tmpMatch;
	while ((tmpMatch = tmpFenceRe.exec(tmpText)))
	{
		let tmpLang = (tmpMatch[3] || '').trim().toLowerCase();
		if (tmpLang === 'mermaid') { continue; }
		let tmpBody = tmpMatch[4];
		if (!_looksLikeTree(tmpBody)) { continue; }
		let tmpLead   = tmpMatch[1];
		let tmpStart  = tmpMatch.index + tmpLead.length;
		tmpBlocks.push(
		{
			start:   tmpStart,
			end:     tmpFenceRe.lastIndex,
			indent:  tmpMatch[2] || '',
			body:    tmpBody,
			heading: _nearestHeading(tmpText.slice(0, tmpStart))
		});
	}
	return tmpBlocks;
}

// The last markdown ATX heading before an offset, or null.
function _nearestHeading(pBefore)
{
	let tmpRe = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
	let tmpHeading = null;
	let tmpMatch;
	while ((tmpMatch = tmpRe.exec(pBefore))) { tmpHeading = tmpMatch[1].trim(); }
	// Strip inline markdown emphasis / code ticks / links to a clean phrase.
	if (tmpHeading)
	{
		tmpHeading = tmpHeading.replace(/[`*_]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
	}
	return tmpHeading || null;
}

// Slugify a phrase into a file-name-safe token (capped), or '' if empty.
function slugify(pText)
{
	return String(pText == null ? '' : pText)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/g, '');
}

// Pick a unique diagram file name from the nearest heading (falling back to the
// document base + index), registering it in pUsed so siblings don't collide.
function deriveDiagramName(pHeading, pUsed, pFallbackBase, pIndex)
{
	let tmpBase = slugify(pHeading) || (slugify(pFallbackBase) + '-' + (pIndex + 1));
	if (!tmpBase) { tmpBase = 'diagram-' + (pIndex + 1); }
	let tmpName = tmpBase;
	let tmpN = 2;
	while (pUsed[tmpName]) { tmpName = tmpBase + '-' + (tmpN++); }
	pUsed[tmpName] = true;
	return tmpName;
}

// The markdown that replaces a converted fence: a regen comment + image ref,
// indentation preserved.
function buildImageReference(pName, pAlt, pBuildDir, pIndent)
{
	let tmpIndent = pIndent || '';
	let tmpAlt = String(pAlt == null || pAlt === '' ? 'diagram' : pAlt).replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
	let tmpBuild = pBuildDir ? (' then: npx pict-renderer-graph build ' + pBuildDir) : '';
	return tmpIndent + '<!-- bespoke diagram: edit diagrams/' + pName + '.mmd or .hints.json,' + tmpBuild + ' -->\n' +
		tmpIndent + '![' + tmpAlt + '](diagrams/' + pName + '.svg)';
}

// Apply a set of { start, end, text } replacements to a string, back-to-front
// so earlier offsets stay valid.
function applyReplacements(pText, pReplacements)
{
	let tmpText = String(pText == null ? '' : pText);
	let tmpSorted = pReplacements.slice().sort((a, b) => b.start - a.start);
	for (let i = 0; i < tmpSorted.length; i++)
	{
		let tmpR = tmpSorted[i];
		tmpText = tmpText.slice(0, tmpR.start) + tmpR.text + tmpText.slice(tmpR.end);
	}
	return tmpText;
}

module.exports =
{
	classifyMermaid:      classifyMermaid,
	extractMermaidFences: extractMermaidFences,
	extractTreeBlocks:    extractTreeBlocks,
	slugify:              slugify,
	deriveDiagramName:    deriveDiagramName,
	buildImageReference:  buildImageReference,
	applyReplacements:    applyReplacements
};
