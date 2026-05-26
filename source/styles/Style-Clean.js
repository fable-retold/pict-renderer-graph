/**
 * Style-Clean.js
 *
 * "We used a ruler" — roughness 0, sharp corners, solid fills, Helvetica.
 * Print-ready, technical-report-friendly.  Loses the hand-drawn vibe
 * intentionally so diagrams blend into formal docs.
 */
const _Base = require('pict-section-excalidraw/source/style-profiles/Notebook-Default.js');

module.exports = Object.assign({}, _Base, {
	Name:        'clean',
	Description: 'Crisp / print-ready — roughness 0, sharp corners, solid fills, Helvetica.',
	Roughness:   0,
	StrokeWidth: 1.5,
	FillStyle:   'solid',
	Roundness:   null,             // sharp corners
	FontFamily:  'Helvetica',
	FontSize:    18,
	Palette: Object.assign({}, _Base.Palette, {
		ink:        '#1A1A1A',
		paper:      '#FFFFFF',
		accent:     '#C0392B',
		highlight:  '#F1C40F',
		deemphasis: '#7F8C8D',
		link:       '#2980B9'
	}),
	RandomSeedSalt: 1,             // every diagram lays out identically
	AppState: Object.assign({}, _Base.AppState, {
		viewBackgroundColor: '#FFFFFF'
	})
});
