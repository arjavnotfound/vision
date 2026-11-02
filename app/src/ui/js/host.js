// Window / app commands provided by the Electron main process (preload `electronAPI`).
// Separate from the engine API: these are about the window, not about tracking.

export function createHost({ preview = false } = {}) {
	const api = window.electronAPI;
	return {
		windowControl: (action) => api?.windowControl?.(action),
		appCommand: (command) => api?.appCommand?.(command),
		getOptions: () => api?.getOptions ? api.getOptions() : Promise.resolve(null),
		getVersion: () => api?.getAppVersion ? api.getAppVersion() : Promise.resolve(""),
		canOpenCameraSettings: Boolean(api?.openCameraSettings) && !preview,
		openCameraSettings: (deviceName) => api?.openCameraSettings?.(deviceName || "Default"),
		onCommand: (callback) => api?.onUiCommand?.(callback),
	};
}
