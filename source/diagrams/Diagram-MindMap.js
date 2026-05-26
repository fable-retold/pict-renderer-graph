/**
 * Diagram-MindMap.js
 *
 * Recursive radial layout.  Root in the middle, children fan out in
 * concentric rings.  Each child gets a wedge of its parent's angular
 * sweep, recursively.
 *
 * Input shape:
 *   {
 *     type: 'mindmap',
 *     title?,
 *     style?,
 *     root: '<node-id>',     // optional — defaults to first node
 *     nodes: [...],
 *     edges: [...]           // parent → child
 *   }
 *
 * Layout strategy:
 *   - Root at (cx, cy)
 *   - Build a tree from edges (treating them as parent → child)
 *   - For depth=1 nodes: distribute around full 360° at radius R0
 *   - For depth=d nodes: each child gets a wedge of its parent's wedge,
 *     placed at radius R0 + d*R_step
 *   - Edges follow the tree (every node's parent is its only inbound edge)
 *
 * Same delegation pattern as Diagram-Star: compute positions, then
 * delegate to Generate-Notebook-Diagram.js with layout: 'manual'.
 */

const libGenerate = require('pict-section-excalidraw/scripts/Generate-Notebook-Diagram.js');

const _BaseRadius = 220;
const _RingStep   = 160;

module.exports =
{
	name:        'mindmap',
	description: 'Recursive radial hierarchy.  Root in the center, children fan out by depth.',
	async:       false,

	toScene: function (pGraph, pProfile, pVendor, fCallback)
	{
		let tmpNodes = (pGraph.nodes || []).map((n) => Object.assign({}, n));
		let tmpEdges = (pGraph.edges || []).map((e) => Object.assign({}, e));

		if (tmpNodes.length < 1)
		{
			let tmpEmpty = libGenerate({ title: pGraph.title, nodes: [], edges: [], layout: 'manual' }, pProfile);
			if (typeof fCallback === 'function') fCallback(null, tmpEmpty);
			return tmpEmpty;
		}

		let tmpRootId = pGraph.root || tmpNodes[0].id;
		let tmpById   = {};
		for (let i = 0; i < tmpNodes.length; i++) tmpById[tmpNodes[i].id] = tmpNodes[i];

		// Build the parent → children map.  Edges are parent→child by
		// convention; if an edge points the other way, we treat it as the
		// same parent relationship (mindmaps don't distinguish direction).
		let tmpChildren = {};
		for (let i = 0; i < tmpNodes.length; i++) tmpChildren[tmpNodes[i].id] = [];
		for (let i = 0; i < tmpEdges.length; i++)
		{
			let tmpFrom = tmpEdges[i].from;
			let tmpTo   = tmpEdges[i].to;
			if (tmpChildren[tmpFrom]) tmpChildren[tmpFrom].push(tmpTo);
		}

		let tmpDefaults = (pProfile && pProfile.DefaultSizes) || {};
		let tmpFontSize = (pProfile && pProfile.FontSize)     || 20;

		// Estimate sizes so we can pick a canvas center that leaves room
		// for the deepest ring.
		let tmpMaxNodeWidth  = 0;
		let tmpMaxNodeHeight = 0;
		for (let i = 0; i < tmpNodes.length; i++)
		{
			let tmpDim = _sizeFor(tmpNodes[i], tmpDefaults, tmpFontSize);
			if (tmpDim.width  > tmpMaxNodeWidth)  tmpMaxNodeWidth  = tmpDim.width;
			if (tmpDim.height > tmpMaxNodeHeight) tmpMaxNodeHeight = tmpDim.height;
		}

		// First pass — recursively compute depth for each node so we can
		// pick a canvas size before placing.
		let tmpDepth = {};
		tmpDepth[tmpRootId] = 0;
		let _markDepth = function (pId, pDepth, pVisited)
		{
			if (pVisited[pId]) return;
			pVisited[pId] = true;
			tmpDepth[pId] = pDepth;
			let tmpKids = tmpChildren[pId] || [];
			for (let i = 0; i < tmpKids.length; i++) _markDepth(tmpKids[i], pDepth + 1, pVisited);
		};
		_markDepth(tmpRootId, 0, {});
		let tmpMaxDepth = 0;
		for (let k in tmpDepth) if (tmpDepth[k] > tmpMaxDepth) tmpMaxDepth = tmpDepth[k];

		let tmpOuterRadius = _BaseRadius + tmpMaxDepth * _RingStep;
		let tmpCX = tmpOuterRadius + tmpMaxNodeWidth;
		let tmpCY = tmpOuterRadius + tmpMaxNodeHeight + 80;  // 80px title space

		// Recursive placement: each node gets an angular sweep (start, end)
		// of which it sits at the midpoint at radius = depth * RingStep.
		// Its children divide its sweep evenly.
		let tmpPlaced = {};
		let _place = function (pId, pAngleStart, pAngleEnd, pDepth)
		{
			if (tmpPlaced[pId]) return;
			tmpPlaced[pId] = true;
			let tmpAngleMid = (pAngleStart + pAngleEnd) / 2;
			let tmpRadius = (pDepth === 0) ? 0 : _BaseRadius + (pDepth - 1) * _RingStep;
			let tmpNode = tmpById[pId];
			let tmpDim = _sizeFor(tmpNode, tmpDefaults, tmpFontSize);
			tmpNode.x = Math.round(tmpCX + Math.cos(tmpAngleMid) * tmpRadius - tmpDim.width  / 2);
			tmpNode.y = Math.round(tmpCY + Math.sin(tmpAngleMid) * tmpRadius - tmpDim.height / 2);

			let tmpKids = tmpChildren[pId] || [];
			if (tmpKids.length === 0) return;
			let tmpSweep = pAngleEnd - pAngleStart;
			let tmpStep  = tmpSweep / tmpKids.length;
			for (let i = 0; i < tmpKids.length; i++)
			{
				let tmpCStart = pAngleStart + i * tmpStep;
				let tmpCEnd   = tmpCStart + tmpStep;
				_place(tmpKids[i], tmpCStart, tmpCEnd, pDepth + 1);
			}
		};

		// Root gets the full 360°, starting at 12 o'clock.
		_place(tmpRootId, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI, 0);

		// Fall back to grid for any orphan nodes (not reachable from root).
		let tmpOrphans = tmpNodes.filter((n) => !tmpPlaced[n.id]);
		if (tmpOrphans.length > 0)
		{
			let tmpOrphanY = tmpCY + tmpOuterRadius + 80;
			for (let i = 0; i < tmpOrphans.length; i++)
			{
				let tmpDim = _sizeFor(tmpOrphans[i], tmpDefaults, tmpFontSize);
				tmpOrphans[i].x = Math.round(80 + i * (tmpDim.width + 40));
				tmpOrphans[i].y = Math.round(tmpOrphanY);
			}
		}

		let tmpScene = libGenerate(
			{
				title:  pGraph.title || null,
				nodes:  tmpNodes,
				edges:  tmpEdges,
				layout: 'manual'
			},
			pProfile
		);
		if (typeof fCallback === 'function') fCallback(null, tmpScene);
		return tmpScene;
	}
};

function _sizeFor(pNode, pDefaults, pFontSize)
{
	let tmpKind = pNode.kind || 'ellipse';   // ellipse is the default mindmap shape
	let tmpBase = pDefaults[tmpKind] || pDefaults.rectangle || { width: 180, height: 80 };
	let tmpW = pNode.width  || tmpBase.width;
	let tmpH = pNode.height || tmpBase.height;
	let tmpLabelLen = (pNode.label || '').length;
	let tmpEst = tmpLabelLen * pFontSize * 0.55 + 32;
	if (tmpEst > tmpW) tmpW = Math.ceil(tmpEst);
	return { width: tmpW, height: tmpH };
}
