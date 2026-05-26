/**
 * Diagram-Star.js
 *
 * Hub-and-spoke radial layout.  One hub node placed at the canvas center,
 * the others arranged on a circle around it.  Used for "X relates to A,
 * B, C, D" style mental models.
 *
 * Hub selection:
 *   1. A node explicitly marked with `hub: true`
 *   2. Else the node that's the target of the most edges
 *   3. Else the first node
 *
 * Layout strategy:
 *   - Hub at (cx, cy)
 *   - Spokes evenly distributed on a circle.  Radius scales to fit all
 *     spokes without overlap based on per-node size + padding.
 *   - Optional `spokeOrder` field on the graph reorders the spokes.
 *
 * Implementation note: rather than hand-build Excalidraw elements, we
 * precompute (x, y) for each node + set layout='manual' on the input,
 * then delegate to Generate-Notebook-Diagram.js.  That gets us
 * style-profile application, label binding, arrow binding, title
 * placement, and deterministic seeding for free.
 */

const libGenerate = require('pict-section-excalidraw/scripts/Generate-Notebook-Diagram.js');

module.exports =
{
	name:        'star',
	description: 'Hub-and-spoke.  One central node, others arranged on a circle.  Best for "X relates to A, B, C, D" mental models.',
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

		let tmpHubId = _selectHub(tmpNodes, tmpEdges, pGraph.hub);
		let tmpSpokes = tmpNodes.filter((n) => n.id !== tmpHubId);

		// Allow caller to override the spoke ordering (clockwise from 12 o'clock).
		if (Array.isArray(pGraph.spokeOrder))
		{
			let tmpByOrder = pGraph.spokeOrder.map((pId) => tmpSpokes.find((n) => n.id === pId)).filter(Boolean);
			let tmpExtras  = tmpSpokes.filter((n) => pGraph.spokeOrder.indexOf(n.id) === -1);
			tmpSpokes = tmpByOrder.concat(tmpExtras);
		}

		let tmpDefaults = (pProfile && pProfile.DefaultSizes) || {};
		let tmpFontSize = (pProfile && pProfile.FontSize)     || 20;

		// Estimate the max spoke shape size (we need this to choose a radius
		// that prevents the spoke shapes from overlapping each other on the
		// circle).  Match Generate-Notebook-Diagram's sizeFor heuristic.
		let tmpMaxSpokeWidth  = 0;
		let tmpMaxSpokeHeight = 0;
		for (let i = 0; i < tmpSpokes.length; i++)
		{
			let tmpDim = _sizeFor(tmpSpokes[i], tmpDefaults, tmpFontSize);
			if (tmpDim.width  > tmpMaxSpokeWidth)  tmpMaxSpokeWidth  = tmpDim.width;
			if (tmpDim.height > tmpMaxSpokeHeight) tmpMaxSpokeHeight = tmpDim.height;
		}

		// Hub size — slightly larger by default to read as the focal point.
		let tmpHubNode = tmpNodes.find((n) => n.id === tmpHubId);
		let tmpHubDim  = _sizeFor(tmpHubNode, tmpDefaults, Math.round(tmpFontSize * 1.1));

		// Compute radius so adjacent spokes are at least 1 spoke-width apart.
		// Chord length of a regular N-gon of radius R is 2*R*sin(pi/N), so
		// solving for R given a desired chord >= maxSpokeWidth + padding:
		let tmpN = Math.max(1, tmpSpokes.length);
		let tmpPad = 80;
		let tmpNeededChord = tmpMaxSpokeWidth + tmpPad;
		// Avoid divide-by-zero for tmpN=1, where any radius works.
		let tmpRadius;
		if (tmpN >= 2)
		{
			let tmpSin = Math.sin(Math.PI / tmpN);
			tmpRadius = Math.max(220, tmpNeededChord / (2 * tmpSin));
		}
		else
		{
			tmpRadius = 280;
		}
		// Also guarantee enough clearance between hub edge and spoke edge.
		let tmpMinClearRadius = tmpHubDim.width / 2 + tmpMaxSpokeWidth / 2 + 100;
		if (tmpRadius < tmpMinClearRadius) tmpRadius = tmpMinClearRadius;

		// Center the canvas around (0, 0)-ish — autoLayoutFlow reserves
		// 80px above the diagram for the title, so we offset by that much
		// and let bounds-based title placement do the rest.
		let tmpCX = tmpRadius + tmpHubDim.width;
		let tmpCY = tmpRadius + tmpHubDim.height + 80;  // 80 = title space

		// Hub goes at center
		tmpHubNode.x = Math.round(tmpCX - tmpHubDim.width  / 2);
		tmpHubNode.y = Math.round(tmpCY - tmpHubDim.height / 2);

		// Spokes go on the circle, evenly spaced, starting from 12 o'clock
		// and walking clockwise.
		for (let i = 0; i < tmpSpokes.length; i++)
		{
			let tmpSpoke = tmpSpokes[i];
			let tmpAngle = -Math.PI / 2 + (i * (2 * Math.PI / tmpN));  // -π/2 == 12 o'clock
			let tmpDim = _sizeFor(tmpSpoke, tmpDefaults, tmpFontSize);
			let tmpX = tmpCX + Math.cos(tmpAngle) * tmpRadius - tmpDim.width  / 2;
			let tmpY = tmpCY + Math.sin(tmpAngle) * tmpRadius - tmpDim.height / 2;
			tmpSpoke.x = Math.round(tmpX);
			tmpSpoke.y = Math.round(tmpY);
		}

		// Hand off to the existing generator in manual-layout mode.  It
		// builds shapes/labels/arrows + applies the style profile + sets
		// deterministic seeds + places the title above the bounding box.
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

// ----- Helpers (private) ---------------------------------------------------

function _selectHub(pNodes, pEdges, pExplicit)
{
	if (pExplicit && pNodes.find((n) => n.id === pExplicit)) return pExplicit;
	for (let i = 0; i < pNodes.length; i++)
	{
		if (pNodes[i].hub === true) return pNodes[i].id;
	}
	// Highest in-degree as a tiebreaker
	let tmpDeg = {};
	for (let i = 0; i < pEdges.length; i++)
	{
		tmpDeg[pEdges[i].to] = (tmpDeg[pEdges[i].to] || 0) + 1;
		tmpDeg[pEdges[i].from] = (tmpDeg[pEdges[i].from] || 0) + 1;
	}
	let tmpBest = pNodes[0].id;
	let tmpBestScore = tmpDeg[tmpBest] || 0;
	for (let i = 1; i < pNodes.length; i++)
	{
		let tmpScore = tmpDeg[pNodes[i].id] || 0;
		if (tmpScore > tmpBestScore)
		{
			tmpBest = pNodes[i].id;
			tmpBestScore = tmpScore;
		}
	}
	return tmpBest;
}

function _sizeFor(pNode, pDefaults, pFontSize)
{
	let tmpKind = pNode.kind || 'rectangle';
	let tmpBase = pDefaults[tmpKind] || pDefaults.rectangle || { width: 180, height: 80 };
	let tmpW = pNode.width  || tmpBase.width;
	let tmpH = pNode.height || tmpBase.height;
	let tmpLabelLen = (pNode.label || '').length;
	let tmpEst = tmpLabelLen * pFontSize * 0.55 + 32;
	if (tmpEst > tmpW) tmpW = Math.ceil(tmpEst);
	return { width: tmpW, height: tmpH };
}
