/**
 * Style-Dark.js
 *
 * Notebook palette inverted — charcoal "paper", light ink, muted-orange
 * accent.  For diagrams that ship into dark-mode docs.
 */
const _Base = require('pict-section-excalidraw/source/style-profiles/Notebook-Default.js');

module.exports = Object.assign({}, _Base, {
	Name:        'dark',
	Description: 'Dark mode notebook — charcoal paper, light ink, muted-orange accent.',
	Roughness:   1,
	StrokeWidth: 2,
	FillStyle:   'hachure',
	FontFamily:  'Excalifont',
	FontSize:    20,
	Palette: Object.assign({}, _Base.Palette, {
		ink:        '#E8E1D2',   // bone
		paper:      '#1B1F23',   // charcoal
		accent:     '#E27D60',   // muted orange
		highlight:  '#D4A547',   // dim mustard
		deemphasis: '#7A7468',
		link:       '#85C1A9'    // sage
	}),
	RandomSeedSalt: 73,
	AppState: Object.assign({}, _Base.AppState, {
		theme:               'dark',
		viewBackgroundColor: '#1B1F23',
		exportWithDarkMode:  true
	})
});
