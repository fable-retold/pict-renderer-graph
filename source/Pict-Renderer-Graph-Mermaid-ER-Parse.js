/**
 * Pict-Renderer-Graph-Mermaid-ER-Parse.js
 *
 * Parser for the mermaid ENTITY-RELATIONSHIP (erDiagram) subset the docs use --
 * entities with optional attribute blocks (typed columns + PK/FK/UK key markers
 * + optional comments) and relationships with crow's-foot cardinality. Turns the
 * text into an entity + relationship model the native ER renderer lays out, so
 * ER diagrams render through code we own rather than mermaid-to-excalidraw.
 *
 *   erDiagram
 *     USER ||--o{ ORDER : places          # relationship (crow's-foot cardinality)
 *     USER {                              # entity with an attribute block
 *       int id PK
 *       string name
 *       string email "the user's email"
 *     }
 *
 * Output:
 *   {
 *     entities: [
 *       { id, label, attributes: [ { type, name, keys:[ 'PK'|'FK'|'UK' ], comment } ] }
 *     ],
 *     relationships: [
 *       { from, to, fromCard, toCard, identifying, label }
 *       // fromCard / toCard are the raw 2-char cardinality tokens (||, }o, o{, ...);
 *       // identifying is true for the solid `--` line, false for the dashed `..` line.
 *     ]
 *   }
 *
 * Entities are emitted in first-seen order (whether first seen in a relationship
 * or an attribute block); an entity referenced only by a relationship is emitted
 * with an empty attribute list.
 */

// A relationship line: LEFT <leftcard><line><rightcard> RIGHT : label
//   leftcard / rightcard : two chars drawn from | o O { }
//   line                 : -- (identifying / solid) or .. (non-identifying / dashed)
//   label                : bare word or "quoted phrase" (mermaid also allows no label)
const _RelationshipRe = /^([A-Za-z0-9_]+)\s+([|oO{}]{2})(--|\.\.)([|oO{}]{2})\s+([A-Za-z0-9_]+)\s*(?::\s*(.*))?$/;

// An attribute row inside an entity block: <type> <name> [key[,key]...] ["comment"]
const _KeyRe = /^(PK|FK|UK)$/i;

function parseMermaidER(pSource)
{
	let tmpLines = String(pSource == null ? '' : pSource).split('\n');

	let tmpEntities = {};
	let tmpOrder = [];
	let tmpRelationships = [];

	let tmpDeclare = (pId) =>
	{
		let tmpId = String(pId).trim();
		if (!tmpId) { return null; }
		if (!tmpEntities[tmpId])
		{
			tmpEntities[tmpId] = { id: tmpId, label: tmpId, attributes: [] };
			tmpOrder.push(tmpId);
		}
		return tmpEntities[tmpId];
	};

	let tmpCurrentEntity = null;   // non-null while inside an attribute block

	for (let l = 0; l < tmpLines.length; l++)
	{
		let tmpLine = tmpLines[l].trim();
		if (!tmpLine || tmpLine.slice(0, 2) === '%%') { continue; }
		if (/^erDiagram\b/i.test(tmpLine)) { continue; }

		// Inside an attribute block: rows until the closing brace.
		if (tmpCurrentEntity)
		{
			if (tmpLine === '}' || tmpLine.slice(0, 1) === '}')
			{
				tmpCurrentEntity = null;
				continue;
			}
			let tmpAttr = _parseAttribute(tmpLine);
			if (tmpAttr) { tmpCurrentEntity.attributes.push(tmpAttr); }
			continue;
		}

		// Entity attribute block opener:  ENTITY {   (optionally  ENTITY["Label"] {)
		let tmpBlock = tmpLine.match(/^([A-Za-z0-9_]+)\s*(?:\[\s*"([^"]*)"\s*\])?\s*\{$/);
		if (tmpBlock)
		{
			let tmpEntity = tmpDeclare(tmpBlock[1]);
			if (tmpBlock[2]) { tmpEntity.label = tmpBlock[2].trim(); }
			tmpCurrentEntity = tmpEntity;
			continue;
		}

		// Relationship line.
		let tmpRel = tmpLine.match(_RelationshipRe);
		if (tmpRel)
		{
			tmpDeclare(tmpRel[1]);
			tmpDeclare(tmpRel[5]);
			let tmpLabel = (tmpRel[6] || '').trim().replace(/^"(.*)"$/, '$1');
			tmpRelationships.push(
			{
				from:        tmpRel[1],
				to:          tmpRel[5],
				fromCard:    tmpRel[2],
				toCard:      tmpRel[4],
				identifying: (tmpRel[3] === '--'),
				label:       tmpLabel
			});
			continue;
		}

		// A bare entity declaration (name on its own line) -- rare, but harmless.
		let tmpBare = tmpLine.match(/^([A-Za-z0-9_]+)$/);
		if (tmpBare) { tmpDeclare(tmpBare[1]); continue; }
		// Unrecognized line -- ignore (keeps the parser forgiving).
	}

	return {
		entities:      tmpOrder.map((pId) => tmpEntities[pId]),
		relationships: tmpRelationships
	};
}

// Parse one attribute row: `<type> <name> [PK|FK|UK ...] ["comment"]`.
// The comment (if any) is a double-quoted phrase at the end; key markers are
// bare PK/FK/UK tokens (comma- or space-separated) after the name.
function _parseAttribute(pLine)
{
	// Pull a trailing "quoted comment" off first so its spaces don't split.
	let tmpComment = '';
	let tmpRest = pLine;
	let tmpCommentMatch = pLine.match(/"([^"]*)"\s*$/);
	if (tmpCommentMatch)
	{
		tmpComment = tmpCommentMatch[1].trim();
		tmpRest = pLine.slice(0, tmpCommentMatch.index).trim();
	}

	let tmpTokens = tmpRest.split(/[\s,]+/).filter((t) => t.length);
	if (tmpTokens.length < 2) { return null; }   // need at least type + name

	let tmpType = tmpTokens[0];
	let tmpName = tmpTokens[1];
	let tmpKeys = [];
	for (let i = 2; i < tmpTokens.length; i++)
	{
		if (_KeyRe.test(tmpTokens[i])) { tmpKeys.push(tmpTokens[i].toUpperCase()); }
	}
	return { type: tmpType, name: tmpName, keys: tmpKeys, comment: tmpComment };
}

module.exports =
{
	parseMermaidER: parseMermaidER
};
