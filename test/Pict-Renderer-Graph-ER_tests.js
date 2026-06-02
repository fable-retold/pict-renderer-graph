/*
	Tests for the native entity-relationship path:
	  - Pict-Renderer-Graph-Mermaid-ER-Parse.js  (mermaid erDiagram -> model)
	  - diagrams/Diagram-ER.js                    (model -> scene, incl. crow's foot)

	Both run in pure Node; the handler's toScene is synchronous.
*/

const Chai = require('chai');
const Expect = Chai.expect;

const { parseMermaidER } = require('../source/Pict-Renderer-Graph-Mermaid-ER-Parse.js');
const libER = require('../source/diagrams/Diagram-ER.js');
const Profile = require('pict-section-excalidraw/source/style-profiles/Notebook-Default.js');

suite('PictRendererGraph — mermaid ER parser', function ()
{
	test('parses an attribute block (type, name, key markers, comment)', function ()
	{
		let tmpModel = parseMermaidER('erDiagram\n  USER {\n    int id PK\n    string name\n    text email FK "the address"\n  }');
		Expect(tmpModel.entities.map((e) => e.id)).to.deep.equal([ 'USER' ]);
		let tmpAttrs = tmpModel.entities[0].attributes;
		Expect(tmpAttrs.length).to.equal(3);
		Expect(tmpAttrs[0]).to.include({ type: 'int', name: 'id' });
		Expect(tmpAttrs[0].keys).to.deep.equal([ 'PK' ]);
		Expect(tmpAttrs[1].keys).to.deep.equal([]);
		Expect(tmpAttrs[2]).to.include({ type: 'text', name: 'email', comment: 'the address' });
		Expect(tmpAttrs[2].keys).to.deep.equal([ 'FK' ]);
	});

	test('parses a relationship + auto-declares both entities in first-seen order', function ()
	{
		let tmpModel = parseMermaidER('erDiagram\n  USER ||--o{ ORDER : places');
		Expect(tmpModel.entities.map((e) => e.id)).to.deep.equal([ 'USER', 'ORDER' ]);
		let tmpRel = tmpModel.relationships[0];
		Expect(tmpRel).to.include({ from: 'USER', to: 'ORDER', fromCard: '||', toCard: 'o{', identifying: true, label: 'places' });
	});

	test('distinguishes identifying (--) from non-identifying (..) and strips quoted labels', function ()
	{
		let tmpModel = parseMermaidER('erDiagram\n  A ||..o| B : "weak link"');
		Expect(tmpModel.relationships[0]).to.include({ identifying: false, fromCard: '||', toCard: 'o|', label: 'weak link' });
	});

	test('merges an attribute block with relationship-declared entities', function ()
	{
		// ORDER is first seen in the relationship, then gets an attribute block.
		let tmpModel = parseMermaidER('erDiagram\n  USER ||--o{ ORDER : places\n  ORDER {\n    int id PK\n  }');
		let tmpOrder = tmpModel.entities.find((e) => e.id === 'ORDER');
		Expect(tmpOrder.attributes.length).to.equal(1);
		Expect(tmpOrder.attributes[0]).to.include({ type: 'int', name: 'id' });
	});
});

suite('PictRendererGraph — cardinality decode (crow\'s foot)', function ()
{
	let tmpDecode = libER.decodeCardinality;

	test('exactly one (||) -> two bars, no fork, no circle', function ()
	{
		Expect(tmpDecode('||')).to.deep.equal({ many: false, optional: false, bars: 2 });
	});
	test('zero or many (o{ / }o) -> fork + circle, no bar', function ()
	{
		Expect(tmpDecode('o{')).to.deep.equal({ many: true, optional: true, bars: 0 });
		Expect(tmpDecode('}o')).to.deep.equal({ many: true, optional: true, bars: 0 });
	});
	test('one or many (|{ / }|) -> fork + one bar', function ()
	{
		Expect(tmpDecode('|{')).to.deep.equal({ many: true, optional: false, bars: 1 });
		Expect(tmpDecode('}|')).to.deep.equal({ many: true, optional: false, bars: 1 });
	});
	test('zero or one (o| / |o) -> one bar + circle, no fork', function ()
	{
		Expect(tmpDecode('o|')).to.deep.equal({ many: false, optional: true, bars: 1 });
	});
});

suite('PictRendererGraph — ergraph handler (mermaid -> scene)', function ()
{
	function build(pSource)
	{
		return libER.toScene({ type: 'ergraph', mermaid: pSource }, Profile, null);
	}

	test('renders an entity as a table: box + header + a text per attribute cell', function ()
	{
		let tmpScene = build('erDiagram\n  USER {\n    int id PK\n    string name\n  }');
		let tmpBox = tmpScene.elements.find((e) => e.id === 'er-box-USER' && e.type === 'rectangle');
		Expect(tmpBox).to.not.equal(undefined);
		// Header + (type, name) for row 0 + (type, name) for row 1 + the PK key cell.
		let tmpHeader = tmpScene.elements.find((e) => e.id === 'er-title-USER' && e.text === 'USER');
		Expect(tmpHeader).to.not.equal(undefined);
		Expect(tmpScene.elements.some((e) => e.id === 'er-n-USER-0' && e.text === 'id')).to.equal(true);
		Expect(tmpScene.elements.some((e) => e.id === 'er-k-USER-0' && e.text === 'PK')).to.equal(true);
	});

	test('draws crow\'s-foot markers per cardinality end (|| -> bars, o{ -> fork + circle)', function ()
	{
		let tmpScene = build('erDiagram\n  USER ||--o{ ORDER : places');
		// fromCard '||' on the USER end -> two bars, no fork.
		let tmpBars = tmpScene.elements.filter((e) => /^erc-0-a-bar/.test(e.id || ''));
		Expect(tmpBars.length).to.equal(2);
		Expect(tmpScene.elements.some((e) => /^erc-0-a-fork/.test(e.id || ''))).to.equal(false);
		// toCard 'o{' on the ORDER end -> a three-prong fork + an optional circle.
		Expect(tmpScene.elements.filter((e) => /^erc-0-b-fork/.test(e.id || '')).length).to.equal(3);
		let tmpZero = tmpScene.elements.find((e) => e.id === 'erc-0-b-zero');
		Expect(tmpZero).to.not.equal(undefined);
		Expect(tmpZero.type).to.equal('ellipse');
	});

	test('relationship connector carries no arrowheads (crow\'s foot replaces them) + has a label', function ()
	{
		let tmpScene = build('erDiagram\n  USER ||--o{ ORDER : places');
		let tmpArrow = tmpScene.elements.find((e) => e.id === 'er-rel-0' && e.type === 'arrow');
		Expect(tmpArrow).to.not.equal(undefined);
		Expect(tmpArrow.startArrowhead).to.equal(null);
		Expect(tmpArrow.endArrowhead).to.equal(null);
		Expect(tmpScene.elements.some((e) => e.id === 'er-rlabel-0' && e.text === 'places')).to.equal(true);
	});
});
