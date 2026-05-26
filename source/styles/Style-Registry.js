/**
 * Style-Registry.js — name → profile lookup for the four bundled styles.
 *
 * Callers can also pass an inline profile object directly; this registry
 * is just for the string-shortcut shortcut path.  Inline objects without
 * a `Name` field merge over Notebook (the global default).
 */
const _Notebook   = require('./Style-Notebook.js');
const _Whiteboard = require('./Style-Whiteboard.js');
const _Clean      = require('./Style-Clean.js');
const _Dark       = require('./Style-Dark.js');

const _Registry =
{
	'notebook':   _Notebook,
	'whiteboard': _Whiteboard,
	'clean':      _Clean,
	'dark':       _Dark
};

module.exports =
{
	get: function (pName)
	{
		return _Registry[(pName || '').toLowerCase()] || null;
	},

	list: function ()
	{
		let tmpNames = Object.keys(_Registry);
		return tmpNames.map((pName) =>
		({
			name:        pName,
			description: _Registry[pName].Description || '',
			palette:     _Registry[pName].Palette     || null
		}));
	},

	default: function () { return _Notebook; },

	/**
	 * Resolve a `style` field (string OR object) into a merged profile.
	 * Inline-object styles are merged shallow over the named base (or
	 * Notebook if no name is given).
	 */
	resolve: function (pStyle)
	{
		return this.resolveWithName(pStyle).profile;
	},

	/**
	 * Like resolve(), but also returns the *user-facing* style name
	 * (the string the caller passed, OR the inline object's `name` field,
	 * OR null if the caller supplied an unnamed inline object).
	 *
	 * Used by the cache layer to record which named style each entry was
	 * rendered under, so invalidateCache({style: 'notebook'}) can find them.
	 */
	resolveWithName: function (pStyle)
	{
		if (!pStyle) return { profile: _Notebook, inputName: 'notebook' };
		if (typeof pStyle === 'string')
		{
			return {
				profile:   this.get(pStyle) || _Notebook,
				inputName: pStyle
			};
		}
		if (typeof pStyle === 'object')
		{
			let tmpBase = pStyle.name ? (this.get(pStyle.name) || _Notebook) : _Notebook;
			let tmpMerged = Object.assign({}, tmpBase, pStyle);
			if (pStyle.Palette) tmpMerged.Palette = Object.assign({}, tmpBase.Palette, pStyle.Palette);
			if (pStyle.AppState) tmpMerged.AppState = Object.assign({}, tmpBase.AppState, pStyle.AppState);
			return {
				profile:   tmpMerged,
				inputName: pStyle.name || null
			};
		}
		return { profile: _Notebook, inputName: 'notebook' };
	},

	/**
	 * Replace (or add) a named style profile in the registry.  Subsequent
	 * resolve() calls with that name will return the new profile.
	 *
	 * Does NOT invalidate the cache by itself — pair with
	 * PictRendererGraph.invalidateCache({ style: name }) or use
	 * renderer.updateStyle(name, profile) which combines the two.
	 *
	 * @param {string} pName
	 * @param {object} pProfile
	 */
	register: function (pName, pProfile)
	{
		_Registry[(pName || '').toLowerCase()] = Object.assign({}, pProfile, { Name: pProfile.Name || pName });
	},

	/**
	 * Patch the named profile in-place with the supplied fields.
	 * Deep-merges Palette + AppState; shallow-merges everything else.
	 * Useful for runtime tuning: change one color, keep the rest.
	 *
	 * @param {string} pName
	 * @param {object} pPatch
	 * @returns {object} the updated profile
	 */
	update: function (pName, pPatch)
	{
		let tmpKey = (pName || '').toLowerCase();
		let tmpExisting = _Registry[tmpKey];
		if (!tmpExisting) return null;
		let tmpMerged = Object.assign({}, tmpExisting, pPatch || {});
		if (pPatch && pPatch.Palette)  tmpMerged.Palette  = Object.assign({}, tmpExisting.Palette,  pPatch.Palette);
		if (pPatch && pPatch.AppState) tmpMerged.AppState = Object.assign({}, tmpExisting.AppState, pPatch.AppState);
		if (pPatch && pPatch.Layout)   tmpMerged.Layout   = Object.assign({}, tmpExisting.Layout,   pPatch.Layout);
		if (pPatch && pPatch.DefaultSizes) tmpMerged.DefaultSizes = Object.assign({}, tmpExisting.DefaultSizes, pPatch.DefaultSizes);
		_Registry[tmpKey] = tmpMerged;
		return tmpMerged;
	}
};
