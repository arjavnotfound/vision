// Styles for the calibration, Diagnostics, first-run and gesture-card screens. Loaded once
// from the screen modules; uses only the existing design tokens.
export function ensureBuildDStyles() {
	if (typeof document === "undefined" || document.getElementById("vision-build-d-css")) return;
	const link = document.createElement("link");
	link.id = "vision-build-d-css";
	link.rel = "stylesheet";
	link.href = new URL("../css/build-d.css", import.meta.url).href;
	document.head.append(link);
}
