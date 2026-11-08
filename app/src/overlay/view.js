// Rendering for the desktop overlay. Pure view: given state, it moves and styles a few
// elements. Position updates are batched to one transform write per animation frame.

const PAUSE_LABEL_MS = 2000;
const CLICK_LABEL_MS = 400;

export function createOverlayView(root = document.body) {
	const cursor = document.createElement("div");
	cursor.className = "cursor is-hidden";
	cursor.innerHTML = `<div class="dwell"></div><div class="halo"></div><div class="snap"></div><div class="tag"></div>`;
	root.append(cursor);
	const dwellEl = cursor.querySelector(".dwell");
	const tag = cursor.querySelector(".tag");

	let x = -100;
	let y = -100;
	let dirty = false;
	let raf = 0;
	let tagTimer = 0;
	let quietTimer = 0;
	let lastProgress = -1;
	let mode = "";

	function flush() {
		raf = 0;
		if (dirty) {
			dirty = false;
			cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
		}
	}

	function moveTo(nx, ny) {
		if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
		if (nx === x && ny === y) return;
		x = nx;
		y = ny;
		dirty = true;
		cursor.classList.remove("is-hidden");
		if (!raf) raf = requestAnimationFrame(flush);
	}

	function showTag(text, { ember = false, ms = CLICK_LABEL_MS } = {}) {
		clearTimeout(tagTimer);
		tag.textContent = text;
		tag.classList.toggle("tag--ember", ember);
		tag.classList.add("is-shown");
		if (ms) {
			tagTimer = setTimeout(() => tag.classList.remove("is-shown"), ms);
		}
	}

	function hideTag() {
		clearTimeout(tagTimer);
		tag.classList.remove("is-shown");
	}

	return {
		moveTo,
		/** progress 0..1 (0 hides the ring); forRelease = the next dwell will drop a drag */
		setDwell(progress, forRelease = false) {
			const p = Math.round(progress * 100) / 100;
			if (p === lastProgress) return;
			lastProgress = p;
			dwellEl.style.setProperty("--p", String(p));
			cursor.classList.toggle("is-dwelling", p > 0.02);
			cursor.classList.toggle("is-holding", forRelease);
		},
		setHolding(holding) {
			cursor.classList.toggle("is-holding", holding);
		},
		/** A click/press happened: shutter-snap pulse plus a short label. */
		pulse(label) {
			cursor.classList.remove("is-snapping");
			void cursor.offsetWidth; // restart the animation
			cursor.classList.add("is-snapping");
			if (label) showTag(label, { ember: true, ms: label === "DRAG" ? 0 : CLICK_LABEL_MS });
		},
		/** mode: "tracking" | "paused" | "takeover" | "noface"; pausedTag: label shown on pause */
		setMode(next, pausedTag = "PAUSED · F9") {
			if (next === mode) return;
			const previous = mode;
			mode = next;
			cursor.classList.toggle("is-paused", next === "paused" || next === "takeover");
			cursor.classList.toggle("is-noface", next === "noface");
			clearTimeout(quietTimer);
			cursor.classList.remove("is-quiet");
			if (next === "paused") {
				showTag(pausedTag, { ms: PAUSE_LABEL_MS });
				quietTimer = setTimeout(() => cursor.classList.add("is-quiet"), PAUSE_LABEL_MS);
			} else if (next === "takeover") {
				showTag("MOUSE", { ms: 0 });
			} else if (next === "noface") {
				showTag("NO FACE", { ms: 0 });
			} else if (previous) {
				hideTag();
			}
		},
		hideTag,
		showTag,
		get element() {
			return cursor;
		},
	};
}
