/**
 * Diagram-Sequence.js
 *
 * Actor lanes at the top, vertical dashed lifelines drop down from each
 * actor, horizontal arrows are the messages between actors ordered
 * top-to-bottom.  Reads like a UML sequence diagram drawn by hand.
 *
 * Input shape:
 *
 *   {
 *     type: 'sequence',
 *     title?,
 *     style?,
 *     actors: [
 *       { id, label, accent? }
 *     ],
 *     messages: [
 *       { from, to, label?, kind?: 'sync'|'async'|'return'|'note' }
 *     ]
 *   }
 *
 * Layout:
 *   - Each actor gets a column at x = lane*laneWidth + padding
 *   - Actor label sits at the top of its lane as a rectangle
 *   - A dashed line (Excalidraw `line` element) drops from the bottom of
 *     each actor box to the diagram floor — the lifeline
 *   - Messages are arrows from one lifeline to another, placed at
 *     y = headerHeight + row*rowHeight
 *   - Message labels float just above the arrow
 *   - 'sync' = solid arrow with filled head
 *   - 'async' = solid arrow with open head (no fill)
 *   - 'return' = dashed arrow
 *   - 'note' = a small note rectangle near the originating actor
 *
 * Unlike flow/star/mindmap, sequence builds Excalidraw elements directly
 * because its primitives (lifelines = unbound line elements, horizontal
 * arrows between lifeline positions) don't fit the
 * Generate-Notebook-Diagram.js node/edge model.  But we still call into
 * the helpers in Generate-Notebook-Diagram.js for style application and
 * deterministic seeding.
 */

const LANE_WIDTH    = 200;
const HEADER_TOP    = 80;     // title space
const HEADER_HEIGHT = 80;
const ROW_HEIGHT    = 64;
const FOOTER_PAD    = 40;
const ACTOR_W       = 160;
const ACTOR_H       = 60;

const _FontFamilyMap = {
	'Excalifont': 5, 'Virgil': 1, 'Helvetica': 2, 'Cascadia': 3,
	'Lilita One': 7, 'Comic Shanns': 8, 'Liberation Sans': 6, 'Nunito': 4
};

module.exports =
{
	name:        'sequence',
	description: 'UML-style sequence diagram — actor lanes, vertical lifelines, horizontal labeled messages ordered top-to-bottom.',
	async:       false,

	toScene: function (pGraph, pProfile, pVendor, fCallback)
	{
		let tmpActors   = (pGraph.actors || []).map((a) => Object.assign({}, a));
		let tmpMessages = (pGraph.messages || []).map((m) => Object.assign({}, m));

		if (tmpActors.length < 1)
		{
			let tmpEmpty = { type: 'excalidraw', version: 2, source: 'pict-renderer-graph/sequence',
				elements: [], appState: Object.assign({}, (pProfile && pProfile.AppState) || {}), files: {} };
			if (typeof fCallback === 'function') fCallback(null, tmpEmpty);
			return tmpEmpty;
		}

		let tmpProfile = pProfile || {};
		let tmpStroke  = (tmpProfile.Palette && tmpProfile.Palette.ink)        || '#1B1F23';
		let tmpAccent  = (tmpProfile.Palette && tmpProfile.Palette.accent)     || '#C9602F';
		let tmpHighlight = (tmpProfile.Palette && tmpProfile.Palette.highlight) || '#E8C547';
		let tmpDeem    = (tmpProfile.Palette && tmpProfile.Palette.deemphasis) || '#8A7F72';
		let tmpLink    = (tmpProfile.Palette && tmpProfile.Palette.link)       || '#2E7D74';
		let tmpRough   = (tmpProfile.Roughness !== undefined) ? tmpProfile.Roughness : 1;
		let tmpStrokeW = tmpProfile.StrokeWidth || 2;
		let tmpFillStyle = tmpProfile.FillStyle || 'hachure';
		let tmpFontIdx = _FontFamilyMap[tmpProfile.FontFamily || 'Excalifont'] || 5;
		let tmpFontSz  = tmpProfile.FontSize || 18;

		// Map actor id → lane index → x position of the lane center.
		let tmpLaneX = {};
		for (let i = 0; i < tmpActors.length; i++)
		{
			tmpLaneX[tmpActors[i].id] = FOOTER_PAD + i * LANE_WIDTH + LANE_WIDTH / 2;
		}

		let tmpLifelineBottom = HEADER_TOP + HEADER_HEIGHT + tmpMessages.length * ROW_HEIGHT + FOOTER_PAD;

		let tmpElements = [];
		let tmpSeed = 1000;

		// 1. Title (if provided)
		if (pGraph.title)
		{
			tmpElements.push(_textElement(
				pGraph.title, FOOTER_PAD, 8, 320, 36,
				Math.round(tmpFontSz * 1.5), tmpFontIdx, tmpStroke, tmpSeed++
			));
		}

		// 2. Actor headers + lifelines
		for (let i = 0; i < tmpActors.length; i++)
		{
			let tmpActor = tmpActors[i];
			let tmpLaneCenter = tmpLaneX[tmpActor.id];
			let tmpActorX = tmpLaneCenter - ACTOR_W / 2;
			let tmpActorY = HEADER_TOP;

			let tmpActorStrokeColor = tmpActor.accent === 'accent' ? tmpAccent
				: tmpActor.accent === 'link'      ? tmpLink
				: tmpActor.accent === 'highlight' ? tmpHighlight
				: tmpActor.accent === 'deemphasis' ? tmpDeem
				: tmpStroke;

			// Actor box (rectangle)
			let tmpActorId = 'sequence-actor-' + tmpActor.id + '-' + tmpSeed;
			tmpElements.push({
				id:            tmpActorId,
				type:          'rectangle',
				x:             tmpActorX,  y: tmpActorY,
				width:         ACTOR_W,    height: ACTOR_H,
				angle:         0,
				strokeColor:   tmpActorStrokeColor,
				backgroundColor: 'transparent',
				fillStyle:     tmpFillStyle,
				strokeWidth:   tmpStrokeW,
				strokeStyle:   'solid',
				roughness:     tmpRough,
				opacity:       100,
				groupIds:      [],
				frameId:       null,
				roundness:     { type: 3 },
				seed:          tmpSeed++,
				version:       1, versionNonce: tmpSeed,
				isDeleted:     false, boundElements: [],
				updated:       1, link: null, locked: false,
				index:         null
			});

			// Actor label (bound text)
			let tmpLabelId = 'sequence-actor-label-' + tmpActor.id + '-' + tmpSeed;
			tmpElements.push(_textElement(
				tmpActor.label || tmpActor.id,
				tmpActorX + 8, tmpActorY + 18, ACTOR_W - 16, ACTOR_H - 36,
				tmpFontSz, tmpFontIdx, tmpActorStrokeColor, tmpSeed++,
				{ containerId: tmpActorId, textAlign: 'center', verticalAlign: 'middle' }
			));
			// Wire the container binding
			tmpElements[tmpElements.length - 2].boundElements.push({ id: tmpLabelId, type: 'text' });
			tmpElements[tmpElements.length - 1].id = tmpLabelId;

			// Lifeline — vertical dashed line from below the box to the floor
			tmpElements.push({
				id:            'sequence-lifeline-' + tmpActor.id + '-' + tmpSeed,
				type:          'line',
				x:             tmpLaneCenter, y: tmpActorY + ACTOR_H,
				width:         0,
				height:        tmpLifelineBottom - (tmpActorY + ACTOR_H),
				angle:         0,
				strokeColor:   tmpDeem,
				backgroundColor: 'transparent',
				fillStyle:     'solid',
				strokeWidth:   tmpStrokeW * 0.8,
				strokeStyle:   'dashed',
				roughness:     tmpRough,
				opacity:       100,
				groupIds:      [],
				frameId:       null,
				roundness:     null,
				seed:          tmpSeed++, version: 1, versionNonce: tmpSeed,
				isDeleted:     false, boundElements: null,
				updated:       1, link: null, locked: false,
				points:        [ [ 0, 0 ], [ 0, tmpLifelineBottom - (tmpActorY + ACTOR_H) ] ],
				lastCommittedPoint: null,
				startBinding:  null, endBinding: null,
				startArrowhead: null, endArrowhead: null,
				elbowed:       false,
				index:         null
			});
		}

		// 3. Messages — one arrow per row
		for (let r = 0; r < tmpMessages.length; r++)
		{
			let tmpMsg = tmpMessages[r];
			let tmpFromX = tmpLaneX[tmpMsg.from];
			let tmpToX   = tmpLaneX[tmpMsg.to];
			if (tmpFromX === undefined || tmpToX === undefined) continue;

			let tmpY = HEADER_TOP + HEADER_HEIGHT + r * ROW_HEIGHT + ROW_HEIGHT / 2;
			let tmpKind = (tmpMsg.kind || 'sync').toLowerCase();

			// 'note' is special — a tiny note rectangle near the from-actor.
			if (tmpKind === 'note')
			{
				let tmpNoteW = 180, tmpNoteH = 44;
				let tmpNoteId = 'sequence-note-' + r + '-' + tmpSeed;
				tmpElements.push({
					id:            tmpNoteId,
					type:          'rectangle',
					x:             tmpFromX - tmpNoteW / 2, y: tmpY - tmpNoteH / 2,
					width:         tmpNoteW, height: tmpNoteH,
					angle:         0,
					strokeColor:   tmpStroke,
					backgroundColor: tmpHighlight,
					fillStyle:     tmpFillStyle,
					strokeWidth:   tmpStrokeW * 0.8,
					strokeStyle:   'solid',
					roughness:     tmpRough,
					opacity:       100,
					groupIds:      [],
					frameId:       null,
					roundness:     { type: 3 },
					seed:          tmpSeed++, version: 1, versionNonce: tmpSeed,
					isDeleted:     false, boundElements: [],
					updated:       1, link: null, locked: false,
					index:         null
				});
				if (tmpMsg.label)
				{
					let tmpNoteLabelId = 'sequence-note-label-' + r + '-' + tmpSeed;
					tmpElements.push(_textElement(
						tmpMsg.label,
						tmpFromX - tmpNoteW / 2 + 8, tmpY - 10, tmpNoteW - 16, 20,
						Math.max(12, tmpFontSz - 4), tmpFontIdx, tmpStroke, tmpSeed++,
						{ containerId: tmpNoteId, textAlign: 'center', verticalAlign: 'middle' }
					));
					tmpElements[tmpElements.length - 2].boundElements.push({ id: tmpNoteLabelId, type: 'text' });
					tmpElements[tmpElements.length - 1].id = tmpNoteLabelId;
				}
				continue;
			}

			let tmpStrokeStyle = (tmpKind === 'return') ? 'dashed' : 'solid';
			let tmpColor       = (tmpKind === 'async')  ? tmpLink  : tmpStroke;

			// Arrow from lifeline → lifeline
			let tmpAnchor = tmpFromX < tmpToX ? 1 : -1;
			let tmpStartX = tmpFromX + tmpAnchor * 4;
			let tmpEndX   = tmpToX   - tmpAnchor * 4;

			tmpElements.push({
				id:            'sequence-msg-' + r + '-' + tmpSeed,
				type:          'arrow',
				x:             tmpStartX, y: tmpY,
				width:         tmpEndX - tmpStartX, height: 0,
				angle:         0,
				strokeColor:   tmpColor,
				backgroundColor: 'transparent',
				fillStyle:     'solid',
				strokeWidth:   tmpStrokeW,
				strokeStyle:   tmpStrokeStyle,
				roughness:     tmpRough,
				opacity:       100,
				groupIds:      [],
				frameId:       null,
				roundness:     { type: 2 },
				seed:          tmpSeed++, version: 1, versionNonce: tmpSeed,
				isDeleted:     false, boundElements: [],
				updated:       1, link: null, locked: false,
				points:        [ [ 0, 0 ], [ tmpEndX - tmpStartX, 0 ] ],
				lastCommittedPoint: null,
				startBinding:  null, endBinding: null,
				startArrowhead: null,
				endArrowhead:  (tmpKind === 'async') ? 'triangle_outline' : 'arrow',
				elbowed:       false,
				index:         null
			});

			// Message label (sits above the arrow, centered)
			if (tmpMsg.label)
			{
				tmpElements.push(_textElement(
					tmpMsg.label,
					(tmpStartX + tmpEndX) / 2 - 80, tmpY - 24,
					Math.max(80, tmpMsg.label.length * 8 + 16), 18,
					Math.max(12, tmpFontSz - 4), tmpFontIdx, tmpColor, tmpSeed++,
					{ textAlign: 'center' }
				));
			}
		}

		let tmpAppState = Object.assign({}, (pProfile && pProfile.AppState) || {});
		tmpAppState.currentItemFontFamily = tmpFontIdx;

		let tmpScene = {
			type:     'excalidraw',
			version:  2,
			source:   'pict-renderer-graph/sequence',
			elements: tmpElements,
			appState: tmpAppState,
			files:    {}
		};
		if (typeof fCallback === 'function') fCallback(null, tmpScene);
		return tmpScene;
	}
};

// ----- helpers -----------------------------------------------------------

function _textElement(pText, pX, pY, pW, pH, pFontSize, pFontFamilyIdx, pColor, pSeed, pExtras)
{
	let tmpEx = pExtras || {};
	return {
		id:            null,        // caller sets
		type:          'text',
		x:             pX, y: pY,
		width:         pW, height: pH,
		angle:         0,
		strokeColor:   pColor,
		backgroundColor: 'transparent',
		fillStyle:     'solid',
		strokeWidth:   1,
		strokeStyle:   'solid',
		roughness:     1,
		opacity:       100,
		groupIds:      [],
		frameId:       null,
		roundness:     null,
		seed:          pSeed, version: 1, versionNonce: pSeed,
		isDeleted:     false, boundElements: null,
		updated:       1, link: null, locked: false,
		text:          pText,
		fontSize:      pFontSize,
		fontFamily:    pFontFamilyIdx,
		textAlign:     tmpEx.textAlign || 'left',
		verticalAlign: tmpEx.verticalAlign || 'top',
		baseline:      Math.round(pFontSize * 0.75),
		containerId:   tmpEx.containerId || null,
		originalText:  pText,
		autoResize:    !tmpEx.containerId,
		lineHeight:    1.25,
		index:         null
	};
}
