/**
 * Diagram-Flow.js
 *
 * Process flow / lines-and-boxes.  Topo-sorted left-to-right layout,
 * grouped columns, per-column max-width packing.
 *
 * Delegates to pict-section-excalidraw's `Generate-Notebook-Diagram.js`
 * which already implements this exact layout.  The handler is a thin
 * adapter that maps the unified `GraphInput` shape onto the generator's
 * input shape.  Forwards `style` so callers can swap profiles at the
 * graph level.
 */

const libGenerate = require('pict-section-excalidraw/scripts/Generate-Notebook-Diagram.js');

module.exports =
{
	name:        'flow',
	description: 'Process flow / lines-and-boxes.  Topo-sorted columns, multiple nodes stack vertically inside each column.',
	async:       false,

	/**
	 * @param {object} pGraph    - { type:'flow', title?, style?, nodes, edges, layout? }
	 * @param {object} pProfile  - resolved style profile object
	 * @param {object} pVendor   - unused for sync handlers
	 * @param {Function} fCallback - (err, scene)  optional; sync return also supported
	 * @returns {object|undefined} the Excalidraw scene, when called synchronously
	 */
	toScene: function (pGraph, pProfile, pVendor, fCallback)
	{
		let tmpInput =
		{
			title:  pGraph.title  || null,
			nodes:  pGraph.nodes  || [],
			edges:  pGraph.edges  || [],
			layout: pGraph.layout || 'flow'
		};
		let tmpScene = libGenerate(tmpInput, pProfile);
		if (typeof fCallback === 'function') fCallback(null, tmpScene);
		return tmpScene;
	}
};
