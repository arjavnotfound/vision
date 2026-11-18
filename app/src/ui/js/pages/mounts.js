// Mount points for the modules chunk D builds (calibration, diagnostics, gesture-card,
// onboarding), each exporting mount(el, ctx). Loaded on demand, so a missing module leaves
// an empty slot instead of stopping the window.
export async function mountFeature(name, el, ctx) {
	try {
		const mod = await import(`../${name}.js`);
		return mod.mount ? mod.mount(el, ctx) : null;
	} catch (error) {
		console.warn(`[mount] ${name} is not available:`, error);
		return null;
	}
}
