/**
 * Style-Whiteboard.js
 *
 * Bolder, slightly cleaner than the notebook profile.  Cross-hatched
 * fills, cooler palette, larger fonts.  Reads as a fresh whiteboard
 * sketch rather than a worn notebook.
 *
 * Inherits everything from Notebook-Default and tunes the relevant knobs.
 */
const _Base = require('pict-section-excalidraw/source/style-profiles/Notebook-Default.js');

module.exports = Object.assign({}, _Base, {
	Name:        'whiteboard',
	Description: 'Whiteboard sketch — cross-hatched fills, cooler blue-grey palette, slightly larger fonts.',
	Roughness:   1,
	StrokeWidth: 2,
	FillStyle:   'cross-hatch',
	FontFamily:  'Excalifont',
	FontSize:    22,
	Palette: Object.assign({}, _Base.Palette, {
		ink:        '#1F2933',   // graphite-blue
		paper:      '#F4F7F9',   // cool off-white
		accent:     '#2A6F97',   // ink-blue accent
		highlight:  '#FFD166',   // marker yellow
		deemphasis: '#7A8896',
		link:       '#168AAD'    // ocean-teal
	}),
	RandomSeedSalt: 41,
	AppState: Object.assign({}, _Base.AppState, {
		viewBackgroundColor: '#F4F7F9'
	})
});
