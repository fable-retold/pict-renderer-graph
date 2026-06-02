/*
	Tests for the bulk-convert logic (inline mermaid fence -> native SVG ref).
	Pure functions -- no rendering or file I/O.
*/

const Chai = require('chai');
const Expect = Chai.expect;
const C = require('../source/Pict-Renderer-Graph-Convert.js');

suite('PictRendererGraph — convert: classify', function ()
{
	test('flow / sequence / er are supported (with native types)', function ()
	{
		Expect(C.classifyMermaid('graph TD\n A-->B')).to.include({ bucket: 'flow', supported: true, type: 'flowgraph' });
		Expect(C.classifyMermaid('flowchart LR\n A-->B')).to.include({ supported: true, type: 'flowgraph' });
		Expect(C.classifyMermaid('sequenceDiagram\n A->>B: x')).to.include({ bucket: 'sequence', supported: true, type: 'seqgraph' });
		Expect(C.classifyMermaid('erDiagram\n A ||--o{ B : x')).to.include({ bucket: 'er', supported: true, type: 'ergraph' });
	});

	test('class / state / gantt / pie / gitGraph are left unsupported', function ()
	{
		Expect(C.classifyMermaid('classDiagram\n class Foo')).to.include({ bucket: 'class', supported: false, type: null });
		Expect(C.classifyMermaid('stateDiagram-v2\n [*] --> A')).to.include({ bucket: 'state', supported: false });
		Expect(C.classifyMermaid('gantt\n title X')).to.include({ supported: false });
		Expect(C.classifyMermaid('pie\n "a": 1')).to.include({ supported: false });
	});
});

suite('PictRendererGraph — convert: extract + rewrite', function ()
{
	let _md = [
		'# Overview', '', 'Prose.', '',
		'## Request Flow', '',
		'```mermaid', 'graph TD', '  A[Client] --> B[Server]', '```', '',
		'## Class Model', '',
		'```mermaid', 'classDiagram', '  class Foo', '```', ''
	].join('\n');

	test('finds both fences, classifies, and reads the nearest heading', function ()
	{
		let tmpF = C.extractMermaidFences(_md);
		Expect(tmpF.length).to.equal(2);
		Expect(tmpF[0].class.bucket).to.equal('flow');
		Expect(tmpF[0].heading).to.equal('Request Flow');
		Expect(tmpF[1].class.bucket).to.equal('class');
		Expect(tmpF[1].heading).to.equal('Class Model');
	});

	test('derives unique names from headings', function ()
	{
		let tmpUsed = {};
		Expect(C.deriveDiagramName('Request Flow', tmpUsed, 'doc', 0)).to.equal('request-flow');
		Expect(C.deriveDiagramName('Request Flow', tmpUsed, 'doc', 1)).to.equal('request-flow-2');
		Expect(C.deriveDiagramName('', tmpUsed, 'mydoc', 4)).to.equal('mydoc-5');
	});

	test('rewrites supported fences to image refs and leaves unsupported inline', function ()
	{
		let tmpF = C.extractMermaidFences(_md);
		let tmpUsed = {};
		let tmpRepl = [];
		for (let i = 0; i < tmpF.length; i++)
		{
			if (!tmpF[i].class.supported) { continue; }
			let tmpName = C.deriveDiagramName(tmpF[i].heading, tmpUsed, 'doc', i);
			tmpRepl.push({ start: tmpF[i].start, end: tmpF[i].end, text: C.buildImageReference(tmpName, tmpF[i].heading, 'docs', tmpF[i].indent) });
		}
		let tmpOut = C.applyReplacements(_md, tmpRepl);
		Expect(tmpOut).to.contain('![Request Flow](diagrams/request-flow.svg)');
		Expect(tmpOut).to.contain('<!-- bespoke diagram: edit diagrams/request-flow.mmd');
		Expect(tmpOut).to.not.contain('graph TD');           // flow fence replaced
		Expect(tmpOut).to.contain('classDiagram');           // class fence preserved
	});

	test('applyReplacements is order-independent (back-to-front splice)', function ()
	{
		let tmpText = 'AAAABBBBCCCC';
		let tmpOut = C.applyReplacements(tmpText, [
			{ start: 0, end: 4, text: 'x' },
			{ start: 8, end: 12, text: 'z' }
		]);
		Expect(tmpOut).to.equal('xBBBBz');
	});
});
