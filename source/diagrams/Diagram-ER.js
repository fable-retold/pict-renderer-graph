/**
 * Diagram-ER.js
 *
 * Native entity-relationship path: parse mermaid erDiagram syntax ourselves,
 * lay the entities out with dagre, render each as a hand-drawn table (header +
 * typed attribute rows with PK/FK badges in three columns), route the
 * relationships with the shared perpendicular-bezier edge router, and draw
 * crow's-foot cardinality markers at each end -- all without round-tripping
 * through mermaid-to-excalidraw.
 *
 * Mermaid-to-excalidraw can render erDiagram, but it inherits mermaid's loose
 * layout: dense / hub schemas swoop and collide labels (the FlowData case).
 * Owning the layout buys the same wins the native flowchart path did -- dagre
 * ranking, perpendicular non-crossing edges, port distribution -- plus crow's
 * foot drawn as real geometry so it follows the notebook aesthetic.
 *
 * Input graph shape:
 *   { type:'ergraph', mermaid:'<erDiagram source>', style?, direction?,
 *     spacing?{node,rank}, emphasis?, restyle? }
 */

const libParse   = require('../Pict-Renderer-Graph-Mermaid-ER-Parse.js');
const libRestyle = require('../Pict-Renderer-Graph-Restyle.js');
const libDagre   = require('@dagrejs/dagre');

// Rough character-width factor for sizing (matches the flowgraph heuristic).
const _CHAR_W = 0.6;

function _palette(pProfile)
{
	let tmpP = (pProfile && pProfile.Palette) || {};
	return {
		ink:    tmpP.ink    || '#1B1F23',
		paper:  tmpP.paper  || '#FBF7EE',
		accent: tmpP.accent || '#C9602F',
		link:   tmpP.link   || tmpP.ink || '#1B1F23',
		deemph: tmpP.deemphasis || '#8A7F72'
	};
}

// ---- entity sizing -------------------------------------------------------

// Measure an entity's table footprint + the column geometry used to place
// the rows. Entities with no attributes collapse to a simple titled box.
function _sizeEntity(pEntity, pProfile)
{
	let tmpFontSize  = (pProfile && pProfile.FontSize) || 20;
	let tmpRowFont   = Math.max(12, Math.round(tmpFontSize * 0.72));
	let tmpHeadFont  = Math.max(13, Math.round(tmpFontSize * 0.82));
	let tmpRowH      = Math.round(tmpRowFont * 2.0);
	let tmpHeaderH   = Math.round(tmpHeadFont * 2.2);

	let tmpAttrs = pEntity.attributes || [];
	let tmpHeaderW = pEntity.label.length * tmpHeadFont * _CHAR_W + 28;

	if (!tmpAttrs.length)
	{
		return {
			hasAttrs:  false,
			rowFont:   tmpRowFont, headFont: tmpHeadFont, rowH: tmpRowH, headerH: tmpHeaderH,
			width:     Math.max(140, Math.ceil(tmpHeaderW)),
			height:    Math.max(56, tmpHeaderH + 12),
			colTypeW:  0, colNameW: 0, colKeyW: 0
		};
	}

	let tmpMaxType = 0, tmpMaxName = 0, tmpHasKey = false;
	for (let i = 0; i < tmpAttrs.length; i++)
	{
		if (tmpAttrs[i].type.length > tmpMaxType) { tmpMaxType = tmpAttrs[i].type.length; }
		if (tmpAttrs[i].name.length > tmpMaxName) { tmpMaxName = tmpAttrs[i].name.length; }
		if (tmpAttrs[i].keys && tmpAttrs[i].keys.length) { tmpHasKey = true; }
	}
	let tmpColTypeW = Math.ceil(tmpMaxType * tmpRowFont * _CHAR_W + 24);
	let tmpColNameW = Math.ceil(tmpMaxName * tmpRowFont * _CHAR_W + 28);
	let tmpColKeyW  = tmpHasKey ? Math.ceil(2 * tmpRowFont * _CHAR_W + 24) : 0;

	let tmpWidth = Math.max(Math.ceil(tmpHeaderW), tmpColTypeW + tmpColNameW + tmpColKeyW);
	// If the header forced a wider box, grow the name column to absorb the slack.
	let tmpUsed = tmpColTypeW + tmpColNameW + tmpColKeyW;
	if (tmpWidth > tmpUsed) { tmpColNameW += (tmpWidth - tmpUsed); }

	return {
		hasAttrs:  true,
		rowFont:   tmpRowFont, headFont: tmpHeadFont, rowH: tmpRowH, headerH: tmpHeaderH,
		width:     tmpWidth,
		height:    tmpHeaderH + tmpAttrs.length * tmpRowH,
		colTypeW:  tmpColTypeW, colNameW: tmpColNameW, colKeyW: tmpColKeyW
	};
}

// ---- element factories ---------------------------------------------------

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
	if (tmpOpts.strokeColor) { tmpEl.strokeColor = tmpOpts.strokeColor; }
	if (tmpOpts.strokeWidth) { tmpEl.strokeWidth = tmpOpts.strokeWidth; }
	return tmpEl;
}

function _line(pId, pX, pY, pPoints, pProfile, pSeed, pOpts)
{
	let tmpOpts = pOpts || {};
	let tmpEl = _baseShape(pId, 'line', pProfile, pSeed);
	tmpEl.x = pX; tmpEl.y = pY;
	tmpEl.roundness = null;
	tmpEl.roughness = (tmpOpts.roughness !== undefined) ? tmpOpts.roughness : 0;
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

function _ellipse(pId, pCX, pCY, pR, pProfile, pSeed, pOpts)
{
	let tmpOpts = pOpts || {};
	let tmpEl = _baseShape(pId, 'ellipse', pProfile, pSeed);
	tmpEl.x = pCX - pR; tmpEl.y = pCY - pR; tmpEl.width = pR * 2; tmpEl.height = pR * 2;
	tmpEl.roughness = (tmpOpts.roughness !== undefined) ? tmpOpts.roughness : 0;
	tmpEl.strokeColor = tmpOpts.strokeColor || _palette(pProfile).ink;
	tmpEl.strokeWidth = tmpOpts.strokeWidth || ((pProfile && pProfile.StrokeWidth) || 2);
	tmpEl.backgroundColor = tmpOpts.fill || _palette(pProfile).paper;
	tmpEl.fillStyle = 'solid';
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

// ---- entity table --------------------------------------------------------

function _buildEntity(pEntity, pSizing, pProfile)
{
	let tmpPal = _palette(pProfile);
	let tmpOut = [];
	let tmpX = pEntity.x, tmpY = pEntity.y, tmpW = pEntity.width, tmpH = pEntity.height;
	let tmpSeed = libRestyle.seedFor(pProfile, 'er:' + pEntity.id);

	// Container.
	tmpOut.push(_rect('er-box-' + pEntity.id, tmpX, tmpY, tmpW, tmpH, pProfile, tmpSeed, { roundness: { type: 3 } }));

	if (!pSizing.hasAttrs)
	{
		// Simple titled box -- center the label.
		tmpOut.push(_text('er-title-' + pEntity.id, pEntity.label,
			tmpX, tmpY + (tmpH - pSizing.headFont) / 2, tmpW, pSizing.headFont * 1.4,
			pSizing.headFont, pProfile, tmpPal.ink, tmpSeed + 1, 'center'));
		return tmpOut;
	}

	// Header label (centered across the top strip).
	tmpOut.push(_text('er-title-' + pEntity.id, pEntity.label,
		tmpX, tmpY + (pSizing.headerH - pSizing.headFont) / 2, tmpW, pSizing.headFont * 1.4,
		pSizing.headFont, pProfile, tmpPal.ink, tmpSeed + 1, 'center'));

	// Header separator.
	tmpOut.push(_line('er-hsep-' + pEntity.id, tmpX, tmpY + pSizing.headerH,
		[ [ 0, 0 ], [ tmpW, 0 ] ], pProfile, tmpSeed + 2, { strokeColor: tmpPal.deemph, strokeWidth: 1.5 }));

	// Column separators (type | name | key).
	let tmpSepX1 = tmpX + pSizing.colTypeW;
	let tmpSepX2 = tmpSepX1 + pSizing.colNameW;
	tmpOut.push(_line('er-csep1-' + pEntity.id, tmpSepX1, tmpY + pSizing.headerH,
		[ [ 0, 0 ], [ 0, tmpH - pSizing.headerH ] ], pProfile, tmpSeed + 3, { strokeColor: tmpPal.deemph, strokeWidth: 1 }));
	if (pSizing.colKeyW > 0)
	{
		tmpOut.push(_line('er-csep2-' + pEntity.id, tmpSepX2, tmpY + pSizing.headerH,
			[ [ 0, 0 ], [ 0, tmpH - pSizing.headerH ] ], pProfile, tmpSeed + 4, { strokeColor: tmpPal.deemph, strokeWidth: 1 }));
	}

	// Rows.
	let tmpAttrs = pEntity.attributes;
	for (let i = 0; i < tmpAttrs.length; i++)
	{
		let tmpAttr = tmpAttrs[i];
		let tmpRowY = tmpY + pSizing.headerH + i * pSizing.rowH;
		let tmpTextY = tmpRowY + (pSizing.rowH - pSizing.rowFont) / 2;
		tmpOut.push(_text('er-t-' + pEntity.id + '-' + i, tmpAttr.type,
			tmpX + 12, tmpTextY, pSizing.colTypeW - 16, pSizing.rowFont * 1.4, pSizing.rowFont, pProfile, tmpPal.deemph, tmpSeed + 10 + i * 3, 'left'));
		tmpOut.push(_text('er-n-' + pEntity.id + '-' + i, tmpAttr.name,
			tmpSepX1 + 12, tmpTextY, pSizing.colNameW - 16, pSizing.rowFont * 1.4, pSizing.rowFont, pProfile, tmpPal.ink, tmpSeed + 11 + i * 3, 'left'));
		if (pSizing.colKeyW > 0 && tmpAttr.keys && tmpAttr.keys.length)
		{
			tmpOut.push(_text('er-k-' + pEntity.id + '-' + i, tmpAttr.keys.join(','),
				tmpSepX2 + 10, tmpTextY, pSizing.colKeyW - 14, pSizing.rowFont * 1.4, pSizing.rowFont, pProfile, tmpPal.accent, tmpSeed + 12 + i * 3, 'left'));
		}
	}
	return tmpOut;
}

// ---- crow's-foot markers -------------------------------------------------

// Decode a 2-char cardinality token into { many, optional, bars }.
//   many   : a crow's foot ({ or })   -> "many"
//   optional: a circle (o)            -> "zero"
//   bars   : count of | (1 = exactly/at-least one, 2 = exactly one)
function _decodeCardinality(pToken)
{
	let tmpT = String(pToken || '');
	return {
		many:     /[{}]/.test(tmpT),
		optional: /o/i.test(tmpT),
		bars:     (tmpT.match(/\|/g) || []).length
	};
}

// Build the marker geometry at an anchor point on an entity edge. pDir is the
// outward unit vector (along the connector, away from the entity). Order from
// the entity edge outward: crow's foot (touching the entity) -> bar(s) -> circle.
function _crowMarkers(pAnchor, pDir, pToken, pProfile, pIdPrefix)
{
	let tmpCard = _decodeCardinality(pToken);
	let tmpPal = _palette(pProfile);
	let tmpSeed = libRestyle.seedFor(pProfile, 'ercrow:' + pIdPrefix);
	let tmpPerp = { x: -pDir.y, y: pDir.x };
	let tmpOut = [];
	let tmpN = 0;

	let tmpAt = (pDist) => ({ x: pAnchor.x + pDir.x * pDist, y: pAnchor.y + pDir.y * pDist });
	let tmpStroke = { strokeColor: tmpPal.ink, strokeWidth: 1.6, roughness: 0 };

	let tmpCursor = 0;

	// Crow's foot: three prongs converging at FORK_LEN out, splayed to the edge.
	if (tmpCard.many)
	{
		let tmpForkLen = 14, tmpForkHalf = 8;
		let tmpApex = tmpAt(tmpForkLen);
		let tmpTips =
		[
			{ x: pAnchor.x + tmpPerp.x * tmpForkHalf, y: pAnchor.y + tmpPerp.y * tmpForkHalf },
			{ x: pAnchor.x,                            y: pAnchor.y },
			{ x: pAnchor.x - tmpPerp.x * tmpForkHalf, y: pAnchor.y - tmpPerp.y * tmpForkHalf }
		];
		for (let i = 0; i < tmpTips.length; i++)
		{
			tmpOut.push(_line(pIdPrefix + '-fork' + i, tmpApex.x, tmpApex.y,
				[ [ 0, 0 ], [ tmpTips[i].x - tmpApex.x, tmpTips[i].y - tmpApex.y ] ], pProfile, tmpSeed + (tmpN++), tmpStroke));
		}
		tmpCursor = tmpForkLen;
	}
	else
	{
		tmpCursor = 4;
	}

	// Bar(s): perpendicular ticks across the connector.
	let tmpBarHalf = 7;
	for (let b = 0; b < tmpCard.bars; b++)
	{
		tmpCursor += 5;
		let tmpC = tmpAt(tmpCursor);
		tmpOut.push(_line(pIdPrefix + '-bar' + b,
			tmpC.x + tmpPerp.x * tmpBarHalf, tmpC.y + tmpPerp.y * tmpBarHalf,
			[ [ 0, 0 ], [ -tmpPerp.x * tmpBarHalf * 2, -tmpPerp.y * tmpBarHalf * 2 ] ],
			pProfile, tmpSeed + (tmpN++), tmpStroke));
	}

	// Circle (optional / "zero"): furthest out.
	if (tmpCard.optional)
	{
		tmpCursor += 9;
		let tmpC = tmpAt(tmpCursor);
		tmpOut.push(_ellipse(pIdPrefix + '-zero', tmpC.x, tmpC.y, 4.5, pProfile, tmpSeed + (tmpN++),
			{ strokeColor: tmpPal.ink, strokeWidth: 1.6, fill: tmpPal.paper }));
	}

	return tmpOut;
}

// ---- layout --------------------------------------------------------------

function _dagreLayout(pEntities, pRelationships, pDirection, pProfile, pSpacing)
{
	let tmpRankDir = (pDirection === 'LR' || pDirection === 'RL' || pDirection === 'BT') ? pDirection : 'TB';
	// Entities are large; give them room so relationship labels land in open
	// space between tables rather than on top of them.
	let tmpNodeSep = (pSpacing && pSpacing.node) || 80;
	let tmpRankSep = (pSpacing && pSpacing.rank) || 120;

	let tmpGraph = new libDagre.graphlib.Graph({ multigraph: true });
	tmpGraph.setGraph({ rankdir: tmpRankDir, nodesep: tmpNodeSep, ranksep: tmpRankSep, marginx: 20, marginy: 20 });
	tmpGraph.setDefaultEdgeLabel(() => ({}));

	let tmpById = {};
	for (let i = 0; i < pEntities.length; i++)
	{
		tmpById[pEntities[i].id] = pEntities[i];
		tmpGraph.setNode(pEntities[i].id, { width: pEntities[i].width, height: pEntities[i].height });
	}
	for (let i = 0; i < pRelationships.length; i++)
	{
		if (tmpById[pRelationships[i].from] && tmpById[pRelationships[i].to])
		{
			tmpGraph.setEdge(pRelationships[i].from, pRelationships[i].to, {}, 'r' + i);
		}
	}

	libDagre.layout(tmpGraph);

	for (let i = 0; i < pEntities.length; i++)
	{
		let tmpGN = tmpGraph.node(pEntities[i].id);
		if (!tmpGN) { continue; }
		pEntities[i].x = Math.round(tmpGN.x - tmpGN.width / 2);
		pEntities[i].y = Math.round(tmpGN.y - tmpGN.height / 2);
	}
}

// ---- handler -------------------------------------------------------------

module.exports =
{
	name:        'ergraph',
	description: 'Native entity-relationship diagram -- parse mermaid erDiagram, lay out with dagre, render hand-drawn entity tables + crow\'s-foot relationships (no mermaid-to-excalidraw).',
	async:       false,

	toScene: function (pGraph, pProfile, pVendor, fCallback)
	{
		let tmpSource = pGraph.mermaid || pGraph.source || '';
		let tmpParsed = libParse.parseMermaidER(tmpSource);
		let tmpPal = _palette(pProfile);

		// 1. Size every entity (stamps width/height for dagre).
		let tmpSizing = {};
		for (let i = 0; i < tmpParsed.entities.length; i++)
		{
			let tmpE = tmpParsed.entities[i];
			let tmpS = _sizeEntity(tmpE, pProfile);
			tmpSizing[tmpE.id] = tmpS;
			tmpE.width = tmpS.width;
			tmpE.height = tmpS.height;
		}

		// 2. Lay the entities out.
		_dagreLayout(tmpParsed.entities, tmpParsed.relationships, pGraph.direction, pProfile, pGraph.spacing);

		// 3. Build the entity tables.
		let tmpElements = [];
		for (let i = 0; i < tmpParsed.entities.length; i++)
		{
			let tmpE = tmpParsed.entities[i];
			tmpElements = tmpElements.concat(_buildEntity(tmpE, tmpSizing[tmpE.id], pProfile));
		}

		// 4. Emit relationship connectors BOUND to the entity boxes (no arrowheads
		//    -- crow's foot replaces them), then route them with the shared
		//    perpendicular-bezier router so dense schemas don't swoop or cross.
		let tmpRelMeta = [];
		for (let i = 0; i < tmpParsed.relationships.length; i++)
		{
			let tmpR = tmpParsed.relationships[i];
			let tmpFromBox = 'er-box-' + tmpR.from;
			let tmpToBox   = 'er-box-' + tmpR.to;
			let tmpArrowId = 'er-rel-' + i;
			let tmpSeed = libRestyle.seedFor(pProfile, 'eredge:' + i);
			tmpElements.push({
				id: tmpArrowId, type: 'arrow', x: 0, y: 0, width: 1, height: 1, angle: 0,
				strokeColor: tmpPal.link, backgroundColor: 'transparent', fillStyle: 'solid',
				strokeWidth: (pProfile && pProfile.StrokeWidth) || 2,
				strokeStyle: tmpR.identifying ? 'solid' : 'dashed',
				roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: { type: 2 },
				seed: tmpSeed, version: 1, versionNonce: tmpSeed, isDeleted: false, boundElements: [],
				updated: 1, link: null, locked: false,
				points: [ [ 0, 0 ], [ 1, 1 ] ], lastCommittedPoint: null,
				startBinding: { elementId: tmpFromBox, focus: 0, gap: 4 },
				endBinding:   { elementId: tmpToBox,   focus: 0, gap: 4 },
				startArrowhead: null, endArrowhead: null, elbowed: false, index: null
			});
			tmpRelMeta.push({ id: tmpArrowId, rel: tmpR });
		}

		// Route (perpendicular departure/approach + port distribution).
		if (pGraph.restyle !== false)
		{
			libRestyle.rerouteArrows(tmpElements, pProfile);
		}

		// 5. Crow's-foot markers + relationship labels, read off the routed paths.
		let tmpById = {};
		for (let i = 0; i < tmpElements.length; i++) { if (tmpElements[i].id) { tmpById[tmpElements[i].id] = tmpElements[i]; } }

		let tmpLabelRecords = [];
		for (let i = 0; i < tmpRelMeta.length; i++)
		{
			let tmpArrow = tmpById[tmpRelMeta[i].id];
			let tmpR = tmpRelMeta[i].rel;
			if (!tmpArrow || !Array.isArray(tmpArrow.points) || tmpArrow.points.length < 2) { continue; }
			let tmpPts = tmpArrow.points;
			let tmpN = tmpPts.length;
			// Absolute endpoints + outward directions.
			let tmpStart = { x: tmpArrow.x + tmpPts[0][0],      y: tmpArrow.y + tmpPts[0][1] };
			let tmpNext  = { x: tmpArrow.x + tmpPts[1][0],      y: tmpArrow.y + tmpPts[1][1] };
			let tmpEnd   = { x: tmpArrow.x + tmpPts[tmpN-1][0], y: tmpArrow.y + tmpPts[tmpN-1][1] };
			let tmpPrev  = { x: tmpArrow.x + tmpPts[tmpN-2][0], y: tmpArrow.y + tmpPts[tmpN-2][1] };
			let tmpDirStart = _unit(tmpNext.x - tmpStart.x, tmpNext.y - tmpStart.y);
			let tmpDirEnd   = _unit(tmpPrev.x - tmpEnd.x,   tmpPrev.y - tmpEnd.y);

			tmpElements = tmpElements.concat(_crowMarkers(tmpStart, tmpDirStart, tmpR.fromCard, pProfile, 'erc-' + i + '-a'));
			tmpElements = tmpElements.concat(_crowMarkers(tmpEnd,   tmpDirEnd,   tmpR.toCard,   pProfile, 'erc-' + i + '-b'));

			if (tmpR.label)
			{
				let tmpMid = _clearestPoint(tmpArrow, tmpParsed.entities);
				let tmpLF = Math.max(11, Math.round(((pProfile && pProfile.FontSize) || 20) * 0.62));
				let tmpLW = tmpR.label.length * tmpLF * _CHAR_W + 14;
				let tmpLH = Math.round(tmpLF * 1.4);
				let tmpLSeed = libRestyle.seedFor(pProfile, 'erlabel:' + i);
				// Paper chip behind the label so it stays legible where it crosses
				// connector lines (drawn before the text so it sits underneath).
				let tmpChip = _rect('er-rlabelbg-' + i, tmpMid.x - tmpLW / 2, tmpMid.y - tmpLH / 2, tmpLW, tmpLH,
					pProfile, tmpLSeed, { roundness: { type: 3 }, strokeColor: tmpPal.paper, strokeWidth: 1 });
				tmpChip.backgroundColor = tmpPal.paper;
				tmpChip.fillStyle = 'solid';
				tmpChip.roughness = 0;
				let tmpTextEl = _text('er-rlabel-' + i, tmpR.label,
					tmpMid.x - tmpLW / 2, tmpMid.y - tmpLF * 0.7, tmpLW, tmpLH,
					tmpLF, pProfile, tmpPal.deemph, tmpLSeed + 1, 'center');
				tmpElements.push(tmpChip);
				tmpElements.push(tmpTextEl);
				tmpLabelRecords.push({ chip: tmpChip, text: tmpTextEl, cx: tmpMid.x, cy: tmpMid.y, w: tmpLW, h: tmpLH, textOffY: tmpLF * 0.7 });
			}
		}

		// Nudge overlapping relationship labels apart so dense schemas don't
		// stack labels on top of each other (the FlowData hub / source+target port).
		_deconflictLabels(tmpLabelRecords);

		if (pGraph.restyle !== false && Array.isArray(pGraph.emphasis) && pGraph.emphasis.length)
		{
			libRestyle.applyEmphasis(tmpElements, pGraph.emphasis, tmpSource, pProfile);
		}

		let tmpAppState = Object.assign({}, (pProfile && pProfile.AppState) || {});
		tmpAppState.currentItemFontFamily = libRestyle.fontFamilyIndex(pProfile);

		let tmpScene = { type: 'excalidraw', version: 2, source: 'pict-renderer-graph/er', elements: tmpElements, appState: tmpAppState, files: {} };
		if (typeof fCallback === 'function') { fCallback(null, tmpScene); }
		return tmpScene;
	}
};

function _unit(pX, pY)
{
	let tmpLen = Math.sqrt(pX * pX + pY * pY);
	if (tmpLen < 0.0001) { return { x: 1, y: 0 }; }
	return { x: pX / tmpLen, y: pY / tmpLen };
}

// Distance from a point to a rectangle (0 if inside).
function _distPointRect(pPt, pRect)
{
	let tmpDX = Math.max(pRect.x - pPt.x, 0, pPt.x - (pRect.x + pRect.width));
	let tmpDY = Math.max(pRect.y - pPt.y, 0, pPt.y - (pRect.y + pRect.height));
	return Math.sqrt(tmpDX * tmpDX + tmpDY * tmpDY);
}

// Nudge a set of label rects apart until they no longer overlap, then write the
// settled centre back onto each label's chip + text element. A light iterative
// separation along the axis of least overlap -- enough to unstack the few
// labels that crowd a hub without flinging them across the diagram.
function _deconflictLabels(pLabels)
{
	let tmpPad = 4;
	for (let tmpIter = 0; tmpIter < 30; tmpIter++)
	{
		let tmpMoved = false;
		for (let i = 0; i < pLabels.length; i++)
		{
			for (let j = i + 1; j < pLabels.length; j++)
			{
				let tmpA = pLabels[i], tmpB = pLabels[j];
				let tmpOverlapX = (tmpA.w + tmpB.w) / 2 + tmpPad - Math.abs(tmpA.cx - tmpB.cx);
				let tmpOverlapY = (tmpA.h + tmpB.h) / 2 + tmpPad - Math.abs(tmpA.cy - tmpB.cy);
				if (tmpOverlapX > 0 && tmpOverlapY > 0)
				{
					// Push along whichever axis needs the smaller move.
					if (tmpOverlapY <= tmpOverlapX)
					{
						let tmpPush = tmpOverlapY / 2;
						let tmpDir = (tmpA.cy <= tmpB.cy) ? 1 : -1;
						tmpA.cy -= tmpDir * tmpPush; tmpB.cy += tmpDir * tmpPush;
					}
					else
					{
						let tmpPush = tmpOverlapX / 2;
						let tmpDir = (tmpA.cx <= tmpB.cx) ? 1 : -1;
						tmpA.cx -= tmpDir * tmpPush; tmpB.cx += tmpDir * tmpPush;
					}
					tmpMoved = true;
				}
			}
		}
		if (!tmpMoved) { break; }
	}
	for (let i = 0; i < pLabels.length; i++)
	{
		let tmpL = pLabels[i];
		tmpL.chip.x = tmpL.cx - tmpL.w / 2; tmpL.chip.y = tmpL.cy - tmpL.h / 2;
		tmpL.text.x = tmpL.cx - tmpL.w / 2; tmpL.text.y = tmpL.cy - tmpL.textOffY;
	}
}

// Pick the absolute point along the connector's mid-section (25%..75%) with the
// greatest clearance from every entity box, so a relationship label lands in
// open space rather than on a table it merely routes past.
function _clearestPoint(pArrow, pBoxes)
{
	let tmpPts = pArrow.points;
	let tmpLo = Math.max(1, Math.floor(tmpPts.length * 0.25));
	let tmpHi = Math.min(tmpPts.length - 2, Math.ceil(tmpPts.length * 0.75));
	if (tmpHi < tmpLo) { tmpLo = tmpHi = Math.floor(tmpPts.length / 2); }
	let tmpBest = null, tmpBestClear = -1;
	for (let i = tmpLo; i <= tmpHi; i++)
	{
		let tmpP = { x: pArrow.x + tmpPts[i][0], y: pArrow.y + tmpPts[i][1] };
		let tmpClear = Infinity;
		for (let b = 0; b < pBoxes.length; b++) { tmpClear = Math.min(tmpClear, _distPointRect(tmpP, pBoxes[b])); }
		if (tmpClear > tmpBestClear) { tmpBestClear = tmpClear; tmpBest = tmpP; }
	}
	return tmpBest || { x: pArrow.x + tmpPts[Math.floor(tmpPts.length / 2)][0], y: pArrow.y + tmpPts[Math.floor(tmpPts.length / 2)][1] };
}

// Exposed for unit testing the cardinality decode (the genuinely new logic).
module.exports.decodeCardinality = _decodeCardinality;
