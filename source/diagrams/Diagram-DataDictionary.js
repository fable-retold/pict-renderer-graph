/**
 * Diagram-DataDictionary.js
 *
 * Entity-relationship-style diagram.  Each "entity" is a tall rectangle
 * with a header (entity name) + a multi-line text block (fields).  FK
 * arrows link entities.
 *
 * Input shape:
 *
 *   {
 *     type: 'datadict',
 *     title?,
 *     style?,
 *     entities: [
 *       {
 *         id,
 *         label,           // table / entity name (rendered as header)
 *         fields: [        // each field appears on its own line
 *           { name, type?, pk?, fk?, nullable?, note? }
 *         ],
 *         accent?
 *       }
 *     ],
 *     relations: [        // FK-style links
 *       { from: 'entityId.fieldName', to: 'entityId.fieldName', label?, kind?: 'one-to-many'|'one-to-one'|'many-to-many' }
 *     ]
 *   }
 *
 * Or backward-compatible: callers may use `nodes` + `edges` (entities-as-
 * nodes with a `fields` array) and this handler will translate.
 *
 * Layout: grid (default).  Entities laid out left-to-right, wrapping
 * after every N columns.  No automatic topo-sort of relations — too
 * many FK graphs have cycles to make that useful.
 *
 * Implementation: directly emits Excalidraw elements (header rectangle +
 * fields-text-block bound to it + arrows for relations).  Doesn't go
 * through Generate-Notebook-Diagram because the multi-line field layout
 * doesn't fit the one-label-per-node assumption.
 */

const COLUMN_GAP = 80;
const ROW_GAP    = 80;
const HEADER_H   = 36;
const FIELD_H    = 22;
const COLUMNS    = 3;
const PAD_X      = 40;
const PAD_Y      = 80;     // title space
const ENTITY_W   = 240;

const _FontFamilyMap = {
	'Excalifont': 5, 'Virgil': 1, 'Helvetica': 2, 'Cascadia': 3,
	'Lilita One': 7, 'Comic Shanns': 8, 'Liberation Sans': 6, 'Nunito': 4
};

module.exports =
{
	name:        'datadict',
	description: 'Data dictionary / ER diagram — entity tables with typed field rows + FK relations.',
	async:       false,

	toScene: function (pGraph, pProfile, pVendor, fCallback)
	{
		let tmpEntities = (pGraph.entities || pGraph.nodes || []).map((e) => Object.assign({}, e));
		let tmpRelations = (pGraph.relations || pGraph.edges || []).map((r) => Object.assign({}, r));

		if (tmpEntities.length < 1)
		{
			let tmpEmpty = { type: 'excalidraw', version: 2, source: 'pict-renderer-graph/datadict',
				elements: [], appState: Object.assign({}, (pProfile && pProfile.AppState) || {}), files: {} };
			if (typeof fCallback === 'function') fCallback(null, tmpEmpty);
			return tmpEmpty;
		}

		let tmpProfile = pProfile || {};
		let tmpStroke  = (tmpProfile.Palette && tmpProfile.Palette.ink)        || '#1B1F23';
		let tmpAccent  = (tmpProfile.Palette && tmpProfile.Palette.accent)     || '#C9602F';
		let tmpDeem    = (tmpProfile.Palette && tmpProfile.Palette.deemphasis) || '#8A7F72';
		let tmpLink    = (tmpProfile.Palette && tmpProfile.Palette.link)       || '#2E7D74';
		let tmpHighlight = (tmpProfile.Palette && tmpProfile.Palette.highlight) || '#E8C547';
		let tmpPaper   = (tmpProfile.Palette && tmpProfile.Palette.paper)      || '#FBF7EE';
		let tmpRough   = (tmpProfile.Roughness !== undefined) ? tmpProfile.Roughness : 1;
		let tmpStrokeW = tmpProfile.StrokeWidth || 2;
		let tmpFillStyle = tmpProfile.FillStyle || 'hachure';
		let tmpFontIdx = _FontFamilyMap[tmpProfile.FontFamily || 'Excalifont'] || 5;
		let tmpFontSz  = tmpProfile.FontSize || 16;

		// First pass — compute each entity's total height (header + fields)
		// and its position in the grid.
		let tmpEntityBox = {};       // id → { x, y, width, height }
		let tmpFieldYByPath = {};    // 'entityId.fieldName' → absolute y of that row's center
		for (let i = 0; i < tmpEntities.length; i++)
		{
			let tmpE = tmpEntities[i];
			let tmpCol = i % COLUMNS;
			let tmpRow = Math.floor(i / COLUMNS);
			let tmpFields = Array.isArray(tmpE.fields) ? tmpE.fields : [];
			let tmpHeight = HEADER_H + Math.max(1, tmpFields.length) * FIELD_H + 16;
			let tmpX = PAD_X + tmpCol * (ENTITY_W + COLUMN_GAP);
			// y depends on cumulative height of taller entities above — but
			// for simplicity we use a uniform row height equal to the max
			// height in the grid (computed below).
			tmpEntityBox[tmpE.id] = { x: tmpX, y: 0, width: ENTITY_W, height: tmpHeight, col: tmpCol, row: tmpRow, fields: tmpFields };
		}
		// Resolve row heights (max within row)
		let tmpRowMaxHeight = {};
		for (let id in tmpEntityBox)
		{
			let tmpB = tmpEntityBox[id];
			if (!tmpRowMaxHeight[tmpB.row] || tmpB.height > tmpRowMaxHeight[tmpB.row])
			{
				tmpRowMaxHeight[tmpB.row] = tmpB.height;
			}
		}
		// Cumulative y per row
		let tmpRowY = {};
		let tmpRunningY = PAD_Y;
		let tmpRowKeys = Object.keys(tmpRowMaxHeight).map((k) => parseInt(k, 10)).sort((a, b) => a - b);
		for (let r = 0; r < tmpRowKeys.length; r++)
		{
			tmpRowY[tmpRowKeys[r]] = tmpRunningY;
			tmpRunningY += tmpRowMaxHeight[tmpRowKeys[r]] + ROW_GAP;
		}
		for (let id in tmpEntityBox) tmpEntityBox[id].y = tmpRowY[tmpEntityBox[id].row];

		let tmpElements = [];
		let tmpSeed = 2000;

		// 1. Title
		if (pGraph.title)
		{
			tmpElements.push(_textElement(
				pGraph.title, PAD_X, 8, 320, 36,
				Math.round(tmpFontSz * 1.5), tmpFontIdx, tmpStroke, tmpSeed++
			));
		}

		// 2. Each entity: a container rectangle + a separator line below
		//    the header + a single multi-line text block containing the
		//    fields (each field on its own line).
		for (let i = 0; i < tmpEntities.length; i++)
		{
			let tmpE = tmpEntities[i];
			let tmpBox = tmpEntityBox[tmpE.id];
			let tmpStrokeColor = tmpE.accent === 'accent' ? tmpAccent
				: tmpE.accent === 'link'      ? tmpLink
				: tmpE.accent === 'deemphasis' ? tmpDeem
				: tmpStroke;

			let tmpContainerId = 'dd-entity-' + tmpE.id + '-' + tmpSeed;
			tmpElements.push({
				id:            tmpContainerId,
				type:          'rectangle',
				x:             tmpBox.x, y: tmpBox.y,
				width:         tmpBox.width, height: tmpBox.height,
				angle:         0,
				strokeColor:   tmpStrokeColor,
				backgroundColor: tmpPaper,
				fillStyle:     tmpFillStyle,
				strokeWidth:   tmpStrokeW,
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

			// Header text — entity name, bold-ish via slightly bigger font.
			let tmpHeaderId = 'dd-header-' + tmpE.id + '-' + tmpSeed;
			tmpElements.push(_textElement(
				tmpE.label || tmpE.id,
				tmpBox.x + 8, tmpBox.y + 6, tmpBox.width - 16, HEADER_H - 8,
				Math.round(tmpFontSz * 1.05), tmpFontIdx, tmpStrokeColor, tmpSeed++,
				{ textAlign: 'center' }
			));
			tmpElements[tmpElements.length - 1].id = tmpHeaderId;

			// Separator line under the header
			tmpElements.push({
				id:            'dd-sep-' + tmpE.id + '-' + tmpSeed,
				type:          'line',
				x:             tmpBox.x, y: tmpBox.y + HEADER_H,
				width:         tmpBox.width, height: 0,
				angle:         0,
				strokeColor:   tmpStrokeColor,
				backgroundColor: 'transparent',
				fillStyle:     'solid',
				strokeWidth:   tmpStrokeW * 0.8,
				strokeStyle:   'solid',
				roughness:     tmpRough,
				opacity:       100,
				groupIds:      [],
				frameId:       null,
				roundness:     null,
				seed:          tmpSeed++, version: 1, versionNonce: tmpSeed,
				isDeleted:     false, boundElements: null,
				updated:       1, link: null, locked: false,
				points:        [ [ 0, 0 ], [ tmpBox.width, 0 ] ],
				lastCommittedPoint: null,
				startBinding:  null, endBinding: null,
				startArrowhead: null, endArrowhead: null,
				elbowed:       false,
				index:         null
			});

			// Fields — one text element per field, stacked vertically.
			// Per-field rendering lets us record the y position of each
			// field for FK arrow attachment.
			let tmpFieldsList = tmpBox.fields;
			for (let f = 0; f < tmpFieldsList.length; f++)
			{
				let tmpField = tmpFieldsList[f];
				let tmpFieldText = _formatField(tmpField);
				let tmpFieldStroke = tmpField.pk ? tmpAccent
					: tmpField.fk ? tmpLink
					: tmpStroke;
				let tmpFY = tmpBox.y + HEADER_H + 4 + f * FIELD_H;
				let tmpFieldId = 'dd-field-' + tmpE.id + '-' + tmpField.name + '-' + tmpSeed;
				tmpElements.push(_textElement(
					tmpFieldText,
					tmpBox.x + 10, tmpFY, tmpBox.width - 20, FIELD_H - 2,
					Math.max(13, tmpFontSz - 3), tmpFontIdx, tmpFieldStroke, tmpSeed++,
					{ textAlign: 'left' }
				));
				tmpElements[tmpElements.length - 1].id = tmpFieldId;

				tmpFieldYByPath[tmpE.id + '.' + tmpField.name] = tmpFY + FIELD_H / 2;
			}
		}

		// 3. Relations — FK arrows.  Format: "entityId.fieldName" → "entityId.fieldName"
		for (let i = 0; i < tmpRelations.length; i++)
		{
			let tmpRel = tmpRelations[i];
			let tmpFromParts = String(tmpRel.from || '').split('.');
			let tmpToParts   = String(tmpRel.to   || '').split('.');
			let tmpFromEntity = tmpEntityBox[tmpFromParts[0]];
			let tmpToEntity   = tmpEntityBox[tmpToParts[0]];
			if (!tmpFromEntity || !tmpToEntity) continue;

			// Choose attachment X depending on relative entity positions.
			let tmpStartX, tmpEndX;
			if (tmpFromEntity.x < tmpToEntity.x)
			{
				tmpStartX = tmpFromEntity.x + tmpFromEntity.width;
				tmpEndX   = tmpToEntity.x;
			}
			else if (tmpFromEntity.x > tmpToEntity.x)
			{
				tmpStartX = tmpFromEntity.x;
				tmpEndX   = tmpToEntity.x + tmpToEntity.width;
			}
			else
			{
				// same column — bend around the right edge.
				tmpStartX = tmpFromEntity.x + tmpFromEntity.width;
				tmpEndX   = tmpToEntity.x   + tmpToEntity.width + 40;
			}

			let tmpStartY = (tmpFromParts[1] && tmpFieldYByPath[tmpRel.from])
				? tmpFieldYByPath[tmpRel.from]
				: tmpFromEntity.y + tmpFromEntity.height / 2;
			let tmpEndY = (tmpToParts[1] && tmpFieldYByPath[tmpRel.to])
				? tmpFieldYByPath[tmpRel.to]
				: tmpToEntity.y + tmpToEntity.height / 2;

			tmpElements.push({
				id:            'dd-rel-' + i + '-' + tmpSeed,
				type:          'arrow',
				x:             tmpStartX, y: tmpStartY,
				width:         tmpEndX - tmpStartX, height: tmpEndY - tmpStartY,
				angle:         0,
				strokeColor:   tmpLink,
				backgroundColor: 'transparent',
				fillStyle:     'solid',
				strokeWidth:   tmpStrokeW,
				strokeStyle:   (tmpRel.kind === 'many-to-many') ? 'dashed' : 'solid',
				roughness:     tmpRough,
				opacity:       100,
				groupIds:      [],
				frameId:       null,
				roundness:     { type: 2 },
				seed:          tmpSeed++, version: 1, versionNonce: tmpSeed,
				isDeleted:     false, boundElements: [],
				updated:       1, link: null, locked: false,
				points:        [ [ 0, 0 ], [ tmpEndX - tmpStartX, tmpEndY - tmpStartY ] ],
				lastCommittedPoint: null,
				startBinding:  null, endBinding: null,
				startArrowhead: null, endArrowhead: 'arrow',
				elbowed:       false,
				index:         null
			});

			if (tmpRel.label)
			{
				let tmpLY = (tmpStartY + tmpEndY) / 2;
				tmpElements.push(_textElement(
					tmpRel.label,
					(tmpStartX + tmpEndX) / 2 - 40, tmpLY - 12,
					Math.max(80, tmpRel.label.length * 8 + 16), 18,
					Math.max(11, tmpFontSz - 5), tmpFontIdx, tmpDeem, tmpSeed++,
					{ textAlign: 'center' }
				));
			}
		}

		let tmpAppState = Object.assign({}, (pProfile && pProfile.AppState) || {});
		tmpAppState.currentItemFontFamily = tmpFontIdx;

		let tmpScene = {
			type:     'excalidraw',
			version:  2,
			source:   'pict-renderer-graph/datadict',
			elements: tmpElements,
			appState: tmpAppState,
			files:    {}
		};
		if (typeof fCallback === 'function') fCallback(null, tmpScene);
		return tmpScene;
	}
};

// ----- helpers -----------------------------------------------------------

function _formatField(pField)
{
	let tmpPrefix = '';
	if (pField.pk) tmpPrefix = '★ ';            // primary key
	else if (pField.fk) tmpPrefix = '↗ ';       // foreign key
	let tmpName = String(pField.name || '');
	let tmpType = pField.type ? '  : ' + pField.type : '';
	let tmpNull = pField.nullable ? '  ?' : '';
	return tmpPrefix + tmpName + tmpType + tmpNull;
}

function _textElement(pText, pX, pY, pW, pH, pFontSize, pFontFamilyIdx, pColor, pSeed, pExtras)
{
	let tmpEx = pExtras || {};
	return {
		id:            null,
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
