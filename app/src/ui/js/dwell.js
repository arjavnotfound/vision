// In-app dwell activation: every [data-dwell] control can be "clicked" by resting the
// (head-steered) cursor on it. An ember conic ring fills around the cursor.
//
// Safety rules:
//   - A control fires at most once per visit: after firing it is disarmed until the
//     cursor leaves it (so resting on "Pause" cannot toggle back and forth).
//   - Disabled while `isEnabled()` is false: tracking paused (the cursor is then a
//     physical mouse) or desktop dwell clicking is on (the overlay already clicks).
//   - After any activation the cursor must move a little before the next dwell can start,
//     so a control that appears under a resting cursor (a sheet, a dialog) never fires by itself.
//   - Controls marked data-dwell-delay add extra time (e.g. destructive actions).

export function createDwell({ ring, getDwellTime, isEnabled, onActivate = () => { } }) {
	let target = null;
	let startTime = 0;
	let pointer = { x: -100, y: -100 };
	const disarmed = new WeakSet();
	let requireMoveFrom = null;
	const MOVE_TO_REARM_PX = 18;
	let raf = 0;

	function findTarget(node) {
		const el = node instanceof Element ? node.closest("[data-dwell]") : null;
		if (!el || el.disabled || el.closest("[inert]") || el.getAttribute("aria-disabled") === "true") {
			return null;
		}
		return el;
	}

	function clearTarget() {
		if (target) {
			target.classList.remove("is-dwelling");
		}
		target = null;
		ring.classList.remove("is-active");
		ring.style.setProperty("--p", "0");
	}

	function placeRing() {
		ring.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0)`;
	}

	function tick() {
		raf = 0;
		if (!target) {
			return;
		}
		if (!isEnabled() || !target.isConnected) {
			clearTarget();
			return;
		}
		const extra = Number(target.dataset.dwellDelay || 0);
		const duration = Math.max(200, getDwellTime() + extra);
		const progress = Math.min(1, (performance.now() - startTime) / duration);
		ring.style.setProperty("--p", progress.toFixed(3));
		if (progress >= 1) {
			const fired = target;
			disarmed.add(fired);
			requireMoveFrom = { ...pointer };
			clearTarget();
			ring.classList.remove("is-done");
			void ring.offsetWidth; // restart the snap animation
			ring.classList.add("is-done");
			onActivate(fired);
			fired.click();
			return;
		}
		raf = requestAnimationFrame(tick);
	}

	function onMove(event) {
		pointer = { x: event.clientX, y: event.clientY };
		const el = findTarget(document.elementFromPoint(event.clientX, event.clientY));
		// Re-arm controls once the cursor has left them.
		if (target && el !== target) {
			clearTarget();
		}
		if (!el) {
			return;
		}
		if (requireMoveFrom) {
			if (Math.hypot(pointer.x - requireMoveFrom.x, pointer.y - requireMoveFrom.y) < MOVE_TO_REARM_PX) {
				return;
			}
			requireMoveFrom = null;
		}
		if (disarmed.has(el)) {
			return;
		}
		if (!isEnabled()) {
			return;
		}
		if (!target) {
			target = el;
			startTime = performance.now();
			target.classList.add("is-dwelling");
			ring.classList.remove("is-done");
			ring.classList.add("is-active");
		}
		placeRing();
		if (!raf) {
			raf = requestAnimationFrame(tick);
		}
	}

	function onLeave() {
		clearTarget();
	}

	// Re-arm: forget disarmed elements the cursor is no longer over.
	function onOver(event) {
		const el = findTarget(event.target);
		const related = findTarget(event.relatedTarget);
		if (related && related !== el) {
			disarmed.delete(related);
		}
	}
	function onOut(event) {
		const el = findTarget(event.target);
		const next = findTarget(event.relatedTarget);
		if (el && el !== next) {
			disarmed.delete(el);
		}
	}

	document.addEventListener("pointermove", onMove, { passive: true });
	document.addEventListener("pointerover", onOver, { passive: true });
	document.addEventListener("pointerout", onOut, { passive: true });
	document.documentElement.addEventListener("pointerleave", onLeave);
	// A real click also counts as using the control.
	document.addEventListener("click", (event) => {
		const el = findTarget(event.target);
		if (el && el === target) {
			disarmed.add(el);
			clearTarget();
		}
		requireMoveFrom = { ...pointer };
	}, true);

	return {
		cancel: clearTarget,
		/** For previews: show the ring at a point with a given progress. */
		showStatic(x, y, progress, el) {
			pointer = { x, y };
			placeRing();
			ring.classList.add("is-active");
			ring.style.setProperty("--p", String(progress));
			el?.classList.add("is-dwelling");
		},
	};
}
