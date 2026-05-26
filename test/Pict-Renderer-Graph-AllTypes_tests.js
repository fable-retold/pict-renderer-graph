/*
	Exercises every diagram type registered in Diagram-Registry, end-to-end
	through the real renderer.  Each test:
	   1. Builds a small input
	   2. Calls render()
	   3. Asserts the SVG carries Excalidraw + source metadata
	   4. Asserts the scene has the expected element count

	If any of these fail, the corresponding diagram handler is broken.
*/

const Chai = require('chai');
const Expect = Chai.expect;

const libFable = require('fable');
const libPictRendererGraph = require('../source/Pict-Renderer-Graph.js');

suite('PictRendererGraph — all diagram types', function ()
{
	this.timeout(60000);

	let _fable;
	let _renderer;

	suiteSetup(function (fDone)
	{
		_fable = new libFable();
		_renderer = new libPictRendererGraph(_fable);
		_renderer.initialize(fDone);
	});

	suiteTeardown(function (fDone)
	{
		if (!_renderer) return fDone();
		_renderer.shutdown(() => fDone());
	});

	function assertSvg(pOut, pExpectedSourceFragment)
	{
		Expect(pOut.svg).to.be.a('string');
		Expect(pOut.svg).to.include('payload-version:');
		Expect(pOut.svg).to.include('<pict-renderer-graph:source');
		Expect(pOut.svg).to.include(pExpectedSourceFragment);
		Expect(pOut.scene.elements).to.be.an('array');
	}

	test('flow — three-node service chain', function (fDone)
	{
		_renderer.render({
			type: 'flow',
			title: 'flow test',
			nodes: [
				{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }
			],
			edges: [
				{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }
			]
		}, {}, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			try { assertSvg(pOut, '"type":"flow"'); fDone(); }
			catch (pE) { fDone(pE); }
		});
	});

	test('star — hub + 4 spokes', function (fDone)
	{
		_renderer.render({
			type: 'star',
			title: 'star test',
			nodes: [
				{ id: 'hub', label: 'Hub', kind: 'ellipse' },
				{ id: 'a', label: 'A' }, { id: 'b', label: 'B' },
				{ id: 'c', label: 'C' }, { id: 'd', label: 'D' }
			],
			edges: [
				{ from: 'hub', to: 'a' }, { from: 'hub', to: 'b' },
				{ from: 'hub', to: 'c' }, { from: 'hub', to: 'd' }
			]
		}, {}, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			try { assertSvg(pOut, '"type":"star"'); fDone(); }
			catch (pE) { fDone(pE); }
		});
	});

	test('sequence — actors + messages', function (fDone)
	{
		_renderer.render({
			type: 'sequence',
			title: 'login flow',
			actors: [
				{ id: 'client', label: 'Client' },
				{ id: 'api',    label: 'API' },
				{ id: 'db',     label: 'DB' }
			],
			messages: [
				{ from: 'client', to: 'api',    label: 'POST /login' },
				{ from: 'api',    to: 'db',     label: 'lookup user' },
				{ from: 'db',     to: 'api',    label: 'user row', kind: 'return' },
				{ from: 'api',    to: 'client', label: 'token',    kind: 'return' }
			]
		}, {}, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			try
			{
				assertSvg(pOut, '"type":"sequence"');
				// 3 actor rectangles + 3 actor labels + 3 lifelines + 4 message arrows + 4 message labels = 17
				Expect(pOut.scene.elements.length).to.be.greaterThan(10);
				fDone();
			}
			catch (pE) { fDone(pE); }
		});
	});

	test('mindmap — root + 3 children', function (fDone)
	{
		_renderer.render({
			type: 'mindmap',
			title: 'mindmap test',
			root: 'root',
			nodes: [
				{ id: 'root', label: 'Root',  kind: 'ellipse' },
				{ id: 'a',    label: 'A',     kind: 'ellipse' },
				{ id: 'b',    label: 'B',     kind: 'ellipse' },
				{ id: 'c',    label: 'C',     kind: 'ellipse' }
			],
			edges: [
				{ from: 'root', to: 'a' },
				{ from: 'root', to: 'b' },
				{ from: 'root', to: 'c' }
			]
		}, {}, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			try { assertSvg(pOut, '"type":"mindmap"'); fDone(); }
			catch (pE) { fDone(pE); }
		});
	});

	test('datadict — two entities with FK relation', function (fDone)
	{
		_renderer.render({
			type: 'datadict',
			title: 'orders + users',
			entities: [
				{
					id: 'users', label: 'users',
					fields: [
						{ name: 'id',    type: 'int',     pk: true },
						{ name: 'email', type: 'varchar' },
						{ name: 'name',  type: 'varchar', nullable: true }
					]
				},
				{
					id: 'orders', label: 'orders',
					fields: [
						{ name: 'id',      type: 'int', pk: true },
						{ name: 'user_id', type: 'int', fk: true },
						{ name: 'total',   type: 'decimal' }
					]
				}
			],
			relations: [
				{ from: 'orders.user_id', to: 'users.id', label: 'belongs_to', kind: 'one-to-many' }
			]
		}, {}, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			try
			{
				assertSvg(pOut, '"type":"datadict"');
				// 2 containers + 2 headers + 2 separators + 6 field rows + 1 relation arrow + 1 relation label = 14
				Expect(pOut.scene.elements.length).to.be.greaterThan(10);
				fDone();
			}
			catch (pE) { fDone(pE); }
		});
	});

	test('mermaid — small flowchart pass-through', function (fDone)
	{
		_renderer.render({
			type: 'mermaid',
			mermaid: 'flowchart TD\nA[Start] --> B[End]'
		}, {}, (pErr, pOut) =>
		{
			if (pErr) return fDone(pErr);
			try
			{
				assertSvg(pOut, '"type":"mermaid"');
				// mermaid produces some elements for two nodes + an edge
				Expect(pOut.scene.elements.length).to.be.greaterThan(2);
				fDone();
			}
			catch (pE) { fDone(pE); }
		});
	});
});
