/*
	Tests for the native directory-tree path:
	  - Pict-Renderer-Graph-FileTree-Parse.js   (ASCII tree -> rows)
	  - diagrams/Diagram-FileTree.js             (rows -> scene; fs vs concept mode)
	  - Pict-Renderer-Graph-Convert.js           (detect tree blocks in markdown)

	All pure Node (no browser): parse + the synchronous toScene.  Only the final
	SVG export (not exercised here) needs Chromium.
*/

const Chai = require('chai');
const Expect = Chai.expect;

const { parseFileTree } = require('../source/Pict-Renderer-Graph-FileTree-Parse.js');
const libFileTree = require('../source/diagrams/Diagram-FileTree.js');
const Convert = require('../source/Pict-Renderer-Graph-Convert.js');
const Profile = require('pict-section-excalidraw/source/style-profiles/Notebook-Default.js');

suite('PictRendererGraph — filetree parser', function ()
{
	test('parses a filesystem tree: depth, kinds, comments', function ()
	{
		let tmpTree =
			'retold/\n' +
			'├── Manifest.json   # source of truth\n' +
			'├── source/\n' +
			'│   └── package.json\n' +
			'└── docs/';
		let tmpRows = parseFileTree(tmpTree).rows;
		Expect(tmpRows.map((r) => r.name)).to.deep.equal([ 'retold', 'Manifest.json', 'source', 'package.json', 'docs' ]);
		Expect(tmpRows.map((r) => r.depth)).to.deep.equal([ 0, 1, 1, 2, 1 ]);
		Expect(tmpRows[0].kind).to.equal('dir');           // root, has children
		Expect(tmpRows[1].kind).to.equal('file');          // Manifest.json
		Expect(tmpRows[2].kind).to.equal('dir');           // source/ (slash)
		Expect(tmpRows[1].comment).to.equal('source of truth');
	});

	test('marks last-children and open ancestor rails structurally', function ()
	{
		let tmpRows = parseFileTree(
			'root/\n' +
			'├── a/\n' +
			'│   └── a1\n' +
			'└── b').rows;
		let tmpByName = {};
		tmpRows.forEach((r) => { tmpByName[r.name] = r; });
		Expect(tmpByName.a.last).to.equal(false);          // a has sibling b
		Expect(tmpByName.b.last).to.equal(true);           // b is the last child
		Expect(tmpByName.a1.last).to.equal(true);          // a1 is a's only child
		// a1 is depth 2 -> one ancestor rail (level 0).  It is OPEN because the
		// level-1 path node `a` is not a last child (b still follows under root),
		// so the root spine keeps running down past a1's row.
		Expect(tmpByName.a1.bars).to.deep.equal([ true ]);
	});

	test('handles a forest: several top-level nodes (numbered process)', function ()
	{
		let tmpRows = parseFileTree(
			'1. First\n' +
			'   └── do a thing\n' +
			'2. Second\n' +
			'   └── do another').rows;
		let tmpTop = tmpRows.filter((r) => r.depth === 0).map((r) => r.name);
		Expect(tmpTop).to.deep.equal([ '1. First', '2. Second' ]);   // both roots survive
		Expect(tmpRows.length).to.equal(4);
	});

	test('ranks non-uniform indentation by distinct column (4 then 12 spaces)', function ()
	{
		let tmpRows = parseFileTree(
			'A\n' +
			'    └── B\n' +
			'            └── C').rows;
		Expect(tmpRows.map((r) => r.depth)).to.deep.equal([ 0, 1, 2 ]);   // not 0,1,3
	});
});

suite('PictRendererGraph — filetree handler', function ()
{
	function _types(pScene) { return pScene.elements.map((e) => e.type); }

	test('filesystem tree emits folder/file rectangles', function ()
	{
		let tmpScene = libFileTree.toScene({ type: 'filetree', tree: 'app/\n├── index.js\n└── lib/' }, Profile);
		Expect(_types(tmpScene)).to.include('rectangle');   // folder/file glyphs
		Expect(_types(tmpScene)).to.include('text');
		Expect(_types(tmpScene)).to.not.include('ellipse'); // no neutral dots in fs mode
	});

	test('concept tree (no slashes / extensions) emits neutral node dots', function ()
	{
		let tmpScene = libFileTree.toScene({ type: 'filetree', tree: 'Base\n└── Derived\n    └── Leaf' }, Profile);
		Expect(_types(tmpScene)).to.include('ellipse');     // node dots
		Expect(_types(tmpScene)).to.not.include('rectangle'); // not drawn as folders/files
	});

	test('reads source from the shared mermaid/source field too', function ()
	{
		let tmpScene = libFileTree.toScene({ type: 'filetree', mermaid: 'x/\n└── y.js' }, Profile);
		Expect(tmpScene.elements.length).to.be.greaterThan(0);
		Expect(tmpScene.source).to.equal('pict-renderer-graph/filetree');
	});
});

suite('PictRendererGraph — convert: tree-block detection', function ()
{
	test('detects a directory-tree fence, ignores box-art and code', function ()
	{
		let tmpMd = [
			'# Layout', '',
			'```', 'src/', '├── a.js', '└── b.js', '```', '',
			'## Box', '',
			'```', '┌─────┐', '│ Box │', '└─────┘', '```', '',
			'## Code', '',
			'```js', 'const x = 1;', '```'
		].join('\n');
		let tmpBlocks = Convert.extractTreeBlocks(tmpMd);
		Expect(tmpBlocks.length).to.equal(1);
		Expect(tmpBlocks[0].heading).to.equal('Layout');
		Expect(tmpBlocks[0].body).to.contain('├── a.js');
	});

	test('does not treat a ```mermaid fence as a tree', function ()
	{
		let tmpMd = '```mermaid\ngraph TD\n  A --> B\n```';
		Expect(Convert.extractTreeBlocks(tmpMd).length).to.equal(0);
	});
});
