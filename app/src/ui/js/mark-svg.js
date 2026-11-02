// The static VISION mark (a Landolt C with the focus dot), as inline SVG.
// Geometry from design-ref/logo/vision-mark-{dark,light}.svg; colours come from theme tokens
// (--mark-ring / --mark-dot), so the dark or light variant is picked by the theme.

let uid = 0;

export function markSvg(size = 24, { label = "VISION" } = {}) {
	const id = `vision-mark-mask-${++uid}`;
	const wrap = document.createElement("span");
	wrap.className = "vision-mark";
	wrap.innerHTML = `<svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${label}">
		<defs><mask id="${id}"><rect width="100" height="100" fill="#fff"/><circle cx="50" cy="50" r="24" fill="#000"/><rect x="50" y="42" width="60" height="16" fill="#000" transform="rotate(-45 50 50)"/></mask></defs>
		<circle class="vision-mark__ring" cx="50" cy="50" r="40" mask="url(#${id})"/>
		<circle class="vision-mark__dot" cx="50" cy="50" r="11"/>
	</svg>`;
	return wrap;
}
