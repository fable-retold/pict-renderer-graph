/**
 * Diagram-FileTree.js
 *
 * Native directory-tree path: parse an ASCII file tree ourselves and render it
 * as a hand-drawn, theme-adaptive tree -- folder / file glyphs, sketchy guide
 * rails recreated from the tree's branch structure, names in the notebook font,
 * and inline `# comments` set as a light aligned annotation column.
 *
 * A directory tree is a hierarchy *listing*, not a box-and-arrow graph, so it
 * gets its own renderer rather than being forced through the flow/dagre path
 * (which would scatter a 30-file tree into node-link spaghetti).  The layout is
 * deterministic: one row per node, x = depth * indent, rails drawn from each
 * row's open-ancestor flags + last-child flag.
 *
 * Input graph shape:
 *   { type:'filetree', title?, style?, tree:'<ascii tree>' }
 *     -- or, pre-parsed --
 *   { type:'filetree', title?, root:'<name>', rows:[ {depth,name,kind,comment,last,bars} ] }
 */

const libParse   = require('../Pict-Renderer-Graph-FileTree-Parse.js');
const libRestyle = require('../Pict-Renderer-Graph-Restyle.js');

const _CHAR_W = 0.58;   // rough glyph-width factor for sizing text columns

// Stroke tint per file extension -- a quiet hue cue, not a full repaint.  Kept
// muted so it reads on both light and dark paper; folders use the theme accent.
const _ExtTint =
{
	js: '#C99A2E', mjs: '#C99A2E', cjs: '#C99A2E', ts: '#2F6FB0',
	json: '#B5651D', md: '#3E73B5', markdown: '#3E73B5',
	sh: '#3F8F4F', bash: '#3F8F4F', css: '#8E5BB5', html: '#C0552F', htm: '#C0552F',
	svg: '#1F8A70', png: '#1F8A70', jpg: '#1F8A70', gif: '#1F8A70',
	yml: '#B5651D', yaml: '#B5651D', sql: '#9A6A2F', txt: '#7C7268'
};

function _palette(pProfile)
{
	let tmpP = (pProfile && pProfile.Palette) || {};
	return {
		ink:    tmpP.ink    || '#1B1F23',
		paper:  tmpP.paper  || '#FBF7EE',
		accent: tmpP.accent || '#C9602F',
		deemph: tmpP.deemphasis || '#8A7F72'
	};
}

function _baseShape(pId, pType, pProfile, pSeed)
{
	return {
		id: pId, type: pType, x: 0, y: 0, width: 0, height: 0, angle: 0,
		strokeColor: _palette(pProfile).ink, backgroundColor: 'transparent',
		fillStyle: (pProfile && pProfile.FillStyle) || 'hachure',
		strokeWidth: (pProfile && pProfile.StrokeWidth) || 2,
		strokeStyle: 'solid',
		roughness: (pProfile && pProfile.Roughness !== undefined) ? pProfile.Roughness : 1,
		opacity: 100, groupIds: [], frameId: null, roundness: null,
		seed: pSeed, version: 1, versionNonce: pSeed, isDeleted: false,
		boundElements: [], updated: 1, link: null, locked: false, index: null
	};
}

function _rect(pId, pX, pY, pW, pH, pProfile, pSeed, pOpts)
{
	let tmpOpts = pOpts || {};
	let tmpEl = _baseShape(pId, 'rectangle', pProfile, pSeed);
	tmpEl.x = pX; tmpEl.y = pY; tmpEl.width = pW; tmpEl.height = pH;
	tmpEl.roundness = (tmpOpts.roundness !== undefined) ? tmpOpts.roundness : { type: 3 };
	if (tmpOpts.rough !== undefined) { tmpEl.roughness = tmpOpts.rough; }
	if (tmpOpts.strokeColor) { tmpEl.strokeColor = tmpOpts.strokeColor; }
	if (tmpOpts.strokeWidth) { tmpEl.strokeWidth = tmpOpts.strokeWidth; }
	if (tmpOpts.fill) { tmpEl.backgroundColor = tmpOpts.fill; tmpEl.fillStyle = 'solid'; }
	return tmpEl;
}

function _line(pId, pX, pY, pPoints, pProfile, pSeed, pOpts)
{
	let tmpOpts = pOpts || {};
	let tmpEl = _baseShape(pId, 'line', pProfile, pSeed);
	tmpEl.x = pX; tmpEl.y = pY;
	tmpEl.roundness = null;
	tmpEl.roughness = (tmpOpts.rough !== undefined) ? tmpOpts.rough : 0;
	tmpEl.strokeColor = tmpOpts.strokeColor || _palette(pProfile).ink;
	tmpEl.strokeWidth = tmpOpts.strokeWidth || ((pProfile && pProfile.StrokeWidth) || 2);
	let tmpMinX = Infinity, tmpMinY = Infinity, tmpMaxX = -Infinity, tmpMaxY = -Infinity;
	for (let i = 0; i < pPoints.length; i++)
	{
		tmpMinX = Math.min(tmpMinX, pPoints[i][0]); tmpMaxX = Math.max(tmpMaxX, pPoints[i][0]);
		tmpMinY = Math.min(tmpMinY, pPoints[i][1]); tmpMaxY = Math.max(tmpMaxY, pPoints[i][1]);
	}
	tmpEl.width = tmpMaxX - tmpMinX; tmpEl.height = tmpMaxY - tmpMinY;
	tmpEl.points = pPoints;
	tmpEl.lastCommittedPoint = null;
	tmpEl.startBinding = null; tmpEl.endBinding = null;
	tmpEl.startArrowhead = null; tmpEl.endArrowhead = null;
	return tmpEl;
}

function _text(pId, pText, pX, pY, pW, pH, pFontSize, pProfile, pColor, pSeed, pAlign)
{
	let tmpFontIdx = libRestyle.fontFamilyIndex(pProfile);
	return {
		id: pId, type: 'text', x: pX, y: pY, width: pW, height: pH, angle: 0,
		strokeColor: pColor || _palette(pProfile).ink, backgroundColor: 'transparent',
		fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 1, opacity: 100,
		groupIds: [], frameId: null, roundness: null,
		seed: pSeed, version: 1, versionNonce: pSeed, isDeleted: false, boundElements: null,
		updated: 1, link: null, locked: false,
		text: pText, fontSize: pFontSize, fontFamily: tmpFontIdx,
		textAlign: pAlign || 'left', verticalAlign: 'top',
		containerId: null, originalText: pText, autoResize: true, lineHeight: 1.25, index: null
	};
}

// ---- icon glyphs ------------------------------------------------------------

// Folder: a small tab + body, drawn in the theme accent over paper fill so it
// sits cleanly on top of the guide rails.
function _folderIcon(pX, pY, pSize, pProfile, pSeed)
{
	let tmpPal = _palette(pProfile);
	let tmpW = pSize, tmpH = Math.round(pSize * 0.82);
	let tmpY = pY + Math.round((pSize - tmpH) / 2);
	let tmpTabW = Math.round(tmpW * 0.5), tmpTabH = Math.round(tmpH * 0.30);
	let tmpOut = [];
	tmpOut.push(_rect('ft-fold-tab-' + pSeed, pX, tmpY, tmpTabW, tmpTabH + 3, pProfile, pSeed,
		{ roundness: { type: 3 }, strokeColor: tmpPal.accent, strokeWidth: 1.6, fill: tmpPal.paper, rough: 0.5 }));
	tmpOut.push(_rect('ft-fold-body-' + pSeed, pX, tmpY + tmpTabH, tmpW, tmpH - tmpTabH, pProfile, pSeed + 1,
		{ roundness: { type: 3 }, strokeColor: tmpPal.accent, strokeWidth: 1.6, fill: tmpPal.paper, rough: 0.5 }));
	return tmpOut;
}

// File: a portrait page with a folded top-right corner; stroke tinted by ext.
function _fileIcon(pX, pY, pSize, pName, pProfile, pSeed)
{
	let tmpPal = _palette(pProfile);
	let tmpW = Math.round(pSize * 0.78), tmpH = pSize;
	let tmpX = pX + Math.round((pSize - tmpW) / 2), tmpY = pY;
	let tmpExt = (String(pName).match(/\.([A-Za-z0-9]+)$/) || [])[1];
	let tmpStroke = (tmpExt && _ExtTint[tmpExt.toLowerCase()]) || tmpPal.ink;
	let tmpFold = Math.round(tmpW * 0.36);
	let tmpOut = [];
	tmpOut.push(_rect('ft-file-body-' + pSeed, tmpX, tmpY, tmpW, tmpH, pProfile, pSeed,
		{ roundness: { type: 3 }, strokeColor: tmpStroke, strokeWidth: 1.6, fill: tmpPal.paper, rough: 0.5 }));
	// folded corner: a short elbow at the top-right
	tmpOut.push(_line('ft-file-fold-' + pSeed, tmpX + tmpW - tmpFold, tmpY,
		[ [ 0, 0 ], [ tmpFold, tmpFold ], [ 0, tmpFold ], [ 0, 0 ] ], pProfile, pSeed + 1,
		{ strokeColor: tmpStroke, strokeWidth: 1.3, rough: 0 }));
	return tmpOut;
}

function _ellipse(pId, pCX, pCY, pR, pProfile, pSeed, pOpts)
{
	let tmpOpts = pOpts || {};
	let tmpEl = _baseShape(pId, 'ellipse', pProfile, pSeed);
	tmpEl.x = pCX - pR; tmpEl.y = pCY - pR; tmpEl.width = pR * 2; tmpEl.height = pR * 2;
	tmpEl.roughness = (tmpOpts.rough !== undefined) ? tmpOpts.rough : 0;
	tmpEl.strokeColor = tmpOpts.strokeColor || _palette(pProfile).ink;
	tmpEl.strokeWidth = tmpOpts.strokeWidth || ((pProfile && pProfile.StrokeWidth) || 2);
	tmpEl.backgroundColor = tmpOpts.fill || _palette(pProfile).paper;
	tmpEl.fillStyle = 'solid';
	return tmpEl;
}

// Generic node: a small filled dot.  Used for concept / hierarchy trees (class
// inheritance, numbered process steps) where folder + file glyphs would
// mislabel the nodes.  Parents read in accent, leaves in the deemphasis ink.
function _nodeIcon(pX, pY, pSize, pProfile, pSeed, pParent)
{
	let tmpPal = _palette(pProfile);
	let tmpR = Math.max(3, Math.round(pSize * 0.20));
	let tmpColor = pParent ? tmpPal.accent : tmpPal.deemph;
	return [ _ellipse('ft-node-' + pSeed, pX + Math.round(pSize / 2), pY + Math.round(pSize / 2), tmpR, pProfile, pSeed,
		{ strokeColor: tmpColor, strokeWidth: 1.4, fill: tmpColor, rough: 0 }) ];
}

const _Geom =
{
	leftPad: 18, topPad: 16, indentPx: 30, gapIconName: 10, gapNameComment: 26
};

module.exports =
{
	name:        'filetree',
	description: 'Hand-drawn directory tree: folder/file glyphs, guide rails, comments as a light annotation column.',
	async:       false,

	toScene: function (pGraph, pProfile, pVendor, fCallback)
	{
		let tmpPal = _palette(pProfile);
		let tmpFont = (pProfile && pProfile.FontSize) || 20;
		let tmpNameFont = tmpFont;
		let tmpCommentFont = Math.max(11, Math.round(tmpFont * 0.8));
		let tmpIcon = Math.round(tmpFont * 0.95);
		let tmpRowH = Math.round(tmpFont * 1.75);

		// Resolve input -> a flat row list with the root prepended as depth 0.
		// The source arrives as `tree`/`source` from a direct call, or in the
		// `mermaid` field from the shared convert/build sidecar pipeline (the
		// .mmd sidecar is just "the diagram source", whatever its dialect).
		let tmpParsed = (Array.isArray(pGraph.rows))
			? { rows: pGraph.rows }
			: libParse.parseFileTree(pGraph.tree || pGraph.source || pGraph.mermaid || '');

		// Depth-0 rows ARE the roots (the parser models a forest -- a tree can have
		// several top-level nodes, e.g. a numbered process).
		let tmpRows = tmpParsed.rows.slice();

		// Filesystem tree (folder/file glyphs) vs concept hierarchy (neutral dots).
		// An explicit trailing slash or a file extension anywhere marks it as a
		// real directory tree; class/inheritance/process trees have neither.
		let tmpIsFsTree = false;
		for (let i = 0; i < tmpRows.length; i++)
		{
			if (tmpRows[i].slash || /\.[A-Za-z0-9]{1,8}$/.test(String(tmpRows[i].name))) { tmpIsFsTree = true; break; }
		}

		let _iconX = (pDepth) => _Geom.leftPad + pDepth * _Geom.indentPx;
		let _railX = (pLevel) => _Geom.leftPad + pLevel * _Geom.indentPx + Math.round(tmpIcon / 2);
		let _nameX = (pDepth) => _iconX(pDepth) + tmpIcon + _Geom.gapIconName;

		// Measure the name column so comments align into a tidy second column.
		let tmpMaxNameExtent = 0;
		for (let i = 0; i < tmpRows.length; i++)
		{
			let tmpR = tmpRows[i];
			let tmpNameW = Math.ceil(String(tmpR.name).length * tmpNameFont * _CHAR_W);
			let tmpExtent = _nameX(tmpR.depth) + tmpNameW;
			if (tmpExtent > tmpMaxNameExtent) { tmpMaxNameExtent = tmpExtent; }
		}
		let tmpCommentX = tmpMaxNameExtent + _Geom.gapNameComment;

		let tmpElements = [];
		let tmpTitleH = 0;
		if (pGraph.title)
		{
			let tmpTF = Math.round(tmpFont * 1.15);
			tmpElements.push(_text('ft-title', String(pGraph.title),
				_Geom.leftPad, _Geom.topPad, Math.ceil(String(pGraph.title).length * tmpTF * _CHAR_W) + 8,
				Math.round(tmpTF * 1.4), tmpTF, pProfile, tmpPal.ink, libRestyle.seedFor(pProfile, 'ft:title'), 'left'));
			tmpTitleH = Math.round(tmpTF * 2.0);
		}

		for (let i = 0; i < tmpRows.length; i++)
		{
			let tmpR = tmpRows[i];
			let tmpRowY = _Geom.topPad + tmpTitleH + i * tmpRowH;
			let tmpMidY = tmpRowY + Math.round(tmpRowH / 2);
			let tmpSeed = libRestyle.seedFor(pProfile, 'ft:' + i + ':' + tmpR.name);

			// --- guide rails (skip for the root row) ---
			if (tmpR.depth >= 1)
			{
				// Open ancestor rails: a vertical spanning the whole row.
				for (let k = 0; k < (tmpR.bars || []).length; k++)
				{
					if (!tmpR.bars[k]) { continue; }
					tmpElements.push(_line('ft-rail-' + i + '-' + k, _railX(k), tmpRowY,
						[ [ 0, 0 ], [ 0, tmpRowH ] ], pProfile, tmpSeed + 30 + k,
						{ strokeColor: tmpPal.deemph, strokeWidth: 1.3, rough: 0.5 }));
				}
				// This node's own connector at level depth-1: vertical down to the
				// elbow (half row if it's the last child, else through the row) + a
				// horizontal stub to the icon.
				let tmpPX = _railX(tmpR.depth - 1);
				let tmpDownTo = tmpR.last ? Math.round(tmpRowH / 2) : tmpRowH;
				tmpElements.push(_line('ft-elb-v-' + i, tmpPX, tmpRowY,
					[ [ 0, 0 ], [ 0, tmpDownTo ] ], pProfile, tmpSeed + 10,
					{ strokeColor: tmpPal.deemph, strokeWidth: 1.3, rough: 0.5 }));
				tmpElements.push(_line('ft-elb-h-' + i, tmpPX, tmpMidY,
					[ [ 0, 0 ], [ _iconX(tmpR.depth) - 4 - tmpPX, 0 ] ], pProfile, tmpSeed + 11,
					{ strokeColor: tmpPal.deemph, strokeWidth: 1.3, rough: 0.5 }));
			}

			// --- icon: folder/file glyphs for filesystem trees, neutral dots for
			//     concept hierarchies (so a class isn't drawn as a folder) ---
			let tmpIconY = tmpRowY + Math.round((tmpRowH - tmpIcon) / 2);
			if (!tmpIsFsTree)
			{
				tmpElements = tmpElements.concat(_nodeIcon(_iconX(tmpR.depth), tmpIconY, tmpIcon, pProfile, tmpSeed + 100, tmpR.kind === 'dir'));
			}
			else if (tmpR.kind === 'dir')
			{
				tmpElements = tmpElements.concat(_folderIcon(_iconX(tmpR.depth), tmpIconY, tmpIcon, pProfile, tmpSeed + 100));
			}
			else
			{
				tmpElements = tmpElements.concat(_fileIcon(_iconX(tmpR.depth), tmpIconY, tmpIcon, tmpR.name, pProfile, tmpSeed + 100));
			}

			// --- name ---
			let tmpNameColor = (tmpR.depth === 0) ? tmpPal.accent : tmpPal.ink;
			let tmpNameW = Math.ceil(String(tmpR.name).length * tmpNameFont * _CHAR_W) + 8;
			let tmpTextY = tmpRowY + Math.round((tmpRowH - tmpNameFont * 1.25) / 2);
			tmpElements.push(_text('ft-name-' + i, String(tmpR.name),
				_nameX(tmpR.depth), tmpTextY, tmpNameW, Math.round(tmpNameFont * 1.4),
				tmpNameFont, pProfile, tmpNameColor, tmpSeed + 1, 'left'));

			// --- comment (aligned annotation column) ---
			if (tmpR.comment)
			{
				let tmpCW = Math.ceil(String(tmpR.comment).length * tmpCommentFont * _CHAR_W) + 8;
				let tmpCY = tmpRowY + Math.round((tmpRowH - tmpCommentFont * 1.25) / 2);
				tmpElements.push(_text('ft-cmt-' + i, String(tmpR.comment),
					tmpCommentX, tmpCY, tmpCW, Math.round(tmpCommentFont * 1.4),
					tmpCommentFont, pProfile, tmpPal.deemph, tmpSeed + 2, 'left'));
			}
		}

		let tmpAppState = Object.assign({}, (pProfile && pProfile.AppState) || {});
		tmpAppState.currentItemFontFamily = libRestyle.fontFamilyIndex(pProfile);

		let tmpScene = { type: 'excalidraw', version: 2, source: 'pict-renderer-graph/filetree', elements: tmpElements, appState: tmpAppState, files: {} };
		if (typeof fCallback === 'function') { fCallback(null, tmpScene); }
		return tmpScene;
	}
};
