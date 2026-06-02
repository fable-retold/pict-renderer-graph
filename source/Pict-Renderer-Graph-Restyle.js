/**
 * Pict-Renderer-Graph-Restyle.js
 *
 * Apply a resolved style profile to Excalidraw elements that were produced
 * by something OTHER than our notebook generator -- principally the
 * @excalidraw/mermaid-to-excalidraw output, which builds elements with
 * mermaid's own flat defaults (no roughness, no hand-drawn font, mermaid's
 * palette).
 *
 * Mermaid owns the STRUCTURE (every element's x / y / width / height stays
 * exactly where mermaid's dagre/ELK pass put it). We own the INK: stroke
 * palette, roughness, stroke width, fill style, hand-drawn font, and a
 * deterministic per-element seed so the same source always wobbles the same
 * way.
 *
 * The seed helpers mirror scripts/Generate-Notebook-Diagram.js so a restyled
 * mermaid scene and a natively-generated scene share one notion of "the
 * same hand". fontFamilyMap is imported from there (single source of truth).
 */

const _FontFamilyMap = require('pict-section-excalidraw/scripts/Generate-Notebook-Diagram.js').fontFamilyMap
	|| { 'Excalifont': 5, 'Helvetica': 2, 'Cascadia': 3, 'Lilita One': 7 };
const _DefaultFontFamily = 5; // Excalifont

// Excalifont renders wider + taller than mermaid's default metrics at the same
// point size, so mermaid-sized boxes overflow once we swap the font in. Scale
// the text down uniformly to bring it back inside the boxes (and keep the
// whole diagram visually consistent rather than per-box-fitted).
const _MermaidFontScale = 0.8;

// Tiny deterministic FNV-1a hash -> integer (matches the generator).
function hashString(pStr)
{
	let tmpHash = 2166136261;
	for (let i = 0; i < pStr.length; i++)
	{
		tmpHash ^= pStr.charCodeAt(i);
		tmpHash = (tmpHash * 16777619) >>> 0;
	}
	return tmpHash >>> 0;
}

function seedFor(pProfile, pComponentKey)
{
	let tmpSalt  = (pProfile && pProfile.RandomSeedSalt) || 0;
	let tmpRange = (pProfile && pProfile.SeedRange) || [ 1, 99999 ];
	let tmpRaw   = hashString(pComponentKey + ':' + tmpSalt);
	let tmpSpan  = tmpRange[1] - tmpRange[0] + 1;
	return tmpRange[0] + (tmpRaw % tmpSpan);
}

function fontFamilyIndex(pProfile)
{
	let tmpName = (pProfile && pProfile.FontFamily) || 'Excalifont';
	return _FontFamilyMap[tmpName] || _DefaultFontFamily;
}

/**
 * Restyle an array of Excalidraw elements in place with a style profile.
 * Geometry is preserved; only paint / font / roughness / seed change.
 *
 * @param {Array}  pElements - excalidraw elements (mutated in place)
 * @param {object} pProfile  - resolved style profile (Palette, Roughness, ...)
 * @returns {Array} the same array, restyled
 */
function restyleElements(pElements, pProfile)
{
	if (!Array.isArray(pElements) || !pProfile)
	{
		return pElements;
	}

	let tmpPalette     = pProfile.Palette || {};
	let tmpInk         = tmpPalette.ink || '#1B1F23';
	let tmpEdge        = tmpPalette.link || tmpInk;
	let tmpPaper       = tmpPalette.paper || '#FBF7EE';
	let tmpDeemphasis  = tmpPalette.deemphasis || tmpInk;
	let tmpRoughness   = (pProfile.Roughness !== undefined) ? pProfile.Roughness : 1;
	let tmpStrokeWidth = pProfile.StrokeWidth || 2;
	let tmpStrokeStyle = pProfile.StrokeStyle || 'solid';
	let tmpFillStyle   = pProfile.FillStyle || 'hachure';
	let tmpRoundness   = (pProfile.Roundness !== undefined) ? pProfile.Roundness : { type: 2 };
	let tmpFontCode    = fontFamilyIndex(pProfile);

	for (let i = 0; i < pElements.length; i++)
	{
		let tmpElement = pElements[i];
		if (!tmpElement || !tmpElement.type)
		{
			continue;
		}
		let tmpKey = tmpElement.id || ('element-' + i);

		switch (tmpElement.type)
		{
			case 'rectangle':
			case 'ellipse':
			case 'diamond':
				tmpElement.strokeColor = tmpInk;
				tmpElement.strokeWidth = tmpStrokeWidth;
				tmpElement.strokeStyle = tmpStrokeStyle;
				tmpElement.roughness   = tmpRoughness;
				tmpElement.seed        = seedFor(pProfile, 'shape:' + tmpKey);
				// Keep a fill only where mermaid actually filled the shape;
				// recolor it toward the warm paper tone with a hand-drawn
				// hachure. Unfilled shapes stay outline-only (cleanest look).
				if (tmpElement.backgroundColor && tmpElement.backgroundColor !== 'transparent')
				{
					tmpElement.backgroundColor = tmpPaper;
					tmpElement.fillStyle       = tmpFillStyle;
				}
				else
				{
					tmpElement.backgroundColor = 'transparent';
				}
				// Ellipses have no roundness; rectangles/diamonds take the profile's.
				if (tmpElement.type !== 'ellipse')
				{
					tmpElement.roundness = tmpRoundness;
				}
				break;

			case 'text':
				tmpElement.strokeColor = tmpInk;
				tmpElement.fontFamily  = tmpFontCode;
				// Scale down so the wider/taller Excalifont fits the box mermaid
				// sized for its own narrower font.
				if (typeof tmpElement.fontSize === 'number')
				{
					tmpElement.fontSize = Math.max(11, Math.round(tmpElement.fontSize * _MermaidFontScale));
				}
				tmpElement.seed        = seedFor(pProfile, 'label:' + tmpKey);
				break;

			case 'arrow':
			case 'line':
				tmpElement.strokeColor = tmpEdge;
				tmpElement.strokeWidth = tmpStrokeWidth;
				tmpElement.strokeStyle = tmpStrokeStyle;
				// Connectors read cleaner without wobble -- the hand-drawn feel
				// lives in the shapes; jittery arrows just look noisy. The path
				// itself (perpendicular landings) is repaired by rerouteArrows.
				tmpElement.roughness   = 0;
				tmpElement.seed        = seedFor(pProfile, 'edge:' + tmpKey);
				break;

			case 'frame':
				// Subgraph / cluster container: a quiet, de-emphasized outline.
				tmpElement.strokeColor = tmpDeemphasis;
				break;

			default:
				break;
		}
	}

	return pElements;
}

/**
 * Parse a mermaid source into a node-id -> label map, so an emphasis hint can
 * name a node by its short id (db) or its displayed label (Database).  Matches
 * the common node declarations: id[label], id(label), id([label]), id[(label)],
 * id{label}, id((label)).  Nodes that only appear in edges (no declared label)
 * are simply their own id and are matched by id directly.
 */
function buildIdLabelMap(pMermaid)
{
	let tmpMap = {};
	if (typeof pMermaid !== 'string') { return tmpMap; }
	// Quoted labels first -- id["...anything, incl. () [] {} ..."] -- the
	// quotes bound the label so parens/brackets inside it are safe.
	let tmpQuoted = /\b([A-Za-z0-9_]+)\s*[\[\(\{]+\s*"([^"]*)"/g;
	let tmpMatch;
	while ((tmpMatch = tmpQuoted.exec(pMermaid)))
	{
		if (tmpMatch[2].trim()) { tmpMap[tmpMatch[1]] = tmpMatch[2].trim(); }
	}
	// Then unquoted labels -- id[label], id(label), id{label}, id([label]),
	// id[(label)] -- stopping at the first closing bracket (no nested parens).
	let tmpUnquoted = /\b([A-Za-z0-9_]+)\s*[\[\(\{]+([^\]\)\}|"]+?)[\]\)\}]+/g;
	while ((tmpMatch = tmpUnquoted.exec(pMermaid)))
	{
		let tmpLabel = tmpMatch[2].replace(/^["']|["']$/g, '').trim();
		if (tmpLabel && !tmpMap[tmpMatch[1]]) { tmpMap[tmpMatch[1]] = tmpLabel; }
	}
	return tmpMap;
}

/**
 * Apply emphasis hints to a restyled scene.  Each hint names a node (by id or
 * label) and a treatment: accent (palette accent stroke), dim (palette
 * deemphasis stroke), bold (thicker shape outline).  Matching is by the node's
 * label text -- the only stable identifier in mermaid-to-excalidraw output --
 * resolved through buildIdLabelMap so short ids work too.  Geometry is never
 * touched (no overlap risk).
 *
 * @param {Array}  pElements - excalidraw elements (mutated)
 * @param {Array}  pEmphasis - [ { node|nodes, accent?, dim?, bold? } ]
 * @param {string} pMermaid  - the mermaid source (for id -> label)
 * @param {object} pProfile  - resolved style profile (palette)
 * @returns {Array} the same array
 */
function applyEmphasis(pElements, pEmphasis, pMermaid, pProfile)
{
	if (!Array.isArray(pElements) || !Array.isArray(pEmphasis) || !pEmphasis.length)
	{
		return pElements;
	}
	let tmpPalette = (pProfile && pProfile.Palette) || {};
	let tmpAccent  = tmpPalette.accent || '#C9602F';
	let tmpDim     = tmpPalette.deemphasis || '#8A7F72';
	let tmpStrokeWidth = (pProfile && pProfile.StrokeWidth) || 2;

	let tmpIdLabel = buildIdLabelMap(pMermaid);
	// Normalize for matching: drop HTML tags (labels may carry <b>/<i>/<br/>)
	// and all whitespace (mermaid turns <br/> into newlines in the element
	// text), then lowercase. Makes "L1" -> "Layer 1<br/>Fable" match the
	// rendered "Layer 1\nFable" text element.
	let tmpNorm = (pStr) => String(pStr == null ? '' : pStr).replace(/<[^>]+>/g, '').replace(/\s+/g, '').toLowerCase();

	let tmpTextByLabel = {};
	let tmpById = {};
	for (let i = 0; i < pElements.length; i++)
	{
		let tmpEl = pElements[i];
		tmpById[tmpEl.id] = tmpEl;
		if (tmpEl.type === 'text') { tmpTextByLabel[tmpNorm(tmpEl.text)] = tmpEl; }
	}

	for (let h = 0; h < pEmphasis.length; h++)
	{
		let tmpHint  = pEmphasis[h] || {};
		let tmpNodes = Array.isArray(tmpHint.nodes) ? tmpHint.nodes : (tmpHint.node ? [ tmpHint.node ] : []);
		for (let n = 0; n < tmpNodes.length; n++)
		{
			let tmpRef    = tmpNodes[n];
			let tmpLabel  = tmpIdLabel[tmpRef] || tmpRef;
			let tmpTextEl = tmpTextByLabel[tmpNorm(tmpLabel)] || tmpTextByLabel[tmpNorm(tmpRef)];
			if (!tmpTextEl) { continue; }
			let tmpShapeEl = tmpTextEl.containerId ? tmpById[tmpTextEl.containerId] : null;
			let tmpTargets = tmpShapeEl ? [ tmpTextEl, tmpShapeEl ] : [ tmpTextEl ];
			for (let t = 0; t < tmpTargets.length; t++)
			{
				let tmpTarget = tmpTargets[t];
				if (tmpHint.dim)         { tmpTarget.strokeColor = tmpDim; }
				else if (tmpHint.accent) { tmpTarget.strokeColor = tmpAccent; }
				if (tmpHint.bold && tmpTarget.type !== 'text')
				{
					tmpTarget.strokeWidth = tmpStrokeWidth + 1.5;
				}
			}
		}
	}
	return pElements;
}

// Greedy word-wrap a string to a maximum character count per line.
function _greedyWrap(pText, pMaxChars)
{
	let tmpWords = String(pText == null ? '' : pText).split(/\s+/).filter((w) => w.length);
	if (!tmpWords.length) { return ['']; }
	let tmpLines = [];
	let tmpCurrent = '';
	for (let i = 0; i < tmpWords.length; i++)
	{
		let tmpWord = tmpWords[i];
		if (!tmpCurrent) { tmpCurrent = tmpWord; }
		else if ((tmpCurrent.length + 1 + tmpWord.length) <= pMaxChars) { tmpCurrent += ' ' + tmpWord; }
		else { tmpLines.push(tmpCurrent); tmpCurrent = tmpWord; }
	}
	if (tmpCurrent) { tmpLines.push(tmpCurrent); }
	return tmpLines;
}

// Map a mermaid source's labels to their author-intended <br/> segments,
// keyed by the label's break-stripped, lowercased text (so a rendered text
// element can be matched back to its original label).
function _labelSegmentsMap(pMermaid)
{
	let tmpMap = {};
	if (typeof pMermaid !== 'string') { return tmpMap; }
	// Match key: strip tags and ALL whitespace. mermaid-to-excalidraw breaks
	// labels at arbitrary points -- including mid-token (e.g. "Fable-Settings"
	// rendered as "Fable-\nSettings") -- so collapsing whitespace to a single
	// space would leave a spurious gap that fails to match the source label.
	// Removing whitespace entirely makes the key invariant to where it broke.
	let tmpJoinKey = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/\s+/g, '').toLowerCase();
	let tmpToSegments = (pLabel) => pLabel.split(/<br\s*\/?>/i).map((s) => s.replace(/<[^>]+>/g, '').trim()).filter((s) => s.length);

	let tmpQuoted = /[\[\(\{]+\s*"([^"]*)"/g;
	let tmpMatch;
	while ((tmpMatch = tmpQuoted.exec(pMermaid)))
	{
		let tmpSegs = tmpToSegments(tmpMatch[1]);
		if (tmpSegs.length) { tmpMap[tmpJoinKey(tmpMatch[1])] = tmpSegs; }
	}
	let tmpUnquoted = /[\[\(\{]+([^\]\)\}|"]+?)[\]\)\}]+/g;
	while ((tmpMatch = tmpUnquoted.exec(pMermaid)))
	{
		let tmpKey = tmpJoinKey(tmpMatch[1]);
		if (tmpMap[tmpKey]) { continue; }
		let tmpSegs = tmpToSegments(tmpMatch[1]);
		if (tmpSegs.length) { tmpMap[tmpKey] = tmpSegs; }
	}
	return tmpMap;
}

/**
 * Re-flow text elements to undo mermaid-to-excalidraw's broken auto-wrap (it
 * strands the first comma/hyphen token on its own line). We rebuild each
 * label from its author-intended <br/> segments and greedy-wrap every segment
 * to the widest line that ALREADY fit the box -- so the result is sensible and
 * guaranteed to fit (no font measurement needed).
 *
 * @param {Array}  pElements - excalidraw elements (mutated)
 * @param {string} pMermaid  - the original mermaid source (for the labels)
 * @returns {Array} the same array
 */
function reflowText(pElements, pMermaid)
{
	if (!Array.isArray(pElements)) { return pElements; }
	let tmpMap = _labelSegmentsMap(pMermaid);
	// Same whitespace-insensitive key as _labelSegmentsMap: the rendered text's
	// line breaks (wherever mermaid put them, mid-token included) vanish, so it
	// matches the source label regardless of how badly it was wrapped.
	let tmpJoinKey = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/\s+/g, '').toLowerCase();

	for (let i = 0; i < pElements.length; i++)
	{
		let tmpEl = pElements[i];
		if (tmpEl.type !== 'text' || (typeof tmpEl.text !== 'string')) { continue; }
		let tmpSegments = tmpMap[tmpJoinKey(tmpEl.text)];
		if (!tmpSegments) { continue; }

		// The widest line mermaid already produced fits the box; wrap to it.
		let tmpExisting = tmpEl.text.split('\n');
		let tmpMaxChars = 1;
		for (let l = 0; l < tmpExisting.length; l++) { tmpMaxChars = Math.max(tmpMaxChars, tmpExisting[l].length); }

		let tmpLines = [];
		for (let s = 0; s < tmpSegments.length; s++) { tmpLines = tmpLines.concat(_greedyWrap(tmpSegments[s], tmpMaxChars)); }
		// Only adopt the re-flow if it doesn't add lines (stays inside the box).
		if (tmpLines.length <= tmpExisting.length) { tmpEl.text = tmpLines.join('\n'); }
	}
	return pElements;
}

// Outward unit normals for each box edge -- the same notion as
// pict-section-flow's GeometryProvider.sideDirection.
const _SideRight  = { dx: 1,  dy: 0 };
const _SideLeft   = { dx: -1, dy: 0 };
const _SideTop    = { dx: 0,  dy: -1 };
const _SideBottom = { dx: 0,  dy: 1 };

/**
 * Infer which edge of a box an anchor point sits on and return that edge's
 * outward normal. Mermaid attaches connector endpoints at (or just outside) an
 * edge midpoint, so the nearest edge is the side the connector should depart /
 * approach along.
 */
function _inferSide(pX, pY, pBox)
{
	let tmpX = (typeof pBox.x === 'number') ? pBox.x : 0;
	let tmpY = (typeof pBox.y === 'number') ? pBox.y : 0;
	let tmpW = pBox.width  || 0;
	let tmpH = pBox.height || 0;
	let tmpToLeft   = Math.abs(pX - tmpX);
	let tmpToRight  = Math.abs(pX - (tmpX + tmpW));
	let tmpToTop    = Math.abs(pY - tmpY);
	let tmpToBottom = Math.abs(pY - (tmpY + tmpH));
	let tmpMin = Math.min(tmpToLeft, tmpToRight, tmpToTop, tmpToBottom);
	if (tmpMin === tmpToRight)  { return _SideRight; }
	if (tmpMin === tmpToLeft)   { return _SideLeft; }
	if (tmpMin === tmpToBottom) { return _SideBottom; }
	return _SideTop;
}

/**
 * Re-route bound connectors so they leave and enter their boxes perpendicular
 * to the edge -- the clean-landing trick pict-section-flow's PathGenerator uses
 * (a short departure/approach stub along each side's outward normal, then a
 * smooth curve between). This replaces mermaid-to-excalidraw's dagre spline --
 * whose tail often curls into the target at a steep, swooping angle -- with
 * start -> depart -> approach -> end drawn as a rounded (type 2) curve, so the
 * arrowhead always meets its box square-on.
 *
 * Mermaid still owns WHERE each endpoint attaches (we keep its first/last
 * points and the bindings); we only fix the ANGLE of departure and arrival and
 * the shape of the path between. Excalidraw's SVG export draws a linear
 * element straight from its `points`, so these waypoints are exactly what
 * renders; the retained bindings keep the scene hand-editable.
 *
 * @param {Array}  pElements - excalidraw elements (mutated in place)
 * @param {object} pProfile  - resolved style profile (reserved; parity with siblings)
 * @returns {Array} the same array
 */
function rerouteArrows(pElements, pProfile)
{
	if (!Array.isArray(pElements)) { return pElements; }

	let tmpById = {};
	for (let i = 0; i < pElements.length; i++)
	{
		if (pElements[i] && pElements[i].id) { tmpById[pElements[i].id] = pElements[i]; }
	}

	for (let i = 0; i < pElements.length; i++)
	{
		let tmpArrow = pElements[i];
		if (!tmpArrow || (tmpArrow.type !== 'arrow' && tmpArrow.type !== 'line')) { continue; }
		if (!Array.isArray(tmpArrow.points) || tmpArrow.points.length < 2) { continue; }

		let tmpStartId = tmpArrow.startBinding && tmpArrow.startBinding.elementId;
		let tmpEndId   = tmpArrow.endBinding   && tmpArrow.endBinding.elementId;
		let tmpBoxA = tmpStartId ? tmpById[tmpStartId] : null;
		let tmpBoxB = tmpEndId   ? tmpById[tmpEndId]   : null;
		// Need both ends bound to a distinct box to know the edges to land on;
		// unbound connectors and self-loops are left exactly as mermaid drew them.
		if (!tmpBoxA || !tmpBoxB || tmpBoxA === tmpBoxB) { continue; }

		let tmpX = tmpArrow.x || 0;
		let tmpY = tmpArrow.y || 0;
		let tmpFirst = tmpArrow.points[0];
		let tmpLast  = tmpArrow.points[tmpArrow.points.length - 1];
		let tmpStartX = tmpX + tmpFirst[0];
		let tmpStartY = tmpY + tmpFirst[1];
		let tmpEndX   = tmpX + tmpLast[0];
		let tmpEndY   = tmpY + tmpLast[1];

		let tmpSideA = _inferSide(tmpStartX, tmpStartY, tmpBoxA);
		let tmpSideB = _inferSide(tmpEndX,   tmpEndY,   tmpBoxB);

		let tmpDX = tmpEndX - tmpStartX;
		let tmpDY = tmpEndY - tmpStartY;
		let tmpDist = Math.sqrt(tmpDX * tmpDX + tmpDY * tmpDY);
		// Stub length: long enough to set a clean perpendicular tangent, short
		// enough not to overshoot a tight gap -- about a quarter of the span,
		// clamped (mirrors PathGenerator's modest fixed departure distance).
		let tmpStub = Math.max(8, Math.min(26, tmpDist * 0.25));

		let tmpAbs =
		[
			{ x: tmpStartX,                          y: tmpStartY },
			{ x: tmpStartX + tmpSideA.dx * tmpStub,  y: tmpStartY + tmpSideA.dy * tmpStub },
			{ x: tmpEndX   + tmpSideB.dx * tmpStub,  y: tmpEndY   + tmpSideB.dy * tmpStub },
			{ x: tmpEndX,                            y: tmpEndY }
		];

		let tmpMinX = Infinity, tmpMinY = Infinity, tmpMaxX = -Infinity, tmpMaxY = -Infinity;
		for (let p = 0; p < tmpAbs.length; p++)
		{
			tmpMinX = Math.min(tmpMinX, tmpAbs[p].x); tmpMaxX = Math.max(tmpMaxX, tmpAbs[p].x);
			tmpMinY = Math.min(tmpMinY, tmpAbs[p].y); tmpMaxY = Math.max(tmpMaxY, tmpAbs[p].y);
		}
		// Re-anchor at the (unchanged) start point; express the rest relative.
		tmpArrow.x = tmpStartX;
		tmpArrow.y = tmpStartY;
		tmpArrow.points = tmpAbs.map((pt) => [ pt.x - tmpStartX, pt.y - tmpStartY ]);
		tmpArrow.width  = tmpMaxX - tmpMinX;
		tmpArrow.height = tmpMaxY - tmpMinY;
		// Smooth (Catmull-Rom) curve through the four points: perpendicular
		// tangents at both ends, a gentle bow between -- no dagre swoop.
		tmpArrow.roundness = { type: 2 };
	}

	return pElements;
}

module.exports =
{
	restyleElements: restyleElements,
	applyEmphasis:   applyEmphasis,
	reflowText:      reflowText,
	rerouteArrows:   rerouteArrows,
	buildIdLabelMap: buildIdLabelMap,
	seedFor:         seedFor,
	fontFamilyIndex: fontFamilyIndex
};
