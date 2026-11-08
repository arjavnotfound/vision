/* global jsfeat, Stats, clm, faceLandmarksDetection */

const Vision = {
	dependenciesRoot: "./vision-hft",
};

Vision.loadDependencies = function ({ statsJs = false } = {}) {
	Vision.dependenciesRoot = Vision.dependenciesRoot.replace(/\/+$/, "");
	const loadScript = src => {
		return new Promise((resolve, reject) => {
			// This wouldn't wait for them to load
			// for (const script of document.scripts) {
			// 	if (script.src.includes(src)) {
			// 		resolve();
			// 		return;
			// 	}
			// }
			const script = document.createElement('script');
			script.type = 'text/javascript';
			script.onload = resolve;
			script.onerror = reject;
			script.src = src;
			document.head.append(script);
		});
	};
	const scriptFiles = [
		`${Vision.dependenciesRoot}/lib/no-eval.js`, // generated with eval-is-evil.html, this instruments clmtrackr.js so I don't need unsafe-eval in the CSP
		`${Vision.dependenciesRoot}/lib/clmtrackr.js`,
		`${Vision.dependenciesRoot}/lib/face_mesh/face_mesh.js`,
		`${Vision.dependenciesRoot}/lib/OneEuroFilter.js`,
	];
	// face-landmarks-detection.min.js depends on face_mesh.js
	// avoid sporadic "TypeError: o.Facemesh is not a constructor" by loading face-landmarks-detection after face_mesh.js
	// TODO: preload in parallel?
	const moreScriptFiles = [
		`${Vision.dependenciesRoot}/lib/face-landmarks-detection.min.js`,
	];
	if (statsJs) {
		scriptFiles.push(`${Vision.dependenciesRoot}/lib/stats.js`);
	}
	return Promise.all([...scriptFiles.map(loadScript), Vision.loadCoreModules()]).then(() => {
		return Promise.all(moreScriptFiles.map(loadScript));
	});
};

/**
 * Loads the pure engine modules from ./src (ES modules). Must resolve before Vision.init().
 * Vision.loadDependencies() calls this too.
 */
Vision.loadCoreModules = function () {
	if (!Vision._coreModulesPromise) {
		Vision._coreModulesPromise = import("./src/index.js").then((module) => {
			Vision.modules = module;
			return module;
		});
	}
	return Vision._coreModulesPromise;
};

const isSelectorValid = ((dummyElement) =>
	(selector) => {
		try { dummyElement.querySelector(selector); } catch { return false; }
		return true;
	})(document.createDocumentFragment());


const dwellClickers = [];

let playSound = () => { console.log("audio module not loaded yet; can't play sound effect"); };
let initialAudioEnabled = false;
let setAudioEnabled = (enabled) => { initialAudioEnabled = enabled; };

/**
 * @param {Object} config
 * @param {string} config.targets - a CSS selector for the elements to click. Anything else will be ignored (except as an occluder).
 * @param {(el: Element) => boolean} [config.shouldDrag] - a function that returns true if the element should be dragged rather than simply clicked.
 * @param {(el: Element) => boolean} [config.noCenter] - a function that returns true if the element should be clicked anywhere on the element, rather than always at the center.
 * @param {Array<{
 *   from: string | Element | ((el: Element) => boolean), // - an array of `{ from, to, withinMargin }` objects, which define rules for dynamically changing what is hovered/clicked when the mouse is over a different element.
 *   to: string | Element | ((el: Element) => Element | null), // - the element to retarget from. Can be a CSS selector, an element, or a function taking the element under the mouse and returning whether it should be retargeted.
 *   withinMargin?: number // - the element to retarget to. Can be a CSS selector for an element which is an ancestor or descendant of the `from` element, or an element, or a function taking the element under the mouse and returning an element to retarget to, or null to ignore the element.
 * }>} [config.retarget] - a number of pixels within which to consider the mouse over the `to` element. Default to infinity.
 * @param {(el1: Element, el2: Element) => boolean} [config.isEquivalentTarget] - a function that returns true if two elements should be considered part of the same control, i.e. if clicking either should do the same thing. Elements that are equal are always considered equivalent even if you return false. This option is used for preventing the system from detecting occluding elements as separate controls, and rejecting the click. (When an occlusion is detected, it flashes a red box.)
 * @param {(el: Element) => boolean} [config.dwellClickEvenIfPaused] - a function that returns true if the element should be clicked even while dwell clicking is otherwise paused. Use this for a dwell clicking toggle button, so it's possible to resume dwell clicking. With dwell clicking it's important to let users take a break, since otherwise you have to constantly move the cursor in order to not click on things!
 * @param {(el: Element) => boolean} [config.shouldClickThrough] - a function that returns true if the element should be totally ignored, allowing clicking on content behind it. Prefer `pointer-events: none` when possible, which will work for all input methods. Use this only if you need to differentiate input methods. Default: `(el) => el.matches(".vision-click-through, .vision-click-through *")`
 * @param {(args: {x: number, y: number, target: Element}) => void} config.click - a function to trigger a click on the given target element.
 * @param {() => void} [config.beforeDispatch] - a function to call before a pointer event is dispatched. For detecting un-trusted user gestures, outside of an event handler.
 * @param {() => void} [config.afterDispatch] - a function to call after a pointer event is dispatched. For detecting un-trusted user gestures, outside of an event handler.
 * @param {() => void} [config.beforePointerDownDispatch] - a function to call before a `pointerdown` event is dispatched. Likely to be merged with `config.beforeDispatch()` in the future.
 * @param {() => boolean} [config.isHeld] - a function that returns true if the next dwell should be a release (triggering `pointerup`).
 * @param {number | (() => number)} [config.hoverTimespan] - dwell time in milliseconds, from the dwell indicator appearing to the click. Default 500.
 * @param {boolean} [config.releaseDragOnFastMovement] - whether a quick, large movement ends a dwell drag. Default true.
 * @param {(info: {x: number, y: number, progress: number, forRelease: boolean}) => void} [config.onDwellProgress] - called every frame with the dwell progress (0..1) so a custom indicator can be drawn.
 */
const initDwellClicking = (config) => {

	/** translation placeholder */
	const t = (key, options = {}) => options.defaultValue ?? key;

	if (typeof config !== "object") {
		throw new Error(t("api.errors.configRequired", { defaultValue: "configuration object required for initDwellClicking" }));
	}
	if (config.targets === undefined) {
		throw new Error(t("api.errors.targetsRequired", { defaultValue: "config.targets is required (must be a CSS selector)" }));
	}
	if (typeof config.targets !== "string") {
		throw new Error(t("api.errors.targetsMustBeSelectorString", { defaultValue: "config.targets must be a string (a CSS selector)" }));
	}
	if (!isSelectorValid(config.targets)) {
		throw new Error(t("api.errors.targetsInvalidSelector", { defaultValue: "config.targets is not a valid CSS selector" }));
	}
	if (config.click === undefined) {
		throw new Error(t("api.errors.clickRequired", { defaultValue: "config.click is required" }));
	}
	if (typeof config.click !== "function") {
		throw new Error(t("api.errors.functionRequired", { defaultValue: "%0 must be a function" }).replace("%0", "config.click"));
	}
	if (config.shouldDrag !== undefined && typeof config.shouldDrag !== "function") {
		throw new Error(t("api.errors.functionRequired", { defaultValue: "%0 must be a function" }).replace("%0", "config.shouldDrag"));
	}
	if (config.noCenter !== undefined && typeof config.noCenter !== "function") {
		throw new Error(t("api.errors.functionRequired", { defaultValue: "%0 must be a function" }).replace("%0", "config.noCenter"));
	}
	if (config.isEquivalentTarget !== undefined && typeof config.isEquivalentTarget !== "function") {
		throw new Error(t("api.errors.functionRequired", { defaultValue: "%0 must be a function" }).replace("%0", "config.isEquivalentTarget"));
	}
	if (config.dwellClickEvenIfPaused !== undefined && typeof config.dwellClickEvenIfPaused !== "function") {
		throw new Error(t("api.errors.functionRequired", { defaultValue: "%0 must be a function" }).replace("%0", "config.dwellClickEvenIfPaused"));
	}
	if (config.shouldClickThrough !== undefined && typeof config.shouldClickThrough !== "function") {
		throw new Error(t("api.errors.functionRequired", { defaultValue: "%0 must be a function" }).replace("%0", "config.shouldClickThrough"));
	}
	if (config.beforeDispatch !== undefined && typeof config.beforeDispatch !== "function") {
		throw new Error(t("api.errors.functionRequired", { defaultValue: "%0 must be a function" }).replace("%0", "config.beforeDispatch"));
	}
	if (config.afterDispatch !== undefined && typeof config.afterDispatch !== "function") {
		throw new Error(t("api.errors.functionRequired", { defaultValue: "%0 must be a function" }).replace("%0", "config.afterDispatch"));
	}
	if (config.beforePointerDownDispatch !== undefined && typeof config.beforePointerDownDispatch !== "function") {
		throw new Error(t("api.errors.functionRequired", { defaultValue: "%0 must be a function" }).replace("%0", "config.beforePointerDownDispatch"));
	}
	if (config.isHeld !== undefined && typeof config.isHeld !== "function") {
		throw new Error(t("api.errors.functionRequired", { defaultValue: "%0 must be a function" }).replace("%0", "config.isHeld"));
	}
	if (config.hoverTimespan !== undefined && typeof config.hoverTimespan !== "function" && typeof config.hoverTimespan !== "number") {
		throw new Error(t("api.errors.numberRequired", { defaultValue: "%0 must be a number" }).replace("%0", "config.hoverTimespan"));
	}
	if (config.retarget !== undefined) {
		if (!Array.isArray(config.retarget)) {
			throw new Error(t("api.errors.retargetMustBeArray", { defaultValue: "config.retarget must be an array of objects" }));
		}
		for (let i = 0; i < config.retarget.length; i++) {
			const rule = config.retarget[i];
			if (typeof rule !== "object") {
				throw new Error(t("api.errors.retargetMustBeArray", { defaultValue: "config.retarget must be an array of objects" }));
			}
			if (rule.from === undefined) {
				throw new Error(t("api.errors.retargetFromRequired", { defaultValue: "config.retarget[%0].from is required" }).replace("%0", i));
			}
			if (rule.to === undefined) {
				throw new Error(t("api.errors.retargetToRequired", { defaultValue: "config.retarget[%0].to is required (although can be null to ignore the element)" }).replace("%0", i));
			}
			if (rule.withinMargin !== undefined && typeof rule.withinMargin !== "number") {
				throw new Error(t("api.errors.numberRequired", { defaultValue: "%0 must be a number" }).replace("%0", `config.retarget[${i}].withinMargin`));
			}
			if (typeof rule.from !== "string" && typeof rule.from !== "function" && !(rule.from instanceof Element)) {
				throw new Error(t("api.errors.retargetFromInvalidType", { defaultValue: "config.retarget[%0].from must be a CSS selector string, an Element, or a function" }).replace("%0", i));
			}
			if (typeof rule.to !== "string" && typeof rule.to !== "function" && !(rule.to instanceof Element) && rule.to !== null) {
				throw new Error(t("api.errors.retargetToInvalidType", { defaultValue: "config.retarget[%0].to must be a CSS selector string, an Element, a function, or null" }).replace("%0", i));
			}
			if (typeof rule.from === "string" && !isSelectorValid(rule.from)) {
				throw new Error(t("api.errors.retargetFromInvalidSelector", { defaultValue: "config.retarget[%0].from is not a valid CSS selector" }).replace("%0", i));
			}
			if (typeof rule.to === "string" && !isSelectorValid(rule.to)) {
				throw new Error(t("api.errors.retargetToInvalidSelector", { defaultValue: "config.retarget[%0].to is not a valid CSS selector" }).replace("%0", i));
			}
		}
	}

	const shouldClickThrough = config.shouldClickThrough ?? ((el) => el.matches(".vision-click-through, .vision-click-through *"));

	// VisionContainer.querySelector(".vision-canvas").classList.add("inset-deep");

	const circleRadiusMax = 50; // dwell indicator size in pixels
	// how long between the dwell indicator appearing and triggering a click
	const getHoverTimespan = () => {
		const value = typeof config.hoverTimespan === "function" ? config.hoverTimespan() : config.hoverTimespan;
		return Number.isFinite(value) && value > 0 ? value : 500;
	};
	const averagingWindowTimespan = 500;
	const inactiveAtStartupTimespan = 1500; // (should be at least averagingWindowTimespan, but more importantly enough to make it not awkward when enabling dwell clicking)
	const inactiveAfterReleaseTimespan = 1000; // after click or drag release (from dwell or otherwise)
	const inactiveAfterHoveredTimespan = 1000; // after dwell click indicator appears; does not control the time to finish that dwell click, only to click on something else after this is canceled (but it doesn't control that directly)
	const inactiveAfterInvalidTimespan = 1000; // after a dwell click is canceled due to an element popping up in front, or existing in front at the center of the other element
	const inactiveAfterFocusedTimespan = 1000; // after page becomes focused after being unfocused
	let recentPoints = [];
	let inactiveUntilTime = performance.now();
	let paused = false;
	let hoverCandidate;
	let dwellDragging = null;

	const deactivateForAtLeast = (timespan) => {
		inactiveUntilTime = Math.max(inactiveUntilTime, performance.now() + timespan);
	};
	deactivateForAtLeast(inactiveAtStartupTimespan);

	const halo = document.createElement("div");
	halo.className = "vision-hover-halo";
	halo.style.display = "none";
	document.body.appendChild(halo);
	const dwellIndicator = document.createElement("div");
	dwellIndicator.className = "vision-dwell-indicator";
	dwellIndicator.style.width = `${circleRadiusMax}px`;
	dwellIndicator.style.height = `${circleRadiusMax}px`;
	dwellIndicator.style.display = "none";
	document.body.appendChild(dwellIndicator);

	const onPointerMove = (e) => {
		recentPoints.push({ x: e.clientX, y: e.clientY, time: performance.now() });
	};
	const onPointerUpOrCancel = (_e) => {
		deactivateForAtLeast(inactiveAfterReleaseTimespan);
		dwellDragging = null;
	};

	let pageFocused = document.visibilityState === "visible"; // guess/assumption
	let mouseInsidePage = true; // assumption
	const onFocus = () => {
		pageFocused = true;
		deactivateForAtLeast(inactiveAfterFocusedTimespan);
	};
	const onBlur = () => {
		pageFocused = false;
	};
	const onMouseLeavePage = () => {
		mouseInsidePage = false;
	};
	const onMouseEnterPage = () => {
		mouseInsidePage = true;
	};

	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", onPointerUpOrCancel);
	window.addEventListener("pointercancel", onPointerUpOrCancel);
	window.addEventListener("focus", onFocus);
	window.addEventListener("blur", onBlur);
	document.addEventListener("mouseleave", onMouseLeavePage);
	document.addEventListener("mouseenter", onMouseEnterPage);

	const getHoverCandidate = (clientX, clientY) => {

		if (!pageFocused || !mouseInsidePage) return null;

		let target = document.elementFromPoint(clientX, clientY);
		if (!target) {
			return null;
		}

		if (shouldClickThrough(target)) {
			const elements = document.elementsFromPoint(clientX, clientY);
			target = elements.find(el => !shouldClickThrough(el));
			if (!target) {
				return null;
			}
		}

		let hoverCandidate = {
			x: clientX,
			y: clientY,
			time: performance.now(),
		};

		let retargeted = false;
		for (const { from, to, withinMargin = Infinity } of (config.retarget ?? [])) {
			if (
				from instanceof Element ? from === target :
					typeof from === "function" ? from(target) :
						target.matches(from)
			) {
				const toElement =
					(to instanceof Element || to === null) ? to :
						typeof to === "function" ? to(target) :
							(target.closest(to) || target.querySelector(to));
				if (toElement === null) {
					return null;
				} else if (toElement) {
					const toRect = toElement.getBoundingClientRect();
					if (
						hoverCandidate.x > toRect.left - withinMargin &&
						hoverCandidate.y > toRect.top - withinMargin &&
						hoverCandidate.x < toRect.right + withinMargin &&
						hoverCandidate.y < toRect.bottom + withinMargin
					) {
						target = toElement;
						hoverCandidate.x = Math.min(
							toRect.right - 1,
							Math.max(
								toRect.left,
								hoverCandidate.x,
							),
						);
						hoverCandidate.y = Math.min(
							toRect.bottom - 1,
							Math.max(
								toRect.top,
								hoverCandidate.y,
							),
						);
						retargeted = true;
					}
				}
			}
		}

		if (!retargeted) {
			target = target.closest(config.targets);

			if (!target) {
				return null;
			}
		}

		if (!config.noCenter?.(target)) {
			// Nudge hover previews to the center of buttons and things
			const rect = target.getBoundingClientRect();
			hoverCandidate.x = rect.left + rect.width / 2;
			hoverCandidate.y = rect.top + rect.height / 2;
		}
		hoverCandidate.target = target;
		return hoverCandidate;
	};

	const getEventOptions = ({ x, y }) => {
		return {
			view: window, // needed for offsetX/Y calculation
			clientX: x,
			clientY: y,
			pointerId: 1234567890,
			pointerType: "mouse",
			isPrimary: true,
			bubbles: true,
			cancelable: true,
		};
	};

	const averagePoints = (points) => {
		const average = { x: 0, y: 0 };
		for (const pointer of points) {
			average.x += pointer.x;
			average.y += pointer.y;
		}
		average.x /= points.length;
		average.y /= points.length;
		return average;
	};

	const update = () => {
		const time = performance.now();
		recentPoints = recentPoints.filter((pointRecord) => time < pointRecord.time + averagingWindowTimespan);
		if (recentPoints.length) {
			const latestPoint = recentPoints[recentPoints.length - 1];
			recentPoints.push({ x: latestPoint.x, y: latestPoint.y, time });
			const averagePoint = averagePoints(recentPoints);
			// debug
			// const canvasPoint = toCanvasCoords({clientX: averagePoint.x, clientY: averagePoint.y});
			// ctx.fillStyle = "red";
			// ctx.fillRect(canvasPoint.x, canvasPoint.y, 10, 10);
			const recentMovementAmount = Math.hypot(latestPoint.x - averagePoint.x, latestPoint.y - averagePoint.y);

			// Invalidate in case an element pops up in front of the element you're hovering over, e.g. a submenu
			// (that use case doesn't actually work in jspaint because the menu pops up before the hoverCandidate exists)
			// (TODO: disable hovering to open submenus in facial mouse mode in jspaint)
			// or an element occludes the center of an element you're hovering over, in which case it
			// could be confusing if it showed a dwell click indicator over a different element than it would click
			// (but TODO: just move the indicator off center in that case)
			if (hoverCandidate && !dwellDragging) {
				const apparentHoverCandidate = getHoverCandidate(hoverCandidate.x, hoverCandidate.y);
				const showOccluderIndicator = (occluder) => {
					const occluderIndicator = document.createElement("div");
					const occluderRect = occluder.getBoundingClientRect();
					const outlineWidth = 4;
					occluderIndicator.style.pointerEvents = "none";
					occluderIndicator.style.zIndex = 1000001;
					occluderIndicator.style.display = "block";
					occluderIndicator.style.position = "fixed";
					occluderIndicator.style.left = `${occluderRect.left + outlineWidth}px`;
					occluderIndicator.style.top = `${occluderRect.top + outlineWidth}px`;
					occluderIndicator.style.width = `${occluderRect.width - outlineWidth * 2}px`;
					occluderIndicator.style.height = `${occluderRect.height - outlineWidth * 2}px`;
					occluderIndicator.style.outline = `${outlineWidth}px dashed red`;
					occluderIndicator.style.boxShadow = `0 0 ${outlineWidth}px ${outlineWidth}px maroon`;
					document.body.appendChild(occluderIndicator);
					setTimeout(() => {
						occluderIndicator.remove();
					}, inactiveAfterInvalidTimespan * 0.5);
				};
				if (apparentHoverCandidate) {
					if (
						apparentHoverCandidate.target !== hoverCandidate.target &&
						// !retargeted &&
						!config.isEquivalentTarget?.(
							apparentHoverCandidate.target, hoverCandidate.target
						)
					) {
						hoverCandidate = null;
						deactivateForAtLeast(inactiveAfterInvalidTimespan);
						showOccluderIndicator(apparentHoverCandidate.target);
					}
				} else {
					// TODO: ignore .vision-click-through elements here as well
					// TODO: distinguish occlusion vs moved element (i.e. element is no longer in the elementsFromPoint list)
					// for example for the archery targets in the demo on the website, which animate
					let occluder = document.elementFromPoint(hoverCandidate.x, hoverCandidate.y);
					hoverCandidate = null;
					deactivateForAtLeast(inactiveAfterInvalidTimespan);
					showOccluderIndicator(occluder || document.body);
				}
			}

			let circlePosition = latestPoint;
			let circleOpacity = 0;
			let circleRadius = 0;
			if (hoverCandidate) {
				circlePosition = hoverCandidate;
				circleOpacity = 0.4;
				const hoverTimespan = getHoverTimespan();
				circleRadius =
					(hoverCandidate.time - time + hoverTimespan) / hoverTimespan
					* circleRadiusMax;
				if (time > hoverCandidate.time + hoverTimespan) {
					if (config.isHeld?.() || dwellDragging) {
						config.beforeDispatch?.();
						hoverCandidate.target.dispatchEvent(new PointerEvent("pointerup",
							Object.assign(getEventOptions(hoverCandidate), {
								button: 0,
								buttons: 0,
							})
						));
						config.afterDispatch?.();
						playSound("clickRelease");
					} else {
						config.beforePointerDownDispatch?.();
						config.beforeDispatch?.();
						hoverCandidate.target.dispatchEvent(new PointerEvent("pointerdown",
							Object.assign(getEventOptions(hoverCandidate), {
								button: 0,
								buttons: 1,
							})
						));
						config.afterDispatch?.();
						if (config.shouldDrag?.(hoverCandidate.target)) {
							dwellDragging = hoverCandidate.target;
							playSound("clickPress");
						} else {
							config.beforeDispatch?.();
							hoverCandidate.target.dispatchEvent(new PointerEvent("pointerup",
								Object.assign(getEventOptions(hoverCandidate), {
									button: 0,
									buttons: 0,
								})
							));
							config.click(hoverCandidate);
							config.afterDispatch?.();
							playSound("clickPress");
							playSound("clickRelease", { delay: 0.03 }); // fully separating the sounds sounded worse
						}
					}
					hoverCandidate = null;
					deactivateForAtLeast(inactiveAfterHoveredTimespan);
				}
			}

			config.onDwellProgress?.({
				x: circlePosition.x,
				y: circlePosition.y,
				progress: circleOpacity > 0 ? Math.max(0, Math.min(1, 1 - circleRadius / circleRadiusMax)) : 0,
				forRelease: Boolean(dwellDragging),
			});

			if (dwellDragging) {
				dwellIndicator.classList.add("vision-for-release");
			} else {
				dwellIndicator.classList.remove("vision-for-release");
			}
			dwellIndicator.style.display = "";
			dwellIndicator.style.opacity = circleOpacity;
			dwellIndicator.style.transform = `scale(${circleRadius / circleRadiusMax})`;
			dwellIndicator.style.left = `${circlePosition.x - circleRadiusMax / 2}px`;
			dwellIndicator.style.top = `${circlePosition.y - circleRadiusMax / 2}px`;

			let haloTarget =
				dwellDragging ||
				(hoverCandidate || getHoverCandidate(latestPoint.x, latestPoint.y) || {}).target;

			if (haloTarget && (!paused || config.dwellClickEvenIfPaused?.(haloTarget))) {
				let rect = haloTarget.getBoundingClientRect();
				const computedStyle = getComputedStyle(haloTarget);
				let ancestor = haloTarget;
				let borderRadiusScale = 1; // for border radius mimicry, given parents with transform: scale()
				while (ancestor instanceof HTMLElement) {
					const ancestorComputedStyle = getComputedStyle(ancestor);
					if (ancestorComputedStyle.transform) {
						// Collect scale transforms
						const match = ancestorComputedStyle.transform.match(/(?:scale|matrix)\((\d+(?:\.\d+)?)/);
						if (match) {
							borderRadiusScale *= Number(match[1]);
						}
					}
					if (ancestorComputedStyle.overflow !== "visible") {
						// Clamp to visible region if in scrollable area
						// This lets you see the hover halo when scrolled to the middle of a large canvas
						const scrollAreaRect = ancestor.getBoundingClientRect();
						rect = {
							left: Math.max(rect.left, scrollAreaRect.left),
							top: Math.max(rect.top, scrollAreaRect.top),
							right: Math.min(rect.right, scrollAreaRect.right),
							bottom: Math.min(rect.bottom, scrollAreaRect.bottom),
						};
						rect.width = rect.right - rect.left;
						rect.height = rect.bottom - rect.top;
					}
					ancestor = ancestor.parentNode;
				}
				halo.style.display = "block";
				halo.style.position = "fixed";
				halo.style.left = `${rect.left}px`;
				halo.style.top = `${rect.top}px`;
				halo.style.width = `${rect.width}px`;
				halo.style.height = `${rect.height}px`;
				// shorthand properties might not work in all browsers (not tested)
				// this is so overkill...
				// Maybe instead of collecting scale transforms and applying them to the border radii specifically,
				// just collect transforms in general and apply them to the halo element?
				// But of course getBoundingClientRect() includes transforms...
				for (const prop of [
					"borderTopRightRadius",
					"borderTopLeftRadius",
					"borderBottomRightRadius",
					"borderBottomLeftRadius",
				]) {
					// Unfortunately, getComputedStyle can return percentages, probably other units, probably also "auto"
					if (computedStyle[prop].endsWith("px")) {
						halo.style[prop] = `${parseFloat(computedStyle[prop]) * borderRadiusScale}px`;
					} else {
						halo.style[prop] = computedStyle[prop];
					}
				}
			} else {
				halo.style.display = "none";
			}

			if (time < inactiveUntilTime) {
				return;
			}
			if (recentMovementAmount < 5) {
				if (!hoverCandidate) {
					hoverCandidate = {
						x: averagePoint.x,
						y: averagePoint.y,
						time: performance.now(),
						target: dwellDragging || null,
					};
					if (!dwellDragging) {
						hoverCandidate = getHoverCandidate(hoverCandidate.x, hoverCandidate.y);
					}
					if (hoverCandidate && (paused && !config.dwellClickEvenIfPaused?.(hoverCandidate.target))) {
						hoverCandidate = null;
					}
				}
			}
			if (recentMovementAmount > 100 && config.releaseDragOnFastMovement !== false) {
				if (dwellDragging) {
					config.beforeDispatch?.();
					window.dispatchEvent(new PointerEvent("pointerup",
						Object.assign(getEventOptions(averagePoint), {
							button: 0,
							buttons: 0,
						})
					));
					config.afterDispatch?.();
					config.afterReleaseDrag?.();
				}
			}
			if (recentMovementAmount > 60) {
				hoverCandidate = null;
			}
		}
	};
	let rafId;
	const animate = () => {
		rafId = requestAnimationFrame(animate);
		update();
	};
	rafId = requestAnimationFrame(animate);

	const dispose = () => {
		cancelAnimationFrame(rafId);
		halo.remove();
		dwellIndicator.remove();
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", onPointerUpOrCancel);
		window.removeEventListener("pointercancel", onPointerUpOrCancel);
		window.removeEventListener("focus", onFocus);
		window.removeEventListener("blur", onBlur);
		document.removeEventListener("mouseleave", onMouseLeavePage);
		document.removeEventListener("mouseenter", onMouseEnterPage);
	};

	const dwellClicker = {
		get paused() {
			return paused;
		},
		set paused(value) {
			paused = value;
		},
		dispose,
	};
	dwellClickers.push(dwellClicker);
	return dwellClicker;
};

Vision.initDwellClicking = function (config) {
	return initDwellClicking(config);
};
Vision.cleanupDwellClicking = function () {
	for (const dwellClicker of dwellClickers) {
		dwellClicker.dispose();
	}
};

Vision._initAudio = async function () {
	let module;
	try {
		// console.log("Loading audio support...");
		module = await import("./src/audio.js");
	} catch (e) {
		console.warn("Failed to load audio module, click sounds will be disabled:", e);
	}
	// console.log("Audio module loaded.");
	try {
		const { initAudio } = module;
		initAudio();
		playSound = module.playSound;
		setAudioEnabled = module.setAudioEnabled;
		setAudioEnabled(initialAudioEnabled);
		// console.log("Audio is initially " + (initialAudioEnabled ? "enabled" : "disabled"));
	} catch (e) {
		console.warn("Failed to initialize audio support, click sounds will be disabled:", e);
	}
	return module;
};

Vision._initInner = function (div, initOptions, reinit) {

	const VM = Vision.modules;
	if (!VM) {
		throw new Error("VISION core modules are not loaded. Call `await Vision.loadCoreModules()` (or Vision.loadDependencies()) before Vision.init().");
	}
	/** Sends an event to engine API listeners (Vision.initEngine). Never throws into tracking code. */
	const emitEngine = (type, payload) => {
		if (!_emitEngineEvent) {
			return;
		}
		try {
			_emitEngineEvent(type, payload);
		} catch (error) {
			console.error("[VISION engine] event error:", error);
		}
	};

	const {
		statsJs = false,
		// Unstable
		updateInputFeedback = window.electronAPI?.updateInputFeedback,
		// Unstable
		setMouseButtonState = window.electronAPI?.setMouseButtonState,
		// Unstable
		notifyToggleState = window.electronAPI?.notifyToggleState,
		// Unstable
		handleSettingsUpdate,
		// Unstable
		clickingModeSupported = false,
		// Engine mode (Vision.initEngine): no visible legacy UI; events go to the engine API.
		headless = false,
		_emitEngineEvent = null,
		// QA only: replaces face-mesh output (see core/src/testing/synthetic-face.js).
		syntheticFace = null,
		// TODO: manage all of electronAPI similarly? well, setOptions is already a function in scope here,
		// and it's not like we want to expose all electronAPI as part of the public API necessarily
		// Could group things under an "unstable" object, or ideally, design nice APIs for everything.
	} = initOptions;

	/** @type {SleepSweep | null} */
	let sleepSweep = null;

	Vision._initAudio().then((module) => {
		// _initAudio warns in the console and resolves to undefined if it fails to load audio support
		if (module) {
			const { SleepSweep } = module;
			sleepSweep = new SleepSweep();
		}
	});

	const isDesktopApp = !!window.electronAPI;

	let translations = {};
	let locale = navigator.language || "en";
	// Transform en-US to en, etc.
	// We don't support variants yet
	if (locale.includes("-")) {
		locale = locale.split("-")[0];
	}
	const availableLanguages = [
		// GENERATED by scripts/update-locales.js
		"ar", "ar-EG", "bg", "bn", "ca", "ce", "ceb", "cs", "da", "de", "el", "emoji", "en", "eo", "es", "eu", "fa", "fi", "fr", "gu", "ha", "he", "hi", "hr", "hu", "hy", "id", "it", "ja", "jv", "ko", "mr", "ms", "nan", "nb", "nl", "pa", "pl", "pt", "pt-BR", "ro", "ru", "sk", "sl", "sr", "sv", "sw", "ta", "te", "th", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "war", "zh", "zh-simplified"
		// END GENERATED
	];
	// Fallback to a valid dropdown value for unsupported locales
	if (!availableLanguages.includes(locale)) {
		locale = "en";
	}
	try {
		// Load settings early so that they can be used to define settings (among other things)
		// The desktop UI (app/src/ui/js/main.js) copies the stored settings into localStorage first.
		const settingsJSON = localStorage.getItem("vision-settings");
		if (settingsJSON) {
			locale = JSON.parse(settingsJSON)?.globalSettings?.language || locale;
		}
		if (locale !== "en") {
			// synchronous XHR baby!
			const request = new XMLHttpRequest();
			request.open("GET", `${Vision.dependenciesRoot}/locales/${locale}/translation.json`, false);
			request.send(null);
			if (request.status === 200) {
				translations = JSON.parse(request.responseText);
			} else {
				console.warn(`Could not load translations for locale ${locale} (status ${request.status})`);
			}
		}
	} catch (e) {
		console.warn("Could not load translations for Vision UI:", e);
	}
	const rtlLanguages = ["ar", "he", "fa", "ur"]; // Right-to-left languages (current and future)
	const isRTL = rtlLanguages.includes(locale.split("-")[0]);
	const t = (key, options = {}) => translations[key] ?? options.defaultValue ?? key;
	// console.trace("Initializing UI with locale", locale);

	// language name mappings marked with * may not be ISO 639-1
	// they may be ISO 639-3 or bespoke
	// spell-checker:disable
	const languageNames = {
		aa: [["Afar"], ["Afaraf"]],
		ab: [["Abkhazian"], ["Аҧсуа"]],
		af: [["Afrikaans"], ["Afrikaans"]],
		ak: [["Akan"], ["Akan"]],
		am: [["Amharic"], ["አማርኛ"]],
		an: [["Aragonese"], ["Aragonés"]],
		ar: [["Arabic"], ["العربية"]],
		"ar-EG": [["Egyptian Arabic"], ["العربية المصرية"]],
		as: [["Assamese"], ["অসমীয়া"]],
		av: [["Avaric"], ["Авар мацӀ"]],
		ay: [["Aymara"], ["Aymar aru"]],
		az: [["Azerbaijani"], ["Azərbaycan dili"]],
		ba: [["Bashkir"], ["Башҡорт теле"]],
		be: [["Belarusian"], ["Беларуская"]],
		bg: [["Bulgarian"], ["Български"]],
		bh: [["Bihari"], ["भोजपुरी"]],
		bi: [["Bislama"], ["Bislama"]],
		bm: [["Bambara"], ["Bamanankan"]],
		bn: [["Bengali"], ["বাংলা"]],
		bo: [["Tibetan"], ["བོད་ཡིག"]],
		br: [["Breton"], ["Brezhoneg"]],
		bs: [["Bosnian"], ["Bosanski"]],
		ca: [["Catalan"], ["Català"]],
		ce: [["Chechen"], ["Нохчийн"]],
		ceb: [["Cebuano"], ["Sinugboanon"]],
		ch: [["Chamorro"], ["Chamoru"]],
		co: [["Corsican"], ["Corsu"]],
		cr: [["Cree"], ["ᓀᐦᐃᔭᐍᐏᐣ"]],
		cs: [["Czech"], ["Čeština"]],
		cu: [["Church Slavic"], ["Церковнославянский"]],
		cv: [["Chuvash"], ["Чӑвашла"]],
		cy: [["Welsh"], ["Cymraeg"]],
		da: [["Danish"], ["Dansk"]],
		de: [["German"], ["Deutsch"]],
		dv: [["Divehi"], ["ދިވެހި"]],
		dz: [["Dzongkha"], ["རྫོང་ཁ"]],
		ee: [["Ewe"], ["Eʋegbe"]],
		el: [["Greek"], ["Ελληνικά"]],
		emoji: [["Emoji"], ["😃📷"]],
		en: [["English"], ["English"]],
		eo: [["Esperanto"], ["Esperanto"]],
		es: [["Spanish"], ["Español"]],
		et: [["Estonian"], ["Eesti"]],
		eu: [["Basque"], ["Euskara"]],
		fa: [["Persian"], ["فارسی"]],
		ff: [["Fulah"], ["Fulfulde"]],
		fi: [["Finnish"], ["Suomi"]],
		fj: [["Fijian"], ["Na Vosa Vakaviti"]],
		fo: [["Faroese"], ["Føroyskt"]],
		fr: [["French"], ["Français"]],
		fy: [["Western Frisian"], ["Frysk"]],
		ga: [["Irish"], ["Gaeilge"]],
		gd: [["Gaelic"], ["Gàidhlig"]],
		gl: [["Galician"], ["Galego"]],
		gn: [["Guarani"], ["Avañe'ẽ"]],
		gu: [["Gujarati"], ["ગુજરાતી"]],
		gv: [["Manx"], ["Gaelg"]],
		ha: [["Hausa"], ["Hausa"]],
		he: [["Hebrew"], ["עברית"]],
		hi: [["Hindi"], ["हिन्दी"]],
		ho: [["Hiri Motu"], ["Hiri Motu"]],
		hr: [["Croatian"], ["Hrvatski"]],
		ht: [["Haitian"], ["Kreyòl ayisyen"]],
		hu: [["Hungarian"], ["Magyar"]],
		hy: [["Armenian"], ["Հայերեն"]],
		hz: [["Herero"], ["Otjiherero"]],
		ia: [["Interlingua"], ["Interlingua"]],
		id: [["Indonesian"], ["Bahasa Indonesia"]],
		ie: [["Interlingue"], ["Interlingue"]],
		ig: [["Igbo"], ["Asụsụ Igbo"]],
		ii: [["Sichuan Yi"], ["ꆈꌠ꒿"]],
		ik: [["Inupiaq"], ["Iñupiaq"]],
		io: [["Ido"], ["Ido"]],
		is: [["Icelandic"], ["Íslenska"]],
		it: [["Italian"], ["Italiano"]],
		iu: [["Inuktitut"], ["ᐃᓄᒃᑎᑐᑦ"]],
		ja: [["Japanese"], ["日本語"]],
		jv: [["Javanese"], ["Basa Jawa"]],
		ka: [["Georgian"], ["ქართული"]],
		kg: [["Kongo"], ["Kikongo"]],
		ki: [["Kikuyu"], ["Gĩkũyũ"]],
		kj: [["Kuanyama"], ["Kuanyama"]],
		kk: [["Kazakh"], ["Қазақ тілі"]],
		kl: [["Kalaallisut"], ["Kalaallisut"]],
		km: [["Central Khmer"], ["ភាសាខ្មែរ"]],
		kn: [["Kannada"], ["ಕನ್ನಡ"]],
		ko: [["Korean"], ["한국어"]],
		kr: [["Kanuri"], ["Kanuri"]],
		ks: [["Kashmiri"], ["كأشُر"]],
		ku: [["Kurdish"], ["Kurdî"]],
		kv: [["Komi"], ["Коми кыв"]],
		kw: [["Cornish"], ["Kernewek"]],
		ky: [["Kirghiz"], ["Кыргызча"]],
		la: [["Latin"], ["Latina"]],
		lb: [["Luxembourgish"], ["Lëtzebuergesch"]],
		lg: [["Ganda"], ["Luganda"]],
		li: [["Limburgan"], ["Limburgs"]],
		ln: [["Lingala"], ["Lingála"]],
		lo: [["Lao"], ["ພາສາລາວ"]],
		lt: [["Lithuanian"], ["Lietuvių"]],
		lu: [["Luba-Katanga"], ["Tshiluba"]],
		lv: [["Latvian"], ["Latviešu"]],
		mg: [["Malagasy"], ["Malagasy"]],
		mh: [["Marshallese"], ["Kajin M̧ajeļ"]],
		mi: [["Maori"], ["Māori"]],
		mk: [["Macedonian"], ["Македонски"]],
		ml: [["Malayalam"], ["മലയാളം"]],
		mn: [["Mongolian"], ["Монгол хэл"]],
		mr: [["Marathi"], ["मराठी"]],
		ms: [["Malay"], ["Bahasa Melayu"]],
		mt: [["Maltese"], ["Malti"]],
		my: [["Burmese"], ["မြန်မာစာ"]],
		na: [["Nauru"], ["Dorerin Naoero"]],
		nan: [["Min Nan Chinese"], ["閩南語"]],
		nb: [["Norwegian Bokmål"], ["Norsk bokmål"]],
		nd: [["North Ndebele"], ["isiNdebele"]],
		ne: [["Nepali"], ["नेपाली"]],
		ng: [["Ndonga"], ["Owambo"]],
		nl: [["Dutch"], ["Nederlands"]],
		nn: [["Norwegian Nynorsk"], ["Norsk nynorsk"]],
		no: [["Norwegian"], ["Norsk"]],
		nr: [["South Ndebele"], ["isiNdebele"]],
		nv: [["Navajo"], ["Diné bizaad"]],
		ny: [["Chichewa"], ["ChiCheŵa"]],
		oc: [["Occitan"], ["Occitan"]],
		oj: [["Ojibwa"], ["ᐊᓂᔑᓈᐯᒧᐎᓐ"]],
		om: [["Oromo"], ["Afaan Oromoo"]],
		or: [["Oriya"], ["ଓଡ଼ିଆ"]],
		os: [["Ossetian"], ["Ирон æвзаг"]],
		pa: [["Punjabi"], ["ਪੰਜਾਬੀ"]],
		pi: [["Pali"], ["पाऴि"]],
		pl: [["Polish"], ["Polski"]],
		ps: [["Pashto"], ["پښتو"]],
		pt: [["Portuguese"], ["Português"]],
		"pt-BR": [["Brazilian Portuguese"], ["Português Brasileiro"]],
		"pt-PT": [["Portuguese (Portugal)"], ["Português de Portugal"]],
		qu: [["Quechua"], ["Runa Simi"]],
		rm: [["Romansh"], ["Rumantsch"]],
		rn: [["Rundi"], ["Ikirundi"]],
		ro: [["Romanian"], ["Română"]],
		ru: [["Russian"], ["Русский"]],
		rw: [["Kinyarwanda"], ["Ikinyarwanda"]],
		sa: [["Sanskrit"], ["संस्कृतम्"]],
		sc: [["Sardinian"], ["Sardu"]],
		sd: [["Sindhi"], ["سنڌي"]],
		se: [["Northern Sami"], ["Davvisámegiella"]],
		sg: [["Sango"], ["Yângâ tî sängö"]],
		si: [["Sinhala"], ["සිංහල"]],
		sk: [["Slovak"], ["Slovenčina"]],
		sl: [["Slovenian"], ["Slovenščina"]],
		sm: [["Samoan"], ["Gagana fa'a Sāmoa"]],
		sn: [["Shona"], ["chiShona"]],
		so: [["Somali"], ["Soomaaliga"]],
		sq: [["Albanian"], ["Shqip"]],
		sr: [["Serbian"], ["Српски"]],
		ss: [["Swati"], ["SiSwati"]],
		st: [["Southern Sotho"], ["Sesotho"]],
		su: [["Sundanese"], ["Basa Sunda"]],
		sv: [["Swedish"], ["Svenska"]],
		sw: [["Swahili"], ["Kiswahili"]],
		ta: [["Tamil"], ["தமிழ்"]],
		te: [["Telugu"], ["తెలుగు"]],
		tg: [["Tajik"], ["Тоҷикӣ"]],
		th: [["Thai"], ["ไทย"]],
		ti: [["Tigrinya"], ["ትግርኛ"]],
		tk: [["Turkmen"], ["Türkmençe"]],
		tl: [["Tagalog"], ["Tagalog"]],
		tn: [["Tswana"], ["Setswana"]],
		to: [["Tonga"], ["lea faka-Tonga"]],
		tr: [["Turkish"], ["Türkçe"]],
		ts: [["Tsonga"], ["Xitsonga"]],
		tt: [["Tatar"], ["Татар теле"]],
		tw: [["Twi"], ["Twi"]],
		ty: [["Tahitian"], ["Reo Tahiti"]],
		ug: [["Uighur"], ["ئۇيغۇرچە"]],
		uk: [["Ukrainian"], ["Українська"]],
		ur: [["Urdu"], ["اردو"]],
		uz: [["Uzbek"], ["Oʻzbekcha"]],
		ve: [["Venda"], ["Tshivenḓa"]],
		vi: [["Vietnamese"], ["Tiếng Việt"]],
		vo: [["Volapük"], ["Volapük"]],
		wa: [["Walloon"], ["Walon"]],
		war: [["Waray"], ["Winaray"]],
		wo: [["Wolof"], ["Wollof"]],
		xh: [["Xhosa"], ["isiXhosa"]],
		yi: [["Yiddish"], ["ייִדיש"]],
		yo: [["Yoruba"], ["Yorùbá"]],
		za: [["Zhuang"], ["Vahcuengh"]],
		zh: [["Traditional Chinese"], ["繁體中文"]],
		"zh-simplified": [["Simplified Chinese"], ["简体中文"]],
		zu: [["Zulu"], ["isiZulu"]],
	};


	let languageToDefaultRegion = {
		aa: "ET",
		ab: "GE",
		abr: "GH",
		ace: "ID",
		ach: "UG",
		ada: "GH",
		ady: "RU",
		ae: "IR",
		aeb: "TN",
		af: "ZA",
		agq: "CM",
		aho: "IN",
		ak: "GH",
		akk: "IQ",
		aln: "XK",
		alt: "RU",
		am: "ET",
		amo: "NG",
		aoz: "ID",
		apd: "TG",
		ar: "EG",
		arc: "IR",
		"arc-Nbat": "JO",
		"arc-Palm": "SY",
		arn: "CL",
		aro: "BO",
		arq: "DZ",
		ary: "MA",
		arz: "EG",
		as: "IN",
		asa: "TZ",
		ase: "US",
		ast: "ES",
		atj: "CA",
		av: "RU",
		awa: "IN",
		ay: "BO",
		az: "AZ",
		"az-Arab": "IR",
		ba: "RU",
		bal: "PK",
		ban: "ID",
		bap: "NP",
		bar: "AT",
		bas: "CM",
		bax: "CM",
		bbc: "ID",
		bbj: "CM",
		bci: "CI",
		be: "BY",
		bej: "SD",
		bem: "ZM",
		bew: "ID",
		bez: "TZ",
		bfd: "CM",
		bfq: "IN",
		bft: "PK",
		bfy: "IN",
		bg: "BG",
		bgc: "IN",
		bgn: "PK",
		bgx: "TR",
		bhb: "IN",
		bhi: "IN",
		bhk: "PH",
		bho: "IN",
		bi: "VU",
		bik: "PH",
		bin: "NG",
		bjj: "IN",
		bjn: "ID",
		bjt: "SN",
		bkm: "CM",
		bku: "PH",
		blt: "VN",
		bm: "ML",
		bmq: "ML",
		bn: "BD",
		bo: "CN",
		bpy: "IN",
		bqi: "IR",
		bqv: "CI",
		br: "FR",
		bra: "IN",
		brh: "PK",
		brx: "IN",
		bs: "BA",
		bsq: "LR",
		bss: "CM",
		bto: "PH",
		btv: "PK",
		bua: "RU",
		buc: "YT",
		bug: "ID",
		bum: "CM",
		bvb: "GQ",
		byn: "ER",
		byv: "CM",
		bze: "ML",
		ca: "ES",
		cch: "NG",
		ccp: "BD",
		ce: "RU",
		ceb: "PH",
		cgg: "UG",
		ch: "GU",
		chk: "FM",
		chm: "RU",
		cho: "US",
		chp: "CA",
		chr: "US",
		cja: "KH",
		cjm: "VN",
		ckb: "IQ",
		co: "FR",
		cop: "EG",
		cps: "PH",
		cr: "CA",
		crh: "UA",
		crj: "CA",
		crk: "CA",
		crl: "CA",
		crm: "CA",
		crs: "SC",
		cs: "CZ",
		csb: "PL",
		csw: "CA",
		ctd: "MM",
		cu: "RU",
		"cu-Glag": "BG",
		cv: "RU",
		cy: "GB",
		da: "DK",
		dak: "US",
		dar: "RU",
		dav: "KE",
		dcc: "IN",
		de: "DE",
		den: "CA",
		dgr: "CA",
		dje: "NE",
		dnj: "CI",
		doi: "IN",
		dsb: "DE",
		dtm: "ML",
		dtp: "MY",
		dty: "NP",
		dua: "CM",
		dv: "MV",
		dyo: "SN",
		dyu: "BF",
		dz: "BT",
		ebu: "KE",
		ee: "GH",
		efi: "NG",
		egl: "IT",
		egy: "EG",
		eky: "MM",
		el: "GR",
		en: "US",
		"en-Shaw": "GB",
		es: "ES",
		esu: "US",
		et: "EE",
		ett: "IT",
		eu: "ES",
		ewo: "CM",
		ext: "ES",
		fa: "IR",
		fan: "GQ",
		ff: "SN",
		"ff-Adlm": "GN",
		ffm: "ML",
		fi: "FI",
		fia: "SD",
		fil: "PH",
		fit: "SE",
		fj: "FJ",
		fo: "FO",
		fon: "BJ",
		fr: "FR",
		frc: "US",
		frp: "FR",
		frr: "DE",
		frs: "DE",
		fub: "CM",
		fud: "WF",
		fuf: "GN",
		fuq: "NE",
		fur: "IT",
		fuv: "NG",
		fvr: "SD",
		fy: "NL",
		ga: "IE",
		gaa: "GH",
		gag: "MD",
		gan: "CN",
		gay: "ID",
		gbm: "IN",
		gbz: "IR",
		gcr: "GF",
		gd: "GB",
		gez: "ET",
		ggn: "NP",
		gil: "KI",
		gjk: "PK",
		gju: "PK",
		gl: "ES",
		glk: "IR",
		gn: "PY",
		gom: "IN",
		gon: "IN",
		gor: "ID",
		gos: "NL",
		got: "UA",
		grc: "CY",
		"grc-Linb": "GR",
		grt: "IN",
		gsw: "CH",
		gu: "IN",
		gub: "BR",
		guc: "CO",
		gur: "GH",
		guz: "KE",
		gv: "IM",
		gvr: "NP",
		gwi: "CA",
		ha: "NG",
		hak: "CN",
		haw: "US",
		haz: "AF",
		he: "IL",
		hi: "IN",
		hif: "FJ",
		hil: "PH",
		hlu: "TR",
		hmd: "CN",
		hnd: "PK",
		hne: "IN",
		hnj: "LA",
		hnn: "PH",
		hno: "PK",
		ho: "PG",
		hoc: "IN",
		hoj: "IN",
		hr: "HR",
		hsb: "DE",
		hsn: "CN",
		ht: "HT",
		hu: "HU",
		hy: "AM",
		hz: "NA",
		ia: "FR",
		iba: "MY",
		ibb: "NG",
		id: "ID",
		ife: "TG",
		ig: "NG",
		ii: "CN",
		ik: "US",
		ikt: "CA",
		ilo: "PH",
		in: "ID",
		inh: "RU",
		is: "IS",
		it: "IT",
		iu: "CA",
		iw: "IL",
		izh: "RU",
		ja: "JP",
		jam: "JM",
		jgo: "CM",
		ji: "UA",
		jmc: "TZ",
		jml: "NP",
		jut: "DK",
		jv: "ID",
		jw: "ID",
		ka: "GE",
		kaa: "UZ",
		kab: "DZ",
		kac: "MM",
		kaj: "NG",
		kam: "KE",
		kao: "ML",
		kbd: "RU",
		kby: "NE",
		kcg: "NG",
		kck: "ZW",
		kde: "TZ",
		kdh: "TG",
		kdt: "TH",
		kea: "CV",
		ken: "CM",
		kfo: "CI",
		kfr: "IN",
		kfy: "IN",
		kg: "CD",
		kge: "ID",
		kgp: "BR",
		kha: "IN",
		khb: "CN",
		khn: "IN",
		khq: "ML",
		kht: "IN",
		khw: "PK",
		ki: "KE",
		kiu: "TR",
		kj: "NA",
		kjg: "LA",
		kk: "KZ",
		"kk-Arab": "CN",
		kkj: "CM",
		kl: "GL",
		kln: "KE",
		km: "KH",
		kmb: "AO",
		kn: "IN",
		knf: "SN",
		ko: "KR",
		koi: "RU",
		kok: "IN",
		kos: "FM",
		kpe: "LR",
		krc: "RU",
		kri: "SL",
		krj: "PH",
		krl: "RU",
		kru: "IN",
		ks: "IN",
		ksb: "TZ",
		ksf: "CM",
		ksh: "DE",
		ku: "TR",
		"ku-Arab": "IQ",
		kum: "RU",
		kv: "RU",
		kvr: "ID",
		kvx: "PK",
		kw: "GB",
		kxm: "TH",
		kxp: "PK",
		ky: "KG",
		"ky-Arab": "CN",
		"ky-Latn": "TR",
		la: "VA",
		lab: "GR",
		lad: "IL",
		lag: "TZ",
		lah: "PK",
		laj: "UG",
		lb: "LU",
		lbe: "RU",
		lbw: "ID",
		lcp: "CN",
		lep: "IN",
		lez: "RU",
		lg: "UG",
		li: "NL",
		lif: "NP",
		"lif-Limb": "IN",
		lij: "IT",
		lis: "CN",
		ljp: "ID",
		lki: "IR",
		lkt: "US",
		lmn: "IN",
		lmo: "IT",
		ln: "CD",
		lo: "LA",
		lol: "CD",
		loz: "ZM",
		lrc: "IR",
		lt: "LT",
		ltg: "LV",
		lu: "CD",
		lua: "CD",
		luo: "KE",
		luy: "KE",
		luz: "IR",
		lv: "LV",
		lwl: "TH",
		lzh: "CN",
		lzz: "TR",
		mad: "ID",
		maf: "CM",
		mag: "IN",
		mai: "IN",
		mak: "ID",
		man: "GM",
		"man-Nkoo": "GN",
		mas: "KE",
		maz: "MX",
		mdf: "RU",
		mdh: "PH",
		mdr: "ID",
		men: "SL",
		mer: "KE",
		mfa: "TH",
		mfe: "MU",
		mg: "MG",
		mgh: "MZ",
		mgo: "CM",
		mgp: "NP",
		mgy: "TZ",
		mh: "MH",
		mi: "NZ",
		min: "ID",
		mis: "IQ",
		mk: "MK",
		ml: "IN",
		mls: "SD",
		mn: "MN",
		"mn-Mong": "CN",
		mni: "IN",
		mnw: "MM",
		moe: "CA",
		moh: "CA",
		mos: "BF",
		mr: "IN",
		mrd: "NP",
		mrj: "RU",
		mro: "BD",
		ms: "MY",
		mt: "MT",
		mtr: "IN",
		mua: "CM",
		mus: "US",
		mvy: "PK",
		mwk: "ML",
		mwr: "IN",
		mwv: "ID",
		mxc: "ZW",
		my: "MM",
		myv: "RU",
		myx: "UG",
		myz: "IR",
		mzn: "IR",
		na: "NR",
		nan: "CN",
		nap: "IT",
		naq: "NA",
		nb: "NO",
		nch: "MX",
		nd: "ZW",
		ndc: "MZ",
		nds: "DE",
		ne: "NP",
		new: "NP",
		ng: "NA",
		ngl: "MZ",
		nhe: "MX",
		nhw: "MX",
		nij: "ID",
		niu: "NU",
		njo: "IN",
		nl: "NL",
		nmg: "CM",
		nn: "NO",
		nnh: "CM",
		no: "NO",
		nod: "TH",
		noe: "IN",
		non: "SE",
		nqo: "GN",
		nr: "ZA",
		nsk: "CA",
		nso: "ZA",
		nus: "SS",
		nv: "US",
		nxq: "CN",
		ny: "MW",
		nym: "TZ",
		nyn: "UG",
		nzi: "GH",
		oc: "FR",
		om: "ET",
		or: "IN",
		os: "GE",
		osa: "US",
		otk: "MN",
		pa: "IN",
		"pa-Arab": "PK",
		pag: "PH",
		pal: "IR",
		"pal-Phlp": "CN",
		pam: "PH",
		pap: "AW",
		pau: "PW",
		pcd: "FR",
		pcm: "NG",
		pdc: "US",
		pdt: "CA",
		peo: "IR",
		pfl: "DE",
		phn: "LB",
		pka: "IN",
		pko: "KE",
		pl: "PL",
		pms: "IT",
		pnt: "GR",
		pon: "FM",
		pra: "PK",
		prd: "IR",
		ps: "AF",
		pt: "PT", //"BR",
		puu: "GA",
		qu: "PE",
		quc: "GT",
		qug: "EC",
		raj: "IN",
		rcf: "RE",
		rej: "ID",
		rgn: "IT",
		ria: "IN",
		rif: "MA",
		rjs: "NP",
		rkt: "BD",
		rm: "CH",
		rmf: "FI",
		rmo: "CH",
		rmt: "IR",
		rmu: "SE",
		rn: "BI",
		rng: "MZ",
		ro: "RO",
		rob: "ID",
		rof: "TZ",
		rtm: "FJ",
		ru: "RU",
		rue: "UA",
		rug: "SB",
		rw: "RW",
		rwk: "TZ",
		ryu: "JP",
		sa: "IN",
		saf: "GH",
		sah: "RU",
		saq: "KE",
		sas: "ID",
		sat: "IN",
		sav: "SN",
		saz: "IN",
		sbp: "TZ",
		sc: "IT",
		sck: "IN",
		scn: "IT",
		sco: "GB",
		scs: "CA",
		sd: "PK",
		"sd-Deva": "IN",
		"sd-Khoj": "IN",
		"sd-Sind": "IN",
		sdc: "IT",
		sdh: "IR",
		se: "NO",
		sef: "CI",
		seh: "MZ",
		sei: "MX",
		ses: "ML",
		sg: "CF",
		sga: "IE",
		sgs: "LT",
		shi: "MA",
		shn: "MM",
		si: "LK",
		sid: "ET",
		sk: "SK",
		skr: "PK",
		sl: "SI",
		sli: "PL",
		sly: "ID",
		sm: "WS",
		sma: "SE",
		smj: "SE",
		smn: "FI",
		smp: "IL",
		sms: "FI",
		sn: "ZW",
		snk: "ML",
		so: "SO",
		sou: "TH",
		sq: "AL",
		sr: "RS",
		srb: "IN",
		srn: "SR",
		srr: "SN",
		srx: "IN",
		ss: "ZA",
		ssy: "ER",
		st: "ZA",
		stq: "DE",
		su: "ID",
		suk: "TZ",
		sus: "GN",
		sv: "SE",
		sw: "TZ",
		swb: "YT",
		swc: "CD",
		swg: "DE",
		swv: "IN",
		sxn: "ID",
		syl: "BD",
		syr: "IQ",
		szl: "PL",
		ta: "IN",
		taj: "NP",
		tbw: "PH",
		tcy: "IN",
		tdd: "CN",
		tdg: "NP",
		tdh: "NP",
		te: "IN",
		tem: "SL",
		teo: "UG",
		tet: "TL",
		tg: "TJ",
		"tg-Arab": "PK",
		th: "TH",
		thl: "NP",
		thq: "NP",
		thr: "NP",
		ti: "ET",
		tig: "ER",
		tiv: "NG",
		tk: "TM",
		tkl: "TK",
		tkr: "AZ",
		tkt: "NP",
		tl: "PH",
		tly: "AZ",
		tmh: "NE",
		tn: "ZA",
		to: "TO",
		tog: "MW",
		tpi: "PG",
		tr: "TR",
		tru: "TR",
		trv: "TW",
		ts: "ZA",
		tsd: "GR",
		tsf: "NP",
		tsg: "PH",
		tsj: "BT",
		tt: "RU",
		ttj: "UG",
		tts: "TH",
		ttt: "AZ",
		tum: "MW",
		tvl: "TV",
		twq: "NE",
		txg: "CN",
		ty: "PF",
		tyv: "RU",
		tzm: "MA",
		udm: "RU",
		ug: "CN",
		"ug-Cyrl": "KZ",
		uga: "SY",
		uk: "UA",
		uli: "FM",
		umb: "AO",
		und: "US",
		unr: "IN",
		"unr-Deva": "NP",
		unx: "IN",
		ur: "PK",
		uz: "UZ",
		"uz-Arab": "AF",
		vai: "LR",
		ve: "ZA",
		vec: "IT",
		vep: "RU",
		vi: "VN",
		vic: "SX",
		vls: "BE",
		vmf: "DE",
		vmw: "MZ",
		vot: "RU",
		vro: "EE",
		vun: "TZ",
		wa: "BE",
		wae: "CH",
		wal: "ET",
		war: "PH",
		wbp: "AU",
		wbq: "IN",
		wbr: "IN",
		wls: "WF",
		wni: "KM",
		wo: "SN",
		wtm: "IN",
		wuu: "CN",
		xav: "BR",
		xcr: "TR",
		xh: "ZA",
		xlc: "TR",
		xld: "TR",
		xmf: "GE",
		xmn: "CN",
		xmr: "SD",
		xna: "SA",
		xnr: "IN",
		xog: "UG",
		xpr: "IR",
		xsa: "YE",
		xsr: "NP",
		yao: "MZ",
		yap: "FM",
		yav: "CM",
		ybb: "CM",
		yo: "NG",
		yrl: "BR",
		yua: "MX",
		yue: "HK",
		"yue-Hans": "CN",
		za: "CN",
		zag: "SD",
		zdj: "KM",
		zea: "NL",
		zgh: "MA",
		zh: "CN",
		"zh-Bopo": "TW",
		"zh-Hanb": "TW",
		"zh-Hant": "TW",
		zlm: "TG",
		zmi: "MY",
		zu: "ZA",
		zza: "TR",
	};

	function getLanguageFlagEmoji(locale) {

		if (locale === "emoji") {
			return "🏳️‍🌈";
		} else if (locale === "eo") {
			// return "🏴🟩";
			return "🟩";
			// return `<svg viewBox="0 0 600 400" height="20">
			// 	<path fill="#FFF" d="m0,0h202v202H0"/>
			// 	<path fill="#090" d="m0,200H200V0H600V400H0m58-243 41-126 41,126-107-78h133"/>
			// </svg>`;
		}

		let split = locale.toUpperCase().split(/-|_/);
		let lang = split.shift();
		let code = split.pop();

		if (!/^[A-Z]{2}$/.test(code)) {
			code = languageToDefaultRegion[lang.toLowerCase()];
		}

		if (!code) {
			return "";
		}

		const a = String.fromCodePoint(code.codePointAt(0) - 0x41 + 0x1F1E6);
		const b = String.fromCodePoint(code.codePointAt(1) - 0x41 + 0x1F1E6);
		return a + b;
	}

	let uiContainer = div || document.createElement("div");
	uiContainer.classList.add("vision-ui");
	uiContainer.classList.toggle("vision-rtl", isRTL);
	uiContainer.dir = isRTL ? "rtl" : "ltr";
	uiContainer.innerHTML = `
		<div class="vision-main-layout">
			<div class="vision-viewport-column">
				<div class="vision-camera-area">
					<div class="vision-canvas-container">
						<div class="vision-canvas-overlay">
							<button class="vision-use-camera-button">${t("ui.camera.allowAccess", { defaultValue: "Allow Camera Access" })}</button>
							<button class="vision-use-demo-footage-button" hidden>${t("ui.camera.useDemoFootage", { defaultValue: "Use demo footage" })}</button>
							<div class="vision-error-message" role="alert" hidden></div>
						</div>
						<canvas class="vision-canvas"></canvas>
					</div>
				</div>
				<div class="vision-action-bar">
					<button class="vision-start-stop-button" aria-pressed="false" aria-keyshortcuts="F9">${t("ui.startStopButton.start", { defaultValue: "Start Tracking" })}</button>
				</div>
			</div>
			<div class="vision-sidebar-column">
				<div class="vision-action-word-card">
					<div class="vision-card-header">
						<span class="vision-card-title">Facial Action Word</span>
						<span class="vision-live-badge">REAL-TIME</span>
					</div>
					<div class="vision-action-word-display" id="action-word-container">
						<div class="vision-action-word-value" id="active-action-word">NEUTRAL / IDLE</div>
						<div class="vision-action-word-sub" id="active-action-desc">STATUS: READY</div>
					</div>
				</div>

				<div class="vision-telemetry-card">
					<div class="vision-card-header">
						<span class="vision-card-title">System Telemetry</span>
						<span class="vision-telemetry-status" id="telemetry-status">STANDBY</span>
					</div>
					<div class="vision-telemetry-grid">
						<div class="vision-telemetry-item">
							<span class="telemetry-label">FPS</span>
							<span class="telemetry-value" id="telemetry-fps">0.0</span>
						</div>
						<div class="vision-telemetry-item">
							<span class="telemetry-label">FLOW POINTS</span>
							<span class="telemetry-value" id="telemetry-points">0 PTS</span>
						</div>
						<div class="vision-telemetry-item">
							<span class="telemetry-label">HEAD POSE</span>
							<span class="telemetry-value" id="telemetry-pose">Y: 0° P: 0°</span>
						</div>
						<div class="vision-telemetry-item">
							<span class="telemetry-label">CLICK MODE</span>
							<span class="telemetry-value" id="telemetry-mode">Wink</span>
						</div>
					</div>
				</div>

				<div class="vision-controls-wrapper">
					<div class="vision-card-header">
						<span class="vision-card-title">Configuration & Profiles</span>
						<button type="button" class="vision-open-guide-btn" id="open-guide-btn" title="View Interaction Profiles & Controls Guide">
							<span class="guide-btn-symbol">⚡</span> Profiles Guide
						</button>
					</div>
					<div class="vision-controls"></div>
				</div>
			</div>
		</div>

		<!-- Interaction Profiles & Controls Guide Modal Popup -->
		<div class="vision-modal-backdrop" id="guide-modal-backdrop" hidden>
			<div class="vision-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-modal-title">
				<div class="vision-modal-header">
					<div class="modal-header-title-group">
						<span class="modal-header-symbol">⚡</span>
						<h2 class="vision-modal-title" id="guide-modal-title">Interaction Profiles & Controls Guide</h2>
					</div>
					<button type="button" class="vision-modal-close-btn" id="close-guide-btn" aria-label="Close Guide">✕</button>
				</div>
				<div class="vision-modal-body">
					<div class="guide-profiles-grid">
						<div class="guide-profile-card">
							<div class="profile-card-header">
								<span class="profile-badge">PROFILE 1</span>
								<h3 class="profile-title">Wink Control</h3>
							</div>
							<p class="profile-summary">Fast ocular mouse clicks with dual-eye independence:</p>
							<div class="profile-rules">
								<div class="profile-rule-row">
									<span class="rule-tag">[L]</span>
									<span class="rule-text"><strong>Left Click / Drag:</strong> Close Left Eye (Right Eye open).</span>
								</div>
								<div class="profile-rule-row">
									<span class="rule-tag">[R]</span>
									<span class="rule-text"><strong>Right Click:</strong> Close Right Eye (Left Eye open).</span>
								</div>
								<div class="profile-rule-row">
									<span class="rule-tag">[↕]</span>
									<span class="rule-text"><strong>Scroll Wheel:</strong> Open mouth and tilt head up/down to scroll!</span>
								</div>
							</div>
						</div>

						<div class="guide-profile-card">
							<div class="profile-card-header">
								<span class="profile-badge">PROFILE 2</span>
								<h3 class="profile-title">Mouth Action & Scroll</h3>
							</div>
							<p class="profile-summary">Streamlined clicking and head-tilt scrolling:</p>
							<div class="profile-rules">
								<div class="profile-rule-row">
									<span class="rule-tag">[O]</span>
									<span class="rule-text"><strong>Primary Click & Drag:</strong> Drop jaw with head level.</span>
								</div>
								<div class="profile-rule-row">
									<span class="rule-tag">[↕]</span>
									<span class="rule-text"><strong>Scroll Up / Down:</strong> Open mouth and tilt/move head up or down.</span>
								</div>
								<div class="profile-rule-row">
									<span class="rule-tag">[✕]</span>
									<span class="rule-text"><strong>Stop / Release:</strong> Close mouth.</span>
								</div>
							</div>
						</div>

						<div class="guide-profile-card">
							<div class="profile-card-header">
								<span class="profile-badge">PROFILE 3</span>
								<h3 class="profile-title">Advanced Hybrid Mouth (3-Button)</h3>
							</div>
							<p class="profile-summary">Three-button mouse control with optional eye modifier combos:</p>
							<div class="profile-rules">
								<div class="profile-rule-row">
									<span class="rule-tag">[L]</span>
									<span class="rule-text">Open mouth with both eyes open = Left Click.</span>
								</div>
								<div class="profile-rule-row">
									<span class="rule-tag">[R]</span>
									<span class="rule-text">Open mouth + wink Left Eye = Right Click.</span>
								</div>
								<div class="profile-rule-row">
									<span class="rule-tag">[M]</span>
									<span class="rule-text">Open mouth + wink Right Eye = Middle Click (Autoscroll).</span>
								</div>
							</div>
						</div>

						<div class="guide-profile-card">
							<div class="profile-card-header">
								<span class="profile-badge">PROFILE 4</span>
								<h3 class="profile-title">Dwell Click</h3>
							</div>
							<p class="profile-summary">Hands-free automated hovering clicker:</p>
							<div class="profile-rules">
								<div class="profile-rule-row">
									<span class="rule-tag">[⏱]</span>
									<span class="rule-text">Hold cursor stationary on target to trigger click.</span>
								</div>
								<div class="profile-rule-row">
									<span class="rule-tag">[~]</span>
									<span class="rule-text">Keep moving head to reposition without clicking.</span>
								</div>
							</div>
						</div>
					</div>

					<div class="guide-modal-special-gestures">
						<div class="special-gesture-banner highlight-keyboard">
							<div class="banner-badge">3 SECONDS</div>
							<div class="banner-content">
								<h4>⚡ Raise Eyebrows / Elevate Forehead</h4>
								<p>Raise both eyebrows continuously for 3 seconds to launch the built-in Windows On-Screen Keyboard.</p>
							</div>
						</div>
						<div class="special-gesture-banner">
							<div class="banner-badge">2 SECONDS</div>
							<div class="banner-content">
								<h4>⚡ Close Both Eyes (Sleep / Standby)</h4>
								<p>Hold both eyes shut for 2 seconds to toggle mouse control on or standby.</p>
							</div>
						</div>
					</div>
				</div>
				<div class="vision-modal-footer">
					<button type="button" class="vision-modal-btn-close" id="footer-close-guide-btn">Close Guide</button>
				</div>
			</div>
		</div>

		<p class="vision-desktop-app-download-message" hidden>
			${t("ui.desktopAppPromo.message", { defaultValue: 'VISION' })}
		</p>
	`;
	if (!div) {
		document.body.appendChild(uiContainer);
	}
	let startStopButton = uiContainer.querySelector(".vision-start-stop-button");
	let useCameraButton = uiContainer.querySelector(".vision-use-camera-button");
	let useDemoFootageButton = uiContainer.querySelector(".vision-use-demo-footage-button");
	let errorMessage = uiContainer.querySelector(".vision-error-message");
	let canvasContainer = uiContainer.querySelector('.vision-canvas-container');
	let desktopAppDownloadMessage = uiContainer.querySelector('.vision-desktop-app-download-message');
	let activeActionWordEl = uiContainer.querySelector("#active-action-word");
	let activeActionDescEl = uiContainer.querySelector("#active-action-desc");
	let actionWordContainerEl = uiContainer.querySelector("#action-word-container");
	let telemetryFpsEl = uiContainer.querySelector("#telemetry-fps");
	let telemetryPointsEl = uiContainer.querySelector("#telemetry-points");
	let telemetryPoseEl = uiContainer.querySelector("#telemetry-pose");
	let telemetryModeEl = uiContainer.querySelector("#telemetry-mode");
	let telemetryStatusEl = uiContainer.querySelector("#telemetry-status");

	const guideModalBackdrop = uiContainer.querySelector("#guide-modal-backdrop");
	const openGuideBtn = uiContainer.querySelector("#open-guide-btn");
	const closeGuideBtn = uiContainer.querySelector("#close-guide-btn");
	const footerCloseGuideBtn = uiContainer.querySelector("#footer-close-guide-btn");

	const openModal = () => {
		if (guideModalBackdrop) guideModalBackdrop.hidden = false;
	};
	const closeModal = () => {
		if (guideModalBackdrop) guideModalBackdrop.hidden = true;
	};

	openGuideBtn?.addEventListener("click", openModal);
	closeGuideBtn?.addEventListener("click", closeModal);
	footerCloseGuideBtn?.addEventListener("click", closeModal);
	guideModalBackdrop?.addEventListener("click", (e) => {
		if (e.target === guideModalBackdrop) {
			closeModal();
		}
	});
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && guideModalBackdrop && !guideModalBackdrop.hidden) {
			closeModal();
		}
	});

	let lastShownErrorDetails = null;
	function showError(message, error, { warningIcon = true, errorClass = "other" } = {}) {
		const alreadyShown = !errorMessage.hidden && lastShownErrorDetails?.message === message && lastShownErrorDetails?.error?.name === error?.name && lastShownErrorDetails?.error?.message === error?.message;
		if (alreadyShown) {
			// Play CSS animation to indicate repeated errors
			// but not if they're occurring constantly
			// Note: for constant errors, with this scheme, it may animate
			// when returning to the tab due to timer throttling, or due to lag.
			if (performance.now() > lastShownErrorDetails.time + 100) {
				errorMessage.style.animation = "none";
				if (alreadyShown) {
					void errorMessage.offsetWidth; // trigger reflow to allow restarting animation
					errorMessage.style.animation = "";
				}
			}
		} else {
			if (warningIcon) {
				errorMessage.textContent = `${t("common.warningIcon", { defaultValue: "⚠️" })} ${message}`;
			} else {
				errorMessage.textContent = message;
			}
			if (error) {
				const pre = document.createElement("pre");
				pre.textContent = error.name + ": " + error.message;
				errorMessage.appendChild(pre);
			}
			errorMessage.hidden = false;
		}
		lastShownErrorDetails = { message, error, time: performance.now(), errorClass };
		emitEngine("error", { message, errorClass, name: error?.name ?? null, detail: error?.message ?? null });
	}

	function showToast(message) {
		emitEngine("toast", { message });
		if (headless) {
			return;
		}
		const toast = document.createElement("div");
		toast.className = "vision-toast";
		toast.textContent = message;
		document.body.appendChild(toast);
		setTimeout(() => {
			toast.remove();
		}, 5000);
	}

	Vision.openOnScreenKeyboard = async function () {
		console.log("Opening Built-in On-Screen Keyboard via Vision");
		if (activeActionWordEl && activeActionDescEl) {
			activeActionWordEl.textContent = "KEYBOARD OPENED";
			activeActionDescEl.textContent = "ON-SCREEN KEYBOARD LAUNCHED";
			actionWordContainerEl?.classList.add("action-triggered");
		}
		try {
			if (playSound) {
				playSound("middleClickPress", { volume: 3, playbackRate: 1.5 });
			}
		} catch (_e) {
			// Non-critical audio notification error
		}

		showToast("⌨️ Built-in On-Screen Keyboard Opened");

		if (window.electronAPI?.openOnScreenKeyboard) {
			try {
				const res = await window.electronAPI.openOnScreenKeyboard();
				if (res?.error) {
					console.warn("electronAPI.openOnScreenKeyboard error:", res.error);
				}
			} catch (err) {
				console.error("Failed to call electronAPI.openOnScreenKeyboard:", err);
			}
		}
	};

	// Settings (initialized later; defaults are defined in settingsCategories)
	const s = {};

	// Abstract model of settings UI.
	// Note: min, max, and default are in INPUT value units, not setting value units.
	// TODO: make min/max/default be in setting value units, and automatically define
	// input unit scale to avoid rounding to 0 or 1 for fractions (for example) - or use step?
	const settingsCategories = [
		{
			type: "group",
			label: t("settings.sections.cursorMovement.label", { defaultValue: "Cursor Movement" }),
			settings: [
				{
					label: t("settings.tiltInfluence.label", { defaultValue: "Tilt influence" }),
					className: "vision-tilt-influence",
					key: "headTrackingTiltInfluence",
					settingValueToInputValue: (settingValue) => settingValue * 100,
					inputValueToSettingValue: (inputValue) => inputValue / 100,
					type: "slider",
					min: 0,
					max: 100,
					default: 0,
					labels: {
						min: t("settings.tiltInfluence.sliderMin", { defaultValue: "Point tracking (2D)" }),
						max: t("settings.tiltInfluence.sliderMax", { defaultValue: "Head tilt (3D)" }),
					},
					description: t("settings.tiltInfluence.description", {
						defaultValue: `Blends between using point tracking (2D) and detected head tilt (3D).
- At 0% it will use only point tracking. This moves the cursor according to visible movement of 2D points on your face within the camera's view, so it responds to both head rotation and translation.
- At 100% it will use only head tilt. This uses an estimate of your face's orientation in 3D space, and ignores head translation. Note that this is smoothed, so it's not as responsive as point tracking. In this mode you never need to recenter by pushing the cursor to the edge of the screen.
- In between it will behave like an automatic calibration, subtly adjusting the point tracking to match the head tilt. This works by slowing down mouse movement that is moving away from the position that would be expected based on the head tilt, and (only past 80% on the slider) actively moving towards it.` }),
				},
				{
					label: t("settings.motionThreshold.label", { defaultValue: "Motion threshold" }),
					className: "vision-min-distance",
					key: "headTrackingMinDistance",
					type: "slider",
					min: 0,
					max: 10,
					default: 0,
					labels: {
						min: t("settings.motionThreshold.sliderMin", { defaultValue: "Free" }),
						max: t("settings.motionThreshold.sliderMax", { defaultValue: "Steady" }),
					},
					description: t("settings.motionThreshold.description", { defaultValue: "Minimum distance to move the cursor in one frame, in pixels. Helps to fully stop the cursor." }),
				},
				{
					type: "group",
					label: t("settings.sections.pointTracking.label", { defaultValue: "Point tracking" }),
					disabled: () => s.headTrackingTiltInfluence === 1,
					settings: [
						{
							label: t("settings.pointTracking.horizontalSensitivity.label", { defaultValue: "Horizontal sensitivity" }),
							className: "vision-sensitivity-x",
							key: "headTrackingSensitivityX",
							settingValueToInputValue: (settingValue) => settingValue * 1000,
							inputValueToSettingValue: (inputValue) => inputValue / 1000,
							type: "slider",
							min: 0,
							max: 100,
							default: 25,
							labels: {
								min: t("settings.shared.sliderMinSlow", { defaultValue: "Slow" }),
								max: t("settings.shared.sliderMaxFast", { defaultValue: "Fast" }),
							},
							description: t("settings.pointTracking.horizontalSensitivity.description", { defaultValue: "Speed of cursor movement in response to horizontal head movement." }),
						},
						{
							label: t("settings.pointTracking.verticalSensitivity.label", { defaultValue: "Vertical sensitivity" }),
							className: "vision-sensitivity-y",
							key: "headTrackingSensitivityY",
							settingValueToInputValue: (settingValue) => settingValue * 1000,
							inputValueToSettingValue: (inputValue) => inputValue / 1000,
							type: "slider",
							min: 0,
							max: 100,
							default: 50,
							labels: {
								min: t("settings.shared.sliderMinSlow", { defaultValue: "Slow" }),
								max: t("settings.shared.sliderMaxFast", { defaultValue: "Fast" }),
							},
							description: t("settings.pointTracking.verticalSensitivity.description", { defaultValue: "Speed of cursor movement in response to vertical head movement." }),
						},

						// TODO:
						// - eyeTrackingSensitivityX
						// - eyeTrackingSensitivityY
						// - eyeTrackingAcceleration

						// TODO: "Linear" could be described as "Fast", and the other "Fast" labels are on the other side.
						// Should it be swapped? What does other software with acceleration control look like?
						// In Windows it's just a checkbox apparently, but it could go as far as a custom curve editor.
						{
							label: t("settings.pointTracking.acceleration.label", { defaultValue: "Acceleration" }),
							className: "vision-acceleration",
							key: "headTrackingAcceleration",
							settingValueToInputValue: (settingValue) => settingValue * 100,
							inputValueToSettingValue: (inputValue) => inputValue / 100,
							type: "slider",
							min: 0,
							max: 100,
							default: 50,
							labels: {
								min: t("settings.shared.sliderMinLinear", { defaultValue: "Linear" }), // or "Direct", "Raw"
								max: t("settings.shared.sliderMaxSmooth", { defaultValue: "Smooth" }),
							},
							description: t("settings.pointTracking.acceleration.description", {
								defaultValue: `Makes the cursor move relatively fast for quick head movements, and relatively slow for slow head movements.
Helps to stabilize the cursor. However, when using point tracking in combination with head tilt, a lower value may work better since head tilt is linear, and you want the point tracking to roughly match the head tracking for it to act as a seamless auto-calibration.` }),
						},
					],
				},
				{
					type: "group",
					label: t("settings.sections.headTiltCalibration.label", { defaultValue: "Head tilt calibration" }),
					disabled: () => s.headTrackingTiltInfluence === 0,
					settings: [
						{
							label: t("settings.headTilt.horizontalRange.label", { defaultValue: "Horizontal tilt range" }),
							className: "vision-head-tilt-yaw-range",
							key: "headTiltYawRange",
							settingValueToInputValue: (settingValue) => settingValue * 180 / Math.PI,
							inputValueToSettingValue: (inputValue) => inputValue * Math.PI / 180,
							type: "slider",
							min: 10,
							max: 90,
							default: 60,
							labels: {
								min: t("settings.headTilt.range.sliderMinLittleNeckMovement", { defaultValue: "Little neck movement" }),
								max: t("settings.headTilt.range.sliderMaxLargeNeckMovement", { defaultValue: "Large neck movement" }),
							},
							description: t("settings.headTilt.horizontalRange.description", { defaultValue: "Controls how much you need to tilt your head left or right to reach the edge of the screen." }),
						},
						{
							label: t("settings.headTilt.verticalRange.label", { defaultValue: "Vertical tilt range" }),
							className: "vision-head-tilt-pitch-range",
							key: "headTiltPitchRange",
							settingValueToInputValue: (settingValue) => settingValue * 180 / Math.PI,
							inputValueToSettingValue: (inputValue) => inputValue * Math.PI / 180,
							type: "slider",
							min: 10,
							max: 60,
							default: 25,
							labels: {
								min: t("settings.headTilt.range.sliderMinLittleNeckMovement", { defaultValue: "Little neck movement" }),
								max: t("settings.headTilt.range.sliderMaxLargeNeckMovement", { defaultValue: "Large neck movement" }),
							},
							description: t("settings.headTilt.verticalRange.description", { defaultValue: "Controls how much you need to tilt your head up or down to reach the edge of the screen." }),
						},
						{
							// label: "Horizontal tilt offset",
							label: t("settings.headTilt.horizontalOffset.label", { defaultValue: "Horizontal cursor offset" }),
							className: "vision-head-tilt-yaw-offset",
							key: "headTiltYawOffset",
							settingValueToInputValue: (settingValue) => settingValue * 180 / Math.PI,
							inputValueToSettingValue: (inputValue) => inputValue * Math.PI / 180,
							type: "slider",
							min: -45,
							max: 45,
							default: 0,
							labels: {
								min: t("settings.shared.directionLeft", { defaultValue: "Left" }),
								max: t("settings.shared.directionRight", { defaultValue: "Right" }),
							},
							// TODO: how to describe this??
							// Specifically, how to disambiguate which direction is which / which way to adjust it?
							// And shouldn't the option behave opposite? I think we have pitch yaw and roll all reversed from standard aviation definitions.
							// Since it's opposite, even though it's technically yaw (angle units), it's easier to think of as moving the cursor.
							// Hence I've renamed the setting.
							// TODO: should this say "horizontal" in the (main part of the) description?
							description: t("settings.headTilt.horizontalOffset.description", {
								defaultValue: `Adjusts the position of the cursor when the camera sees the head facing straight ahead.
⚠️ This horizontal offset is not recommended. Move the camera instead if possible. 📷` }),
						},
						{
							// label: "Vertical tilt offset",
							label: t("settings.headTilt.verticalOffset.label", { defaultValue: "Vertical cursor offset" }),
							className: "vision-head-tilt-pitch-offset",
							key: "headTiltPitchOffset",
							settingValueToInputValue: (settingValue) => settingValue * 180 / Math.PI,
							inputValueToSettingValue: (inputValue) => inputValue * Math.PI / 180,
							type: "slider",
							min: -30,
							max: 30,
							default: 2.5,
							labels: {
								min: t("settings.shared.directionDown", { defaultValue: "Down" }),
								max: t("settings.shared.directionUp", { defaultValue: "Up" }),
							},
							description: t("settings.headTilt.verticalOffset.description", { defaultValue: "Adjusts the position of the cursor when the camera sees the head facing straight ahead." }),
						},
					],
				},
			],
		},

		// Only dwell clicking is supported by the web library right now.
		// Currently it's a separate API (Vision.initDwellClicking)
		// TODO: bring more of desktop app functionality into core
		// https://github.com/1j01/vision/issues/72

		// Also, the "Swap mouse buttons" setting is likely not useful for
		// web apps embedding VISION and designed for head trackers,
		// since it necessitates mode switching for dwell clicker usage,
		// so it may make sense to hide (or not) even if it is supported there in the future.
		// The main point of this option is to counteract the system-level mouse button setting,
		// which awkwardly affects what mouse button serenade-driver sends; this doesn't affect the web version.
		{
			type: "group",
			label: t("settings.sections.clicking.label", { defaultValue: "Clicking" }),
			settings: [
				{
					label: t("settings.clickingMode.label", { defaultValue: "Interaction Profile:" }),
					className: "vision-clicking-mode",
					key: "clickingMode",
					type: "dropdown",
					options: [
						{ value: "blink", label: t("settings.clickingMode.wink.label", { defaultValue: "Profile: Wink Control (Left / Right Wink & Scroll)" }), description: t("settings.clickingMode.wink.description", { defaultValue: "Close Left Eye for Left Click. Close Right Eye for Right Click / Context Menu. Tilt head while winking to scroll." }) },
						{ value: "open-mouth-simple", label: t("settings.clickingMode.openMouthSimple.label", { defaultValue: "Profile: Mouth Action (Natural Jaw Drop)" }), description: t("settings.clickingMode.openMouthSimple.description", { defaultValue: "Open mouth in a tall 'O' shape / drop jaw to Left Click & Drag. Close mouth to release. No eye winking required." }) },
						{ value: "open-mouth", label: t("settings.clickingMode.openMouthWithEyeModifiers.label", { defaultValue: "Profile: Advanced Hybrid Mouth (3-Button)" }), description: t("settings.clickingMode.openMouthWithEyeModifiers.description", { defaultValue: "Three-button mouse control: Open mouth with both eyes open = Left Click; Open mouth with Left Eye winked = Right Click; Open mouth with Right Eye winked = Middle Click (Autoscroll)." }) },
						{ value: "dwell", label: t("settings.clickingMode.dwell.label", { defaultValue: "Profile: Dwell Click (Hands-Free Timer)" }), description: t("settings.clickingMode.dwell.description", { defaultValue: "Hold the cursor stationary over a target for a moment to trigger a click automatically." }) },
						{ value: "open-mouth-ignoring-eyes", label: t("settings.clickingMode.openMouthIgnoringEyes.label", { defaultValue: "Profile: Sustained Mouth Hold (Continuous Drag)" }), description: t("settings.clickingMode.openMouthIgnoringEyes.description", { defaultValue: "Open mouth to press and hold mouse down continuously. Eye state is completely ignored." }) },
						{ value: "off", label: t("settings.clickingMode.off.label", { defaultValue: "Profile: Pure Motion Tracking (External Switch)" }), description: t("settings.clickingMode.off.description", { defaultValue: "Track mouse movement without automated gesture clicks. For use with physical accessibility switches or third-party software." }) },
					],
					default: "blink",
					visible: () => isDesktopApp || clickingModeSupported,
					description: t("settings.clickingMode.description", { defaultValue: "Choose an interaction profile tailored to your preferred facial gestures." }),
				},
				{
					// on Windows, currently, when buttons are swapped at the system level, it affects serenade-driver's click()
					// "swap" is purposefully generic language so we don't have to know what system-level setting is
					// (also this may be seen as a weirdly named/designed option for right-clicking with the dwell clicker)
					label: t("settings.swapMouseButtons.label", { defaultValue: "Swap mouse buttons" }),
					className: "vision-swap-mouse-buttons",
					key: "swapMouseButtons",
					type: "checkbox",
					default: false,
					visible: () => isDesktopApp,
					description: t("settings.swapMouseButtons.description", {
						defaultValue: `Switches the left and right mouse buttons.
Useful if your system's mouse buttons are swapped.
Could also be used to right click with the dwell clicker in a pinch.` }),
				},

				// This setting could called "click stabilization", "drag delay", "delay before dragging", "click drag delay", "drag prevention", etc.
				// with slider labels "Easy to click -> Easy to drag" or "Easier to click -> Easier to drag" or "Short -> Long"
				// This could generalize into "never allow dragging" at the extreme, if it's special cased to jump to infinity
				// at the end of the slider, although you shouldn't need to do that to effectively avoid dragging when trying to click,
				// and it might complicate the design of the slider labeling.
				{
					label: t("settings.delayBeforeDragging.label", { defaultValue: "Delay before dragging" }),
					className: "vision-delay-before-dragging",
					key: "delayBeforeDragging",
					type: "slider",
					min: 0,
					max: 1000,
					labels: {
						min: t("settings.delayBeforeDragging.sliderMin", { defaultValue: "Easy to drag" }),
						max: t("settings.delayBeforeDragging.sliderMax", { defaultValue: "Easy to click" }),
					},
					default: 800,
					visible: () => isDesktopApp || clickingModeSupported,
					disabled: () => s.clickingMode === "off" || s.clickingMode === "dwell",
					// Throwing a // in here so it's not detected by i18next-cli, whereas the others are allowed
					// simply because it wasn't previously detected and translated
					// due to being both commented out and multiline (though multiline and commented out t() calls are separately supported)
					// description: t//("settings.delayBeforeDragging.description.alt2", { defaultValue: `Prevents mouse movement for the specified time after a click starts.
					// You may want to turn this off if you're drawing on a canvas, or increase it if you find yourself accidentally dragging when you try to click.` }),
					description: t("settings.delayBeforeDragging.description", {
						defaultValue: `Locks mouse movement for the given duration during the start of a click.
You may want to turn this off if you're drawing on a canvas, or increase it if you find yourself accidentally dragging when you try to click.` }),
				},
				{
					label: t("settings.dwellTime.label", { defaultValue: "Dwell time" }),
					className: "vision-dwell-time",
					key: "dwellTime",
					type: "slider",
					min: 600,
					max: 1500,
					default: 800,
					labels: {
						min: t("settings.dwellTime.sliderMin", { defaultValue: "Quick" }),
						max: t("settings.dwellTime.sliderMax", { defaultValue: "Relaxed" }),
					},
					description: t("settings.dwellTime.description", { defaultValue: "How long to hold the cursor still on a target before a dwell click, in milliseconds." }),
				},
				{
					label: t("settings.dwellDrag.label", { defaultValue: "Dwell drag" }),
					className: "vision-dwell-drag",
					key: "dwellDrag",
					type: "checkbox",
					default: false,
					visible: () => isDesktopApp,
					description: t("settings.dwellDrag.description", { defaultValue: "With Dwell Click, the first dwell grabs (presses the mouse button) and the next dwell drops (releases it)." }),
				},
				{
					label: t("settings.mouthTiltScroll.label", { defaultValue: "Open mouth and tilt head to scroll" }),
					className: "vision-mouth-tilt-scroll",
					key: "mouthTiltScroll",
					type: "checkbox",
					default: true,
					visible: () => isDesktopApp || clickingModeSupported,
					description: t("settings.mouthTiltScroll.description", { defaultValue: "With your mouth open, tilt your head up or down to scroll." }),
				},
			],
		},
		{
			type: "group",
			label: t("settings.sections.video.label", { defaultValue: "Video" }),
			settings: [
				{
					label: t("settings.cameraSource.label", { defaultValue: "Camera source" }),
					className: "vision-camera-select",
					key: "cameraDeviceId",
					handleSettingChange: () => {
						Vision.useCamera();
					},
					type: "dropdown",
					options: [
						{ value: "", label: t("settings.cameraSource.defaultCamera", { defaultValue: "Default" }) },
					],
					default: "",
					description: t("settings.cameraSource.description", { defaultValue: "Selects which camera is used for head tracking." }),
				},
				// TODO: move this inline with the camera source dropdown?
				{
					label: t("settings.openCameraSettings.label", { defaultValue: "Open Camera Settings" }),
					className: "vision-open-camera-settings",
					key: "openCameraSettings",
					type: "button",
					visible: () => isDesktopApp,
					onClick: async () => {
						function showToast(message) {
							const toast = document.createElement("div");
							toast.className = "vision-toast";
							toast.textContent = message;
							document.body.appendChild(toast);
							setTimeout(() => {
								toast.remove();
							}, 5000);
						}

						let knownCameras = {};
						try {
							knownCameras = JSON.parse(localStorage.getItem("vision-known-cameras")) || {};
						} catch (error) {
							showToast(t("openCameraSettings.errors.sharedHeading", { defaultValue: "Failed to open camera settings:" }) + "\n" + t("openCameraSettings.errors.parseKnownCameras", { defaultValue: "Failed to parse known cameras from localStorage:" }) + "\n" + error.name + ": " + error.message);
							return;
						}

						const activeStream = cameraVideo.srcObject;
						const activeDeviceId = activeStream?.getVideoTracks()[0]?.getSettings()?.deviceId;
						const selectedDeviceName = knownCameras[activeDeviceId]?.name || t("settings.cameraSource.defaultCamera", { defaultValue: "Default" });

						try {
							const result = await window.electronAPI.openCameraSettings(selectedDeviceName);
							if (result?.error) {
								showToast(t("openCameraSettings.errors.sharedHeading", { defaultValue: "Failed to open camera settings:" }) + "\n" + result.error);
							}
						} catch (error) {
							showToast(t("openCameraSettings.errors.sharedHeading", { defaultValue: "Failed to open camera settings:" }) + "\n" + error.name + ": " + error.message);
						}
					},
					description: t("settings.openCameraSettings.description", { defaultValue: "Opens the Windows camera settings, to adjust properties like brightness and contrast." }),
				},
				// TODO: try moving this to the corner of the camera view, so it's clearer it applies only to the camera view
				{
					label: t("settings.mirror.label", { defaultValue: "Mirror" }),
					className: "vision-mirror",
					key: "mirror",
					type: "checkbox",
					default: true,
					description: t("settings.mirror.description", { defaultValue: "Mirrors the camera view horizontally." }),
				},
			]
		},
		{
			type: "group",
			label: t("settings.sections.general.label", { defaultValue: "General" }),
			settings: [
				{
					label: t("settings.soundEffects.label", { defaultValue: "Sound effects" }),
					className: "vision-sound-effects",
					key: "soundEffects",
					type: "checkbox",
					default: true,
					afterInitialLoad: () => {
						setAudioEnabled(s.soundEffects);
					},
					handleSettingChange: () => {
						setAudioEnabled(s.soundEffects);
					},
					description: t("settings.soundEffects.description", { defaultValue: "Plays sounds when you click." }),
				},
				// opposite, "Start paused", might be clearer, especially if I add a "pause" button
				{
					label: t("settings.startEnabled.label", { defaultValue: "Start enabled" }),
					className: "vision-start-enabled",
					key: "startEnabled",
					afterInitialLoad: () => { // TODO: does this hook make sense? right now it's the only usage. could this code not just be called later?
						paused = !s.startEnabled;
					},
					type: "checkbox",
					default: false,
					description: t("settings.startEnabled.description", { defaultValue: "If enabled, VISION will start controlling the cursor as soon as it's launched." }),
				},
				{
					// For "experimental" label:
					// - I'm preferring language that doesn't assume a new build is coming soon, fixing everything
					// - I considered adding "⚠️" but it feels a little too alarming
					// label: "Close eyes to start/stop (<span style=\"border-bottom: 1px dotted;\" title=\"Planned refinements include: visual and auditory feedback, improved detection accuracy, and separate settings for durations to toggle on and off.\">experimental</span>)",
					// label: "Close eyes to start/stop (<span style=\"border-bottom: 1px dotted;\" title=\"• Missing visual and auditory feedback.\n• Missing settings for duration(s) to toggle on and off.\n• Affected by false positive blink detections, especially when looking downward.\">Experimental</span>)",
					label: t("settings.closeEyesToToggle.label", { defaultValue: "Close eyes to start/stop" }),
					className: "vision-close-eyes-to-toggle",
					key: "closeEyesToToggle",
					type: "checkbox",
					default: false,
					description: t("settings.closeEyesToToggle.description", { defaultValue: "If enabled, you can start or stop mouse control by holding both your eyes shut for a few seconds." }),
				},
				{
					label: t("settings.eyebrowRaiseOpensKeyboard.label", { defaultValue: "Raise eyebrows to open keyboard" }),
					className: "vision-eyebrow-raise-keyboard",
					key: "eyebrowRaiseOpensKeyboard",
					type: "checkbox",
					default: true,
					description: t("settings.eyebrowRaiseOpensKeyboard.description", { defaultValue: "If enabled, raising both eyebrows (forehead) continuously for about 3 seconds will open the built-in on-screen keyboard." }),
				},
				{
					label: t("desktop.menu.openOnScreenKeyboard", { defaultValue: "On-Screen Keyboard" }),
					className: "vision-open-osk-button",
					key: "openOnScreenKeyboard",
					type: "button",
					visible: () => isDesktopApp,
					onClick: () => {
						Vision.openOnScreenKeyboard();
					},
					description: t("settings.eyebrowRaiseOpensKeyboard.description", { defaultValue: "Open the built-in On-Screen Keyboard." }),
				},
				{
					label: t("settings.runAtLogin.label", { defaultValue: "Run at login" }),
					className: "vision-run-at-login",
					key: "runAtLogin",
					type: "checkbox",
					default: false,
					visible: () => isDesktopApp,
					description: t("settings.runAtLogin.description", { defaultValue: "If enabled, VISION will automatically start when you log into your computer." }),
				},
				{
					label: t("settings.language.label", { defaultValue: "Language" }),
					className: "vision-language",
					key: "language",
					type: "dropdown",
					options: availableLanguages.map(lang => ({ value: lang, label: `${getLanguageFlagEmoji(lang)} ${languageNames[lang]?.[1]?.[0] || lang} (${languageNames[lang]?.[0]?.[0] || "?"})` })),
					default: locale,
					handleSettingChange: () => {
						// console.trace("handleSettingChange for language setting");
						// HACK: update localStorage because it's what's used to determine the language
						// This is needed for the desktop app which otherwise saves to a file not localStorage
						try {
							localStorage.setItem("vision-settings", JSON.stringify(serializeSettings()));
						} catch (error) {
							console.error("Error saving options to localStorage:", error);
							return;
						}
						reinit();
					},
					description: t("settings.language.description", { defaultValue: "Select the language for the VISION interface." }),
				},
			],
		},
		{
			// Not shown in the legacy UI. Persisted like other settings; used by the new UI and calibration.
			type: "group",
			label: "Profile data",
			settings: [
				...[
					["eyeThresholdHigh", VM.DEFAULT_THRESHOLDS.eye.high],
					["eyeThresholdLow", VM.DEFAULT_THRESHOLDS.eye.low],
					["mouthThresholdHigh", VM.DEFAULT_THRESHOLDS.mouth.high],
					["mouthThresholdLow", VM.DEFAULT_THRESHOLDS.mouth.low],
					["browThresholdHigh", VM.DEFAULT_THRESHOLDS.brow.high],
					["browThresholdLow", VM.DEFAULT_THRESHOLDS.brow.low],
				].map(([key, defaultValue]) => ({
					label: key,
					className: `vision-${key}`,
					key,
					type: "hidden",
					default: defaultValue,
					visible: () => false,
					description: "Gesture threshold (set by calibration).",
				})),
				{ label: "profiles", className: "vision-profiles", key: "profiles", type: "hidden", default: "[]", visible: () => false, description: "Saved profiles (JSON)." },
				{ label: "activeProfile", className: "vision-active-profile", key: "activeProfile", type: "hidden", default: "Default", visible: () => false, description: "Active profile name." },
				{ label: "onboardingComplete", className: "vision-onboarding-complete", key: "onboardingComplete", type: "hidden", default: false, visible: () => false, description: "First-run onboarding finished." },
				{ label: "uiTheme", className: "vision-ui-theme", key: "uiTheme", type: "hidden", default: "ember", visible: () => false, description: "UI theme: ember or paper." },
			],
		},
	];
	/** Setting definitions by key (for the engine settings API). */
	const settingsByKey = new Map();

	function traverseSettings(settings, callback, parentGroup = null) {
		for (const setting of settings) {
			callback(setting, parentGroup);
			if (setting.type === "group") {
				traverseSettings(setting.settings, callback, setting);
			}
		}
	}

	const elsByGroup = new Map();
	const functionsToUpdateDisabledStates = [];

	function buildSettingsUI(parentEl, settingsCategories) {

		for (const category of settingsCategories) {
			const detailsEl = buildSettingGroupUI(category);
			const bodyEl = detailsEl.querySelector(".vision-details-body");
			traverseSettings(category.settings, (setting, parentGroup) => {
				const parentGroupElement = (elsByGroup.get(parentGroup) ?? bodyEl);

				let el;
				if (setting.type === "group") {
					el = buildSettingGroupUI(setting);
				} else {
					el = buildSettingItemUI(setting);
				}
				parentGroupElement.appendChild(el);

				if (setting.disabled) {
					const updateDisabledState = () => {
						// TODO: supply a message for why it's disabled (can update `disabled()` to return a string or object)
						const disabled = setting.disabled?.() ?? setting.disabled === true;
						el.classList.toggle("vision-disabled", disabled);
						const controls = el.querySelectorAll(`input, select, button`);
						for (const control of controls) {
							// This should handle nested disabled conditions properly
							control.disabled = control.closest(".vision-disabled") !== null;
						}
					};
					functionsToUpdateDisabledStates.push(updateDisabledState);
					// Not useful to call updateDisabledState() here because dependent setting values aren't loaded yet
				}
			});

			parentEl.appendChild(detailsEl);

		}

	}

	function buildSettingGroupUI(group) {
		const detailsEl = document.createElement("details");
		// detailsEl.className = "vision-settings-group";
		// TODO: recursive check for visibility - or just define visible() on groups
		if (group.settings.every(setting => setting.visible?.() === false)) {
			detailsEl.hidden = true;
		}
		const summaryEl = document.createElement("summary");
		summaryEl.textContent = group.label;
		detailsEl.appendChild(summaryEl);
		const bodyEl = document.createElement("div");
		bodyEl.className = "vision-details-body";
		detailsEl.appendChild(bodyEl);
		elsByGroup.set(group, bodyEl);
		return detailsEl;
	}

	function buildSettingItemUI(setting) {

		// Validation
		for (const requiredProp of ["label", "className", "key", "type", "default"]) {
			if (setting[requiredProp] === undefined) {
				if (setting.type === "button" && requiredProp === "default") {
					continue; // buttons don't need a default value
				}
				console.warn(`Setting is missing ${requiredProp}:`, setting);
				return;
			}
		}
		for (const importantProp of ["description"]) {
			if (setting[importantProp] === undefined) {
				console.warn(`Setting is missing ${importantProp}:`, setting);
			}
		}

		// TODO: consider making everything use <label for=""> inside and <div> outside
		const rowEl = document.createElement(setting.type === "slider" ? "label" : "div");
		rowEl.className = "vision-control-row";
		if (setting.type === "slider") {
			rowEl.innerHTML = `
				<span class="vision-label-text">${setting.label}</span>
				<span class="vision-labeled-slider">
					<input type="range" min="${setting.min}" max="${setting.max}" class="${setting.className}">
					<span class="vision-slider-labels">
						<span class="vision-min-label">${setting.labels.min}</span>
						<span class="vision-max-label">${setting.labels.max}</span>
					</span>
				</span>
			`;
		} else if (setting.type === "checkbox") {
			// special interest: jspaint wants label not to use parent-child relationship so that os-gui's 98.css checkbox styles can work
			rowEl.innerHTML = `
				<input type="checkbox" id="${setting.className}" class="${setting.className}">
				<label for="${setting.className}"><span class="vision-label-text">${setting.label}</span></label>
			`;
		} else if (setting.type === "dropdown") {
			const optionsHtml = setting.options.map(option => `
				<option value="${option.value}">${option.label}</option>
			`.trim()).join("\n");
			rowEl.innerHTML = `
				<label for="${setting.className}"><span class="vision-label-text">${setting.label}</span></label>
				<select id="${setting.className}" class="${setting.className}">
					${optionsHtml}
				</select>
			`;
			if (setting.options.some(option => option.description)) {
				setting.description += "\n\n" + t("settings.dropdownDescriptionOptionsListHeading", { defaultValue: "Options:" }) + "\n" + setting.options.map(option => `• ${option.label}${option.description ? `: ${option.description}` : ''}`).join("\n");
			}
		} else if (setting.type === "button") {
			rowEl.innerHTML = `
				<button class="${setting.className}">${setting.label}</button>
			`;
		} else if (setting.type === "hidden") {
			rowEl.innerHTML = `<input type="hidden" class="${setting.className}">`;
		}
		if (setting.visible?.() === false) {
			rowEl.hidden = true;
		}

		if (setting.description) {
			// Tooltip; TODO: try an ℹ️ info icon button with a popover
			rowEl.setAttribute("title", setting.description);
		}

		const control = rowEl.querySelector(`.${setting.className}`);
		let hiddenValue;
		const getControlValue = () => {
			if (setting.type === "hidden") {
				return hiddenValue;
			}
			if (setting.type === "slider") {
				return Number(control.value);
			} else if (setting.type === "checkbox") {
				return control.checked;
			} else if (setting.type === "dropdown") {
				return control.value;
			}
		};
		const setControlValue = (value) => {
			if (setting.type === "hidden") {
				hiddenValue = value;
				return;
			}
			if (setting.type === "slider") {
				control.value = value;
			} else if (setting.type === "checkbox") {
				control.checked = value;
			} else if (setting.type === "dropdown") {
				control.value = value;
			}
		};

		const load = (settings, initialLoad) => {
			// Note: Don't use `... in settings.globalSettings` to check if a setting is defined.
			// We must ignore `undefined` values so that the defaults carry over from the renderer to the main process in the Electron app.
			if (settings.globalSettings?.[setting.key] !== undefined) {
				s[setting.key] = settings.globalSettings[setting.key];
				setControlValue((setting.settingValueToInputValue ?? ((x) => x))(s[setting.key]));
			}
			if (initialLoad) {
				setting.afterInitialLoad?.();
			}
		};
		const loadValueFromControl = () => {
			s[setting.key] = (setting.inputValueToSettingValue ?? ((x) => x))(getControlValue());
		};
		const save = () => {
			setOptions({ globalSettings: { [setting.key]: s[setting.key] } });
		};

		// Load defaults
		// currently defined in input value units
		setControlValue(setting.default);
		s[setting.key] = (setting.inputValueToSettingValue ?? ((x) => x))(getControlValue());
		// Not useful to call functionsToUpdateDisabledStates here because dependent setting values aren't necessarily loaded yet

		// Handle changes
		control.addEventListener("change", () => {
			loadValueFromControl();
			save();
			emitEngine("settings", { key: setting.key, value: s[setting.key] });
			// TODO: also call this if the setting is changed through CLI
			// Would be good to have a pattern where it's subscribing to changes to a settings store
			setting.handleSettingChange?.();

			for (const func of functionsToUpdateDisabledStates) {
				func();
			}
		});
		// Handle loading from stored settings
		setting._load = load;
		// Engine API: set a value programmatically (same path as a UI change).
		setting._set = (value) => {
			s[setting.key] = value;
			setControlValue((setting.settingValueToInputValue ?? ((x) => x))(value));
			save();
			setting.handleSettingChange?.();
			for (const func of functionsToUpdateDisabledStates) {
				func();
			}
			emitEngine("settings", { key: setting.key, value });
		};
		settingsByKey.set(setting.key, setting);

		if (setting.type === "button") {
			control.addEventListener("click", () => {
				setting.onClick?.();
			});
		}

		return rowEl;
	}

	buildSettingsUI(uiContainer.querySelector(".vision-controls"), settingsCategories);

	const runAtLoginCheckbox = uiContainer.querySelector(".vision-run-at-login");
	const swapMouseButtonsCheckbox = uiContainer.querySelector(".vision-swap-mouse-buttons");
	const swapMouseButtonsLabel = uiContainer.querySelector("label[for='vision-swap-mouse-buttons']");
	const cameraSelect = uiContainer.querySelector(".vision-camera-select");

	if (window.electronAPI) {
		// Hide the desktop app download message if we're in the desktop app
		// Might be good to also hide it, or change it, when on a mobile device
		desktopAppDownloadMessage.hidden = true;

		// Disable the "run at login" option if the app isn't packaged,
		// as it's not set up to work in development mode.
		window.electronAPI.getIsPackaged().then((isPackaged) => {
			runAtLoginCheckbox.disabled = !isPackaged;
		});
	}

	let canvas = uiContainer.querySelector(".vision-canvas");
	let ctx = canvas.getContext('2d', { willReadFrequently: true });

	let debugEyeCanvas = document.createElement("canvas");
	debugEyeCanvas.className = "vision-debug-eye-canvas";
	debugEyeCanvas.style.display = "none";
	uiContainer.querySelector(".vision-camera-area").appendChild(debugEyeCanvas);
	let debugEyeCtx = debugEyeCanvas.getContext('2d');

	let pointerEl = document.createElement('div');
	pointerEl.className = "vision-pointer";
	pointerEl.style.display = "none";
	document.body.appendChild(pointerEl);

	let cameraVideo = document.createElement('video');
	// required to work in iOS 11 & up:
	cameraVideo.setAttribute('playsinline', '');

	let stats;
	if (statsJs) {
		stats = new Stats();
		stats.domElement.style.position = 'fixed';
		stats.domElement.style.top = '0px';
		stats.domElement.style.right = '0px';
		stats.domElement.style.left = '';
		document.body.appendChild(stats.domElement);
	}

	// Debug flags (not shown in the UI; could become Advanced Settings in the future)
	let debugAcceleration = false;
	let showDebugText = false;
	let showDebugEyeZoom = false;
	let showDebugHeadTilt = false;
	let showDebugRegionFilter = false;

	// Constants (could become Advanced Settings in the future)
	let defaultWidth = 640;
	let defaultHeight = 480;
	let maxPoints = 1000;
	let faceScoreThreshold = 0.5;
	let facemeshOptions = {
		maxContinuousChecks: 5,
		detectionConfidence: 0.9,
		maxFaces: 1,
		iouThreshold: 0.3,
		scoreThreshold: 0.75
	};
	let useFacemesh = true;
	const facemeshMaxFaces = 2;
	let sleepGestureEyesClosedDuration = 2000;
	// maybe should be based on size of head in view?
	const pruningGridSize = 5;
	const minDistanceToAddPoint = pruningGridSize * 1.5;
	const computePruneKeepMask = VM.createPruner(pruningGridSize);
	// Keeps following the same face when several are visible (instead of predictions[0]).
	const faceLock = VM.createFaceLock({
		getFrameSize: () => ({ width: canvas.width, height: canvas.height }),
	});

	// Head tracking and facial gesture state
	// ## Clmtrackr state
	let face;
	let faceScore = 0;
	let faceConvergence = 0;
	// let faceConvergenceThreshold = 50;
	let pointsBasedOnFaceScore = 0;
	// ## Facemesh state
	let detector;
	let currentCameraImageData;
	let facemeshLoaded = false;
	let facemeshFirstEstimation = true;
	let facemeshEstimating = false;
	let facemeshRejectNext = 0;
	let facemeshPrediction;
	let facemeshEstimateFaces;
	let faceInViewConfidenceThreshold = 0.7;
	let pointsBasedOnFaceInViewConfidence = 0;
	let cameraFramesSinceFacemeshUpdate = [];
	let blinkInfo;
	let mouthInfo;
	let foreheadInfo;
	let headTilt = { pitch: 0, yaw: 0, roll: 0 };
	const headTiltSmoother = VM.createHeadTiltSmoother();
	// Per-profile gesture thresholds (settings); default to the original constants.
	const gestureThresholds = () => ({
		eye: { high: s.eyeThresholdHigh ?? VM.DEFAULT_THRESHOLDS.eye.high, low: s.eyeThresholdLow ?? VM.DEFAULT_THRESHOLDS.eye.low },
		mouth: { high: s.mouthThresholdHigh ?? VM.DEFAULT_THRESHOLDS.mouth.high, low: s.mouthThresholdLow ?? VM.DEFAULT_THRESHOLDS.mouth.low },
		brow: { high: s.browThresholdHigh ?? VM.DEFAULT_THRESHOLDS.brow.high, low: s.browThresholdLow ?? VM.DEFAULT_THRESHOLDS.brow.low },
	});
	let sleepGestureProgress = 0;
	let eyebrowGestureDuration = 3000;
	let eyebrowGestureProgress = 0;
	let eyebrowGestureCooldownUntil = 0;
	let lastForeheadTimestamp = performance.now();
	let isMouthScrolling = false;
	let mouthScrollDirection = 0;
	// ## State related to switching between head trackers
	let useClmTracking = true;
	let showClmTracking = useClmTracking;
	let fallbackTimeoutID;

	// Mouse state
	let mouseX = 0;
	let mouseY = 0;
	let buttonStates = {
		left: false,
		right: false,
		middle: false,
	};
	let mouseButtonUntilMouthCloses = -1;
	let lastMouseDownTime = -Infinity;
	let mouseNeedsInitPos = true;

	// Virtual display bounds cache (Electron only); covers all connected monitors.
	let virtualDisplayBounds = null;
	if (window.electronAPI?.getVirtualDisplayBounds) {
		window.electronAPI.getVirtualDisplayBounds().then((bounds) => {
			virtualDisplayBounds = bounds;
		});
		window.electronAPI.onVirtualDisplayBoundsChanged?.((bounds) => {
			virtualDisplayBounds = bounds;
			mouseNeedsInitPos = true;
		});
	}

	// Other state
	let paused = true;
	let pointTracker;

	const handleTrackingLoss = (reason = "tracking-loss") => {
		const buttonNames = ["left", "middle", "right"];
		for (let buttonIndex = 0; buttonIndex < 3; buttonIndex++) {
			if (buttonStates[buttonNames[buttonIndex]]) {
				buttonStates[buttonNames[buttonIndex]] = false;
				if (setMouseButtonState) {
					try {
						setMouseButtonState(buttonIndex, false);
					} catch (err) {
						console.error(`[Vision] Failed to release button ${buttonNames[buttonIndex]} on ${reason}:`, err);
					}
				}
			}
		}
		mouseButtonUntilMouthCloses = -1;
		lastMouseDownTime = -Infinity;
		blinkInfo = null;
		mouthInfo = null;
		foreheadInfo = null;
		eyebrowGestureProgress = 0;
		sleepGestureProgress = 0;
		isMouthScrolling = false;
		mouthScrollDirection = 0;

		updateInputFeedback?.({
			headNotFound: true,
			blinkInfo: null,
			mouthInfo: null,
			foreheadInfo: null,
			eyebrowGestureProgress: 0,
		});
	};

	// Named lists of facemesh landmark indices
	const MESH_ANNOTATIONS = {
		silhouette: [
			10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
			397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
			172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
		],

		lipsUpperOuter: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
		lipsLowerOuter: [146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
		lipsUpperInner: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
		lipsLowerInner: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],

		rightEyeUpper0: [246, 161, 160, 159, 158, 157, 173],
		rightEyeLower0: [33, 7, 163, 144, 145, 153, 154, 155, 133],
		rightEyeUpper1: [247, 30, 29, 27, 28, 56, 190],
		rightEyeLower1: [130, 25, 110, 24, 23, 22, 26, 112, 243],
		rightEyeUpper2: [113, 225, 224, 223, 222, 221, 189],
		rightEyeLower2: [226, 31, 228, 229, 230, 231, 232, 233, 244],
		rightEyeLower3: [143, 111, 117, 118, 119, 120, 121, 128, 245],

		rightEyebrowUpper: [156, 70, 63, 105, 66, 107, 55, 193],
		rightEyebrowLower: [35, 124, 46, 53, 52, 65],

		rightEyeIris: [473, 474, 475, 476, 477],

		leftEyeUpper0: [466, 388, 387, 386, 385, 384, 398],
		leftEyeLower0: [263, 249, 390, 373, 374, 380, 381, 382, 362],
		leftEyeUpper1: [467, 260, 259, 257, 258, 286, 414],
		leftEyeLower1: [359, 255, 339, 254, 253, 252, 256, 341, 463],
		leftEyeUpper2: [342, 445, 444, 443, 442, 441, 413],
		leftEyeLower2: [446, 261, 448, 449, 450, 451, 452, 453, 464],
		leftEyeLower3: [372, 340, 346, 347, 348, 349, 350, 357, 465],

		leftEyebrowUpper: [383, 300, 293, 334, 296, 336, 285, 417],
		leftEyebrowLower: [265, 353, 276, 283, 282, 295],

		leftEyeIris: [468, 469, 470, 471, 472],

		midwayBetweenEyes: [168],

		noseTip: [1],
		noseBottom: [2],
		noseRightCorner: [98],
		noseLeftCorner: [327],

		rightCheek: [205],
		leftCheek: [425]
	};


	const initFacemesh = async () => {
		if (detector) {
			detector.dispose();
		}
		facemeshEstimating = false;
		facemeshFirstEstimation = true;
		facemeshLoaded = false;
		const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
		const detectorConfig = {
			runtime: 'mediapipe',
			solutionPath: `${Vision.dependenciesRoot}/lib/face_mesh`,
			refineLandmarks: true,
			// Look for a second face so faceLock can keep following the user (not a passer-by).
			maxFaces: facemeshMaxFaces,
		};

		try {
			detector = await faceLandmarksDetection.createDetector(model, detectorConfig);
			if (lastShownErrorDetails?.errorClass === "faceLandmarksDetection.createDetector") {
				errorMessage.hidden = true;
			}
		} catch (error) {
			detector = null;
			console.error("Failed to create facemesh detector:", error);
			showError(t("faceDetectorInitError", { defaultValue: "Failed to create face detector" }), error, { errorClass: "faceLandmarksDetection.createDetector" });
		}

		facemeshLoaded = true;
		let loggedDetectorError = false;
		facemeshEstimateFaces = async () => {
			const imageData = currentCameraImageData;//getCameraImageData();
			if (!imageData) {
				return [];
			}
			if (syntheticFace) {
				return syntheticFace();
			}
			try {
				const faces = await detector.estimateFaces(imageData, { flipHorizontal: false });
				if (!faces) {
					console.warn("faces ===", faces);
					return [];
				}
				return faces;
			} catch (error) {
				if (!loggedDetectorError) {
					console.error("Facemesh estimation failed:", error);
					loggedDetectorError = true;
				}
				try {
					detector?.dispose();
				} catch (disposeError) {
					console.error("Failed to dispose facemesh detector after estimation error:", disposeError);
				}
				detector = null;
				showError(t("faceDetectorError", { defaultValue: "Face detector error" }), error);
			}
			return [];
		};

	};

	if (useFacemesh) {
		initFacemesh();
	}

	function deserializeSettings(settings, initialLoad = false) {
		// TODO: DRY with deserializeSettings in electron-main.js
		for (const category of settingsCategories) {
			traverseSettings(category.settings, (setting) => {
				setting._load?.(settings, initialLoad);
			});
		}
		setAudioEnabled(s.soundEffects);

		// Now that all settings are loaded, update disabled states
		for (const func of functionsToUpdateDisabledStates) {
			func();
		}

		// Unstable hook
		handleSettingsUpdate?.(settings);
	}
	const formatVersion = 1;
	const formatName = "vision-settings";
	function serializeSettings() {
		// TODO: DRY with serializeSettings in electron-main.js
		// The important part is done (don't need to list every setting here - or there),
		// but we could still switch to using IPC for saving/loading serialized settings
		// eliminating the duplicate format handling, which may become more complex over time.
		// The main process will still want to know about _some_ settings, and this shouldn't go through the serialization,
		// but that can remain using the existing IPC calls while we add new ones dealing with serialized settings.
		// (So I guess this is really a todo for the electron app; maybe this sort of detailed comment would make more sense there.)
		return {
			formatVersion,
			formatName,
			globalSettings: s,
			// profiles: [],
		};
	};
	const setOptions = (options) => {
		if (window.electronAPI) {
			window.electronAPI.setOptions(options);
		} else {
			try {
				localStorage.setItem("vision-settings", JSON.stringify(serializeSettings(), null, "\t"));
			} catch (e) {
				console.error(e);
			}
		}
		// Unstable hook
		handleSettingsUpdate?.(options);
	};
	const loadOptions = async (initialLoad = false) => {
		// Desktop app: start from any saved settings in the main process,
		// then, on first load, push the renderer's canonical defaults back
		// so the main process has the same effective settings (and can
		// correctly drive features like dwell clicking on first run).
		// Web demo: similarly needs canonical defaults pushed to
		// correctly enable dwell clicking on first run,
		// now that it supports multiple clicking modes.
		// General API usage: does not yet support multiple clicking modes
		// (there's a lot of glue code in the demo)
		// but we only call handleSettingsUpdate if it exists.
		let stored;
		if (window.electronAPI) {
			stored = await window.electronAPI.getOptions();
		} else {
			try {
				if (localStorage.getItem("vision-settings")) {
					stored = JSON.parse(localStorage.getItem("vision-settings"));
				}
			} catch (e) {
				console.error(e);
				return;
			}
		}
		if (stored) {
			deserializeSettings(stored, initialLoad);
		} else {
			// HACK: ensure handleInitialLoad is called even for first run
			// Combined with the below, this feels very redundant, and I'd like to
			// move to a subscription-based pattern, more of a formal "settings store", something like that.
			// This is currently necessary for sound effects to work on the first run of the web demo.
			deserializeSettings(serializeSettings(), initialLoad);
		}
		if (initialLoad && (!stored || !stored.globalSettings || Object.keys(stored.globalSettings).length === 0)) {
			// We could just call setOptions in both cases,
			// but do we want to save to localStorage initially? Maybe not.
			if (window.electronAPI) {
				setOptions(serializeSettings()); // (includes handleSettingsUpdate)
			} else {
				handleSettingsUpdate?.(serializeSettings());
			}
		}
	};

	paused = !s.startEnabled;

	// Basically Promise.withResolvers (but I'm not sure browser support is good enough)
	function createDeferred() {
		let resolve, reject;
		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}

	let populateCameraList = () => { return Promise.resolve(); };
	if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
		populateCameraList = () => {
			let matchedCameraIdDeferred = createDeferred();
			navigator.mediaDevices.enumerateDevices().then((devices) => {
				const videoDevices = devices.filter(device => device.kind === 'videoinput');

				let knownCameras = {};
				try {
					knownCameras = JSON.parse(localStorage.getItem("vision-known-cameras")) || {};
				} catch (error) {
					console.error("Failed to parse known cameras from localStorage", error);
				}
				let knownCamerasChanged = false;
				for (const device of videoDevices) {
					if (device.deviceId && device.label) {
						if (!knownCameras[device.deviceId] || knownCameras[device.deviceId].name !== device.label) {
							knownCameras[device.deviceId] = { name: device.label };
							knownCamerasChanged = true;
						}
					}
				}
				if (knownCamerasChanged) {
					try {
						localStorage.setItem("vision-known-cameras", JSON.stringify(knownCameras));
					} catch (error) {
						console.error("Failed to store known cameras in localStorage", error);
					}
				}

				cameraSelect.innerHTML = "";

				const defaultOption = document.createElement("option");
				defaultOption.value = "";
				defaultOption.text = t("settings.cameraSource.defaultCamera", { defaultValue: "Default" });
				cameraSelect.appendChild(defaultOption);

				let matchingDeviceId = "";
				for (const device of videoDevices) {
					const option = document.createElement('option');
					option.value = device.deviceId;
					option.text = device.label || t("settings.cameraSource.numberedCamera", { defaultValue: "Camera %0" }).replace("%0", cameraSelect.length);
					cameraSelect.appendChild(option);
					if (device.deviceId === s.cameraDeviceId) {
						matchingDeviceId = device.deviceId;
					} else if (device.label === knownCameras[s.cameraDeviceId]?.name) {
						matchingDeviceId ||= device.deviceId;
					}
				}

				// Defaulting to "Default" would imply a preference isn't stored...
				// but would it be more friendly anyways?
				// cameraSelect.value = found ? s.cameraDeviceId : "";

				// Show a placeholder for the selected camera
				if (s.cameraDeviceId && !matchingDeviceId) {
					const option = document.createElement("option");
					option.value = s.cameraDeviceId;
					const knownInfo = knownCameras[s.cameraDeviceId];
					option.text = knownInfo ? `${knownInfo.name} (${t("settings.cameraSource.unavailableCameraAdjective", { defaultValue: "Unavailable" })})` : t("settings.cameraSource.unavailableCamera", { defaultValue: "Unavailable camera" });
					cameraSelect.appendChild(option);
					cameraSelect.value = s.cameraDeviceId;
				} else {
					cameraSelect.value = matchingDeviceId;
				}
				matchedCameraIdDeferred.resolve(matchingDeviceId);
			});
			return matchedCameraIdDeferred.promise;
		};
		populateCameraList();
		navigator.mediaDevices.addEventListener('devicechange', populateCameraList);
	}

	// Handle right click on "swap mouse buttons", so it doesn't leave users stranded right-clicking.
	// Note that if you click outside the application window, hiding it behind another window, or minimize it,
	// you can still be left in a tricky situation.
	// A more general safety net would be a "revert changes?" timer (https://github.com/1j01/vision/issues/43)
	// But this is good to have in any case, since you don't want to have to wait for a timeout if you don't have to.
	for (const el of [swapMouseButtonsLabel, swapMouseButtonsCheckbox]) {
		el.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			swapMouseButtonsCheckbox.checked = !swapMouseButtonsCheckbox.checked;
			swapMouseButtonsCheckbox.dispatchEvent(new Event("change"));
		});
	}

	const settingsLoadedPromise = loadOptions(true);

	// Don't use WebGL because clmTracker is our fallback! It's also not much slower than with WebGL.
	let clmTracker = new clm.tracker({ useWebGL: false });
	clmTracker.init();
	let clmTrackingStarted = false;

	const stopCameraStream = () => {
		if (cameraVideo.srcObject) {
			for (const track of cameraVideo.srcObject.getTracks()) {
				try {
					track.stop();
				} catch (err) {
					console.warn("[Vision] Error stopping camera track:", err);
				}
			}
		}
		cameraVideo.srcObject = null;
	};

	const reset = () => {
		handleTrackingLoss("system-reset");
		stopCameraStream();
		clmTrackingStarted = false;
		cameraFramesSinceFacemeshUpdate.length = 0;
		if (facemeshPrediction) {
			// facemesh has a setting maxContinuousChecks that determines "How many frames to go without running
			// the bounding box detector. Only relevant if maxFaces > 1. Defaults to 5."
			facemeshRejectNext = facemeshOptions.maxContinuousChecks;
		}
		facemeshPrediction = null;
		faceLock.reset();
		useClmTracking = true;
		showClmTracking = true;
		pointsBasedOnFaceScore = 0;
		faceScore = 0;
		faceConvergence = 0;
		sleepGestureProgress = 0;
		updateStartStopButton();
	};

	// Handle monkey-patched alert() replacement in face-landmarks-detection.min.js
	// (Hm, could make it throw instead. Then we wouldn't need this.)
	window._Vision_faceLandmarksDetectionAlert = (message) => {
		// TODO: i18n (it's just one message; we could check for the string (or not) and translate it)
		// const isContextCreationMessage = message === "Failed to create WebGL canvas context when passing video frame.";
		errorMessage.textContent = `${t("common.warningIcon", { defaultValue: "⚠️" })} ${message}`;
		errorMessage.hidden = false;
	};

	let lastCameraError = null;
	const cameraAccessSlowWarningDelayMS = 5000;
	let cameraAccessSlowWarningTimeoutID;
	// Serialises getUserMedia calls; the newest request wins; old tracks are stopped first.
	const cameraAcquirer = VM.createCameraAcquirer({
		getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
		releaseCurrent: () => {
			if (cameraVideo.srcObject) {
				handleTrackingLoss("camera-switching");
				stopCameraStream();
			}
		},
	});
	useCameraButton.onclick = Vision.useCamera = async (optionsOrEvent = {}) => {
		await settingsLoadedPromise;

		const phase = optionsOrEvent.phase ?? "tryPreferredCamera";

		const constraints = {
			audio: false,
			video: {
				width: defaultWidth,
				height: defaultHeight,
				facingMode: "user",
			}
		};
		const deviceIdToTry = phase === "retryPreferredCamera" ?
			optionsOrEvent.retryWithCameraDeviceId :
			phase === "tryPreferredCamera" ?
				s.cameraDeviceId :
				"";
		if (deviceIdToTry) {
			delete constraints.video.facingMode;
			constraints.video.deviceId = { exact: deviceIdToTry };
		}
		clearTimeout(cameraAccessSlowWarningTimeoutID);
		errorMessage.hidden = true;
		cameraAccessSlowWarningTimeoutID = setTimeout(() => {
			errorMessage.textContent = t("video.status.accessTakingLongerThanExpected", { defaultValue: "Accessing the camera is taking longer than expected..." });
			errorMessage.hidden = false;
		}, cameraAccessSlowWarningDelayMS);
		console.log("Vision.useCamera phase", phase, "constraints", constraints);
		const result = await cameraAcquirer.acquire(constraints, { releaseFirst: phase !== "justGetPermission" });
		if (result.status === "superseded") {
			// A newer camera request took over; it owns the UI state now.
			return;
		}
		if (result.status === "ok") {
			const stream = result.stream;
			clearTimeout(cameraAccessSlowWarningTimeoutID);
			if (phase === "justGetPermission") {
				for (const track of stream.getTracks()) {
					track.stop();
				}
				// This is giving me User Gesture Hinged Access and Async Authorization Asking Attempt Absorption Anxiety,
				// or "UGHAaAAAAAA" (I'm coining that term)
				// (Look I made a presentation about it: https://websim.com/@1j01/ughaaaaaa)
				const matchedCameraId = await populateCameraList();
				if (matchedCameraId) {
					Vision.useCamera({ retryWithCameraDeviceId: matchedCameraId, phase: "retryPreferredCamera" });
				} else {
					Vision.useCamera({ retryWithCameraDeviceId: "", phase: "retryPreferredCamera" });
				}
				return;
			}
			populateCameraList();
			reset();

			// Fail-safe: attach track lifecycle listeners for unexpected camera disconnects or hardware loss
			for (const track of stream.getVideoTracks()) {
				track.addEventListener('ended', () => {
					console.warn("[Vision] Camera track ended (unplugged, disabled, or revoked).");
					handleTrackingLoss("camera-disconnected");
					showError(t("video.errors.cameraDisconnected", { defaultValue: "Webcam was disconnected or stopped unexpectedly." }));
					useCameraButton.hidden = false;
				});
				track.addEventListener('mute', () => {
					console.warn("[Vision] Camera track muted.");
					handleTrackingLoss("camera-muted");
				});
			}

			cameraVideo.srcObject = stream;
			emitEngine("camera", { status: "on" });
			useCameraButton.hidden = true;
			errorMessage.hidden = true;
			lastCameraError = null;
			return;
		}
		{
			const error = result.error;
			lastCameraError = error;
			clearTimeout(cameraAccessSlowWarningTimeoutID);
			useCameraButton.hidden = false;
			handleTrackingLoss("camera-acquisition-failed");
			console.log("Vision.useCamera phase", phase, "error", error);
			if (
				phase === "tryPreferredCamera" &&
				(error.name === "OverconstrainedError" || error.name == "ConstraintNotSatisfiedError") &&
				!window.electronAPI
			) {
				Vision.useCamera({ phase: "justGetPermission" });
				return;
			}
			if (error.name == "NotFoundError" || error.name == "DevicesNotFoundError") {
				// required track is missing
				showError(t("video.errors.noCameraFound", { defaultValue: "No camera found. Please make sure you have a camera connected and enabled." }));
			} else if (error.name == "NotReadableError" || error.name == "TrackStartError") {
				// webcam is already in use
				// or: OBS Virtual Camera is present but OBS is not running with Virtual Camera started
				// TODO: enumerateDevices and give more specific message for OBS Virtual Camera case
				// (listing devices and showing only the OBS Virtual Camera would also be a good clue in itself;
				// though care should be given to make it clear it's a list with one item, with something like "(no more cameras detected)" following the list
				// or "1 camera source detected" preceding it)
				showError(t("video.errors.cameraBusy", { defaultValue: "The camera is busy. Another app (Teams, Zoom, OBS, or a browser tab) may be using it. Close that app, then press \"Allow Camera Access\" to retry." }));
			} else if (error.name === "AbortError") {
				// webcam is likely already in use
				// I observed AbortError in Firefox 132.0.2 but I don't know it's used exclusively for this case.
				// Update: it definitely isn't, but I can't say exactly what it means in other cases.
				// Like, it might have to do with permissions being denied outside of a user gesture (distinct from the user denying the permission)
				// I really hope that isn't the problem.
				// showError("Webcam may already be in use. Please make sure you have no other programs using the camera.");
				showError(t("video.errors.retryAfterClosingOtherPrograms", { defaultValue: "Please make sure no other programs are using the camera and try again." }));
				// A more honest/helpful message might be:
				// showError("Please try again and then make sure no other programs are using the camera and try again again.");
				// showError("Please try again before/after making sure no other programs are using the camera.");
				// if it were not to be confusing.
				// That is, one could save some time by just hitting the button to try again before trying to figure out of another program is using the camera,
				// because sometimes that's enough.
			} else if (error.name == "OverconstrainedError" || error.name == "ConstraintNotSatisfiedError") {
				// constraints cannot be satisfied by available devices

				// OverconstrainedError can be caused by `deviceId` not matching,
				// either due to the device not being present, or the ID having changed (don't ask me why that can happen but it can)
				// Note: OverconstrainedError has a `constraint` property but not in Firefox so it's not very helpful.
				if (constraints.video.deviceId?.exact) {
					// showError("The previously selected camera is not available. Please select a different camera from the dropdown and try again.");
					// showError("The previously selected camera is not available. Please mess around with Video > Camera source.");
					// showError("The previously selected camera is not available. Try changing Video > Camera source.");
					// showError("The previously selected camera is not available. Please select a camera from the \"Camera source\" dropdown in the Video settings and if it doesn't show up, it might after you select Default.");
					showError(t("video.errors.previouslySelectedUnavailable", { defaultValue: "The previously selected camera is not available. Try selecting \"Default\" for Video > Camera source, and then select a specific camera if you need to." }));
					// It's awkward but that's my best attempt at conveying how you may need to proceed
					// without complicated description of how/why the dropdown might be populated with
					// fake information until a camera stream is successfully opened.
				} else {
					showError(t("video.errors.unsupportedResolution", { defaultValue: "Webcam does not support the required resolution. Please change your settings." }));
				}
			} else if (error.name == "NotAllowedError" || error.name == "PermissionDeniedError") {
				// permission denied in browser
				showError(t("video.errors.permissionDenied", { defaultValue: "Permission denied. Please enable access to the camera." }));
			} else if (error.name == "TypeError") {
				// empty constraints object
				showError(t("video.errors.accessFailed", { defaultValue: "Something went wrong accessing the camera." }), error);
			} else {
				// other errors
				showError(t("video.errors.accessFailedRetry", { defaultValue: "Something went wrong accessing the camera. Please try again." }), error);
			}
		}
	};
	useDemoFootageButton.onclick = Vision.useDemoFootage = () => {
		reset();
		cameraVideo.src = `${Vision.dependenciesRoot}/private/demo-input-footage.webm`;
		cameraVideo.loop = true;
	};

	startStopButton.onclick = () => {
		if (!useCameraButton.hidden) {
			Vision.useCamera();
		}
		handleShortcut("toggle-tracking");
	};

	if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
		console.log('getUserMedia not supported in this browser');
	}

	canvasContainer.style.aspectRatio = `${defaultWidth} / ${defaultHeight}`;
	canvasContainer.style.setProperty('--aspect-ratio', defaultWidth / defaultHeight);

	cameraVideo.addEventListener('loadedmetadata', () => {
		cameraVideo.play();
		cameraVideo.width = cameraVideo.videoWidth;
		cameraVideo.height = cameraVideo.videoHeight;
		canvas.width = cameraVideo.videoWidth;
		canvas.height = cameraVideo.videoHeight;
		debugPointsCanvas.width = cameraVideo.videoWidth;
		debugPointsCanvas.height = cameraVideo.videoHeight;

		// .vision-canvas-container needs aspect-ratio CSS property
		// so that the video can be scaled to fit the container.
		canvasContainer.style.aspectRatio = `${cameraVideo.videoWidth} / ${cameraVideo.videoHeight}`;
		canvasContainer.style.setProperty('--aspect-ratio', cameraVideo.videoWidth / cameraVideo.videoHeight);

		pointTracker = new OOPS();
	});
	cameraVideo.addEventListener('play', () => {
		clmTracker.reset();
		clmTracker.initFaceDetector(cameraVideo);
		clmTrackingStarted = true;
	});
	cameraVideo.addEventListener('ended', () => {
		useCameraButton.hidden = false;
		if (!paused) {
			handleShortcut("toggle-tracking");
		}
	});
	cameraVideo.addEventListener('error', () => {
		useCameraButton.hidden = false;
		if (!paused) {
			handleShortcut("toggle-tracking");
		}
	});

	canvas.width = defaultWidth;
	canvas.height = defaultHeight;
	cameraVideo.width = defaultWidth;
	cameraVideo.height = defaultHeight;

	const debugPointsCanvas = document.createElement("canvas");
	debugPointsCanvas.width = canvas.width;
	debugPointsCanvas.height = canvas.height;
	const debugPointsCtx = debugPointsCanvas.getContext("2d");

	// function getPyramidData(pyramid) {
	// 	const array = new Float32Array(pyramid.data.reduce((sum, matrix)=> sum + matrix.buffer.f32.length, 0));
	// 	let offset = 0;
	// 	for (const matrix of pyramid.data) {
	// 		copy matrix.buffer.f32 into array starting at offset;
	// 		offset += matrix.buffer.f32.length;
	// 	}
	// 	return array;
	// }
	// function setPyramidData(pyramid, array) {
	// 	let offset = 0;
	// 	for (const matrix of pyramid.data) {
	// 		copy portion of array starting at offset into matrix.buffer.f32
	// 		offset += matrix.buffer.f32.length;
	// 	}
	// }

	// Object Oriented Programming Sucks
	// or Optical flOw Points System
	class OOPS {
		constructor() {
			this.curPyramid = new jsfeat.pyramid_t(3);
			this.prevPyramid = new jsfeat.pyramid_t(3);
			this.curPyramid.allocate(cameraVideo.videoWidth, cameraVideo.videoHeight, jsfeat.U8C1_t);
			this.prevPyramid.allocate(cameraVideo.videoWidth, cameraVideo.videoHeight, jsfeat.U8C1_t);

			this.pointCount = 0;
			this.pointStatus = new Uint8Array(maxPoints);
			this.prevXY = new Float32Array(maxPoints * 2);
			this.curXY = new Float32Array(maxPoints * 2);
		}
		addPoint(x, y) {
			if (this.pointCount < maxPoints) {
				let pointIndex = this.pointCount * 2;
				this.curXY[pointIndex] = x;
				this.curXY[pointIndex + 1] = y;
				this.prevXY[pointIndex] = x;
				this.prevXY[pointIndex + 1] = y;
				this.pointCount++;
			}
		}
		filterPoints(condition) {
			let outputPointIndex = 0;
			for (let inputPointIndex = 0; inputPointIndex < this.pointCount; inputPointIndex++) {
				if (condition(inputPointIndex)) {
					if (outputPointIndex < inputPointIndex) {
						const inputOffset = inputPointIndex * 2;
						const outputOffset = outputPointIndex * 2;
						this.curXY[outputOffset] = this.curXY[inputOffset];
						this.curXY[outputOffset + 1] = this.curXY[inputOffset + 1];
						this.prevXY[outputOffset] = this.prevXY[inputOffset];
						this.prevXY[outputOffset + 1] = this.prevXY[inputOffset + 1];
					}
					outputPointIndex++;
				} else {
					debugPointsCtx.fillStyle = "red";
					const inputOffset = inputPointIndex * 2;
					circle(debugPointsCtx, this.curXY[inputOffset], this.curXY[inputOffset + 1], 5);
					debugPointsCtx.fillText(condition.toString(), 5 + this.curXY[inputOffset], this.curXY[inputOffset + 1]);
					// console.log(this.curXY[inputOffset], this.curXY[inputOffset + 1]);
					ctx.strokeStyle = ctx.fillStyle;
					ctx.beginPath();
					ctx.moveTo(this.prevXY[inputOffset], this.prevXY[inputOffset + 1]);
					ctx.lineTo(this.curXY[inputOffset], this.curXY[inputOffset + 1]);
					ctx.stroke();
				}
			}
			this.pointCount = outputPointIndex;
		}
		prunePoints() {
			// pointStatus is only valid (indices line up) before filtering occurs, so must come first (could be combined though)
			this.filterPoints((pointIndex) => this.pointStatus[pointIndex] == 1);

			// De-duplicate points that are too close together
			// - Points that have collapsed together are completely useless.
			// - Points that are too close together are not necessarily helpful,
			//   and may adversely affect the tracking due to uneven weighting across your face.
			// - Reducing the number of points improves FPS.
			// (Same result as the old string-keyed grid + includes(), without the per-frame garbage.)
			const keepMask = computePruneKeepMask(this.curXY, this.pointCount);
			this.filterPoints((pointIndex) => keepMask[pointIndex] === 1);
		}
		update(imageData) {
			[this.prevXY, this.curXY] = [this.curXY, this.prevXY];
			[this.prevPyramid, this.curPyramid] = [this.curPyramid, this.prevPyramid];

			// these are options worth breaking out and exploring
			let winSize = 20;
			let maxIterations = 30;
			let epsilon = 0.01;
			let minEigen = 0.001;

			jsfeat.imgproc.grayscale(imageData.data, imageData.width, imageData.height, this.curPyramid.data[0]);
			this.curPyramid.build(this.curPyramid.data[0], true);
			jsfeat.optical_flow_lk.track(
				this.prevPyramid, this.curPyramid,
				this.prevXY, this.curXY,
				this.pointCount,
				winSize, maxIterations,
				this.pointStatus,
				epsilon, minEigen);
			this.prunePoints();
		}
		draw(ctx) {
			for (let i = 0; i < this.pointCount; i++) {
				let pointOffset = i * 2;
				// let distMoved = Math.hypot(
				// 	this.prevXY[pointOffset] - this.curXY[pointOffset],
				// 	this.prevXY[pointOffset + 1] - this.curXY[pointOffset + 1]
				// );
				// if (distMoved >= 1) {
				// 	ctx.fillStyle = "lime";
				// } else {
				// 	ctx.fillStyle = "gray";
				// }
				circle(ctx, this.curXY[pointOffset], this.curXY[pointOffset + 1], 3);
				ctx.strokeStyle = ctx.fillStyle;
				ctx.beginPath();
				ctx.moveTo(this.prevXY[pointOffset], this.prevXY[pointOffset + 1]);
				ctx.lineTo(this.curXY[pointOffset], this.curXY[pointOffset + 1]);
				ctx.stroke();
			}
		}
		getMovement() {
			let movementX = 0;
			let movementY = 0;
			let numMovements = 0;
			for (let i = 0; i < this.pointCount; i++) {
				let pointOffset = i * 2;
				movementX += this.curXY[pointOffset] - this.prevXY[pointOffset];
				movementY += this.curXY[pointOffset + 1] - this.prevXY[pointOffset + 1];
				numMovements += 1;
			}
			if (numMovements > 0) {
				movementX /= numMovements;
				movementY /= numMovements;
			}
			return [movementX, movementY];
		}
	}

	// FIXME: can't click to add points because canvas is covered by .vision-canvas-overlay
	canvas.addEventListener('click', (event) => {
		if (!pointTracker) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		if (s.mirror) {
			pointTracker.addPoint(
				(rect.right - event.clientX) / rect.width * canvas.width,
				(event.clientY - rect.top) / rect.height * canvas.height,
			);
		} else {
			pointTracker.addPoint(
				(event.clientX - rect.left) / rect.width * canvas.width,
				(event.clientY - rect.top) / rect.height * canvas.height,
			);
		}
	});

	function maybeAddPoint(oops, x, y) {
		// In order to prefer points that already exist, since they're already tracking,
		// in order to keep a smooth overall tracking calculation,
		// don't add points if they're close to an existing point.
		// Otherwise, it would not just be redundant, but often remove the older points, in the pruning.
		for (let pointIndex = 0; pointIndex < oops.pointCount; pointIndex++) {
			let pointOffset = pointIndex * 2;
			// let distance = Math.hypot(
			// 	x - oops.curXY[pointOffset],
			// 	y - oops.curXY[pointOffset + 1]
			// );
			// if (distance < 8) {
			// 	return;
			// }
			// It might be good to base this on the size of the face...
			// Also, since we're pruning points based on a grid,
			// there's not much point in using Euclidean distance here,
			// we can just look at x and y distances.
			if (
				Math.abs(x - oops.curXY[pointOffset]) <= minDistanceToAddPoint ||
				Math.abs(y - oops.curXY[pointOffset + 1]) <= minDistanceToAddPoint
			) {
				return;
			}
		}
		oops.addPoint(x, y);
	}

	let smoothedFPS = 60;
	let lastTimestamp = -Infinity;
	function draw(update = true) {
		ctx.resetTransform(); // in case there is an error, don't flip constantly back and forth due to mirroring
		ctx.clearRect(0, 0, canvas.width, canvas.height); // in case there's no footage
		ctx.save();
		ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		currentCameraImageData = imageData;
		// Lighting check for the framing guide (cheap: sampled, every 15th frame).
		if (++brightnessFrameCounter % 15 === 0 && cameraVideo.readyState >= 2) {
			frameBrightness = VM.measureBrightness(imageData, 16);
		}

		if (s.mirror) {
			ctx.translate(canvas.width, 0);
			ctx.scale(-1, 1);
			ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
		}

		const timestamp = performance.now();
		const deltaTime = Math.min(timestamp - lastTimestamp, 100);
		lastTimestamp = timestamp;

		sleepSweep?.setEnabled(s.closeEyesToToggle);
		sleepSweep?.update(sleepGestureProgress);

		if (!pointTracker) {
			return;
		}

		if (update) {
			if (clmTrackingStarted) {
				if (useClmTracking || showClmTracking) {
					try {
						clmTracker.track(cameraVideo);
					} catch (error) {
						console.warn("Error in clmTracker.track()", error);
						if (clmTracker.getCurrentParameters().includes(NaN)) {
							console.warn("NaNs crept in.");
						}
					}
					face = clmTracker.getCurrentPosition();
					faceScore = clmTracker.getScore();
					faceConvergence = Math.pow(clmTracker.getConvergence(), 0.5);
				}
				if (facemeshLoaded && !facemeshEstimating) {
					facemeshEstimating = true;
					// movementXSinceFacemeshUpdate = 0;
					// movementYSinceFacemeshUpdate = 0;
					cameraFramesSinceFacemeshUpdate = [];
					// If I switch virtual console desktop sessions in Ubuntu with Ctrl+Alt+F1 (and back with Ctrl+Alt+F2),
					// WebGL context is lost, which breaks facemesh (and clmTracker if useWebGL is not false)
					// Error: Size(8192) must match the product of shape 0, 0, 0
					//     at inferFromImplicitShape (tf.js:14142)
					//     at Object.reshape$3 [as kernelFunc] (tf.js:110368)
					//     at kernelFunc (tf.js:17241)
					//     at tf.js:17334
					//     at Engine.scopedRun (tf.js:17094)
					//     at Engine.runKernelFunc (tf.js:17328)
					//     at Engine.runKernel (tf.js:17171)
					//     at reshape_ (tf.js:25875)
					//     at reshape__op (tf.js:18348)
					//     at executeOp (tf.js:85396)
					// WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost

					// Note that the first estimation from facemesh often takes a while*,
					// and we don't want to continuously terminate the worker** as it's working on those first results.
					// And also, for the first estimate it hasn't actually disabled clmtrackr yet, so it's fine if it's a long timeout.
					// *Or it did, before updating the facemesh pipeline.
					// **Not using a worker for facemesh anymore...
					clearTimeout(fallbackTimeoutID);
					fallbackTimeoutID = setTimeout(() => {
						if (!useClmTracking) {
							reset();
							clmTracker.init();
							clmTracker.reset();
							clmTracker.initFaceDetector(cameraVideo);
							clmTrackingStarted = true;
							console.warn("Falling back to clmtrackr");
						}
						// If you've switched desktop sessions, it will presumably fail to get a new webgl context until you've switched back
						// Is this setInterval useful, vs just starting the worker?**
						// It probably has a faster cycle, with the code as it is now, but maybe not inherently.
						// TODO: do the extra getContext() calls add to a GPU process crash limit
						// that makes it only able to recover a couple times (outside the electron app)?
						// For electron, I set chromium flag --disable-gpu-process-crash-limit so it can recover unlimited times.
						// TODO: there's still the case of WebGL backend failing to initialize NOT due to the process crash limit,
						// where it'd be good to have it try again (maybe with exponential falloff?)
						// (I think I can move my fallbackTimeout code into/around `initFacemeshWorker` and `facemeshEstimateFaces`)

						// Note: clearTimeout/clearInterval work interchangeably
						fallbackTimeoutID = setInterval(() => {
							try {
								// TODO: attempting webgl context creation beforehand doesn't make sense without a worker
								// If it's running in the same thread, we can just try creating the detector.

								// Once we can create a webgl2 canvas...
								document.createElement("canvas").getContext("webgl2");
								clearInterval(fallbackTimeoutID);
								// It's worth trying to re-initialize [a web worker** for facemesh]...
								setTimeout(() => {
									console.warn("Re-initializing facemesh");
									initFacemesh();
									facemeshRejectNext = 1; // or more?
								}, 1000);
							} catch (error) {
								if (error.name !== "InvalidStateError") {
									throw error;
								} else {
									console.warn("Trying to recover; can't create webgl2 canvas yet...");
								}
							}
						}, 500);
					}, facemeshFirstEstimation ? 20000 : 2000);
					facemeshEstimateFaces().then((predictions) => {
						facemeshEstimating = false;
						facemeshFirstEstimation = false;
						{
							const estimateTime = performance.now();
							const hz = 1000 / Math.max(1, estimateTime - lastFacemeshEstimateTime);
							facemeshHz = facemeshHz ? facemeshHz * 0.9 + hz * 0.1 : hz;
							lastFacemeshEstimateTime = estimateTime;
						}

						facemeshRejectNext -= 1;
						if (facemeshRejectNext > 0) {
							return;
						}

						facemeshPrediction = faceLock.select(predictions, performance.now()); // undefined if no (locked) face found

						useClmTracking = false;
						showClmTracking = false;
						clearTimeout(fallbackTimeoutID);

						if (!facemeshPrediction) {
							handleTrackingLoss("facemesh-no-face");
							return;
						}
						facemeshPrediction.faceInViewConfidence = 0.9999; // TODO: any equivalent in new API?

						const getPoint = (index) =>
							facemeshPrediction.keypoints[index] ?
								[facemeshPrediction.keypoints[index].x, facemeshPrediction.keypoints[index].y, facemeshPrediction.keypoints[index].z] :
								undefined;

						const annotations = Object.fromEntries(Object.entries(MESH_ANNOTATIONS).map(([key, indices]) => {
							return [key, indices.map(getPoint)];
						}));

						// nostrils
						maybeAddPoint(pointTracker, annotations.noseLeftCorner[0][0], annotations.noseLeftCorner[0][1]);
						maybeAddPoint(pointTracker, annotations.noseRightCorner[0][0], annotations.noseRightCorner[0][1]);
						// midway between eyes
						maybeAddPoint(pointTracker, annotations.midwayBetweenEyes[0][0], annotations.midwayBetweenEyes[0][1]);
						// inner eye corners
						// maybeAddPoint(pointTracker, annotations.leftEyeLower0[8][0], annotations.leftEyeLower0[8][1]);
						// maybeAddPoint(pointTracker, annotations.rightEyeLower0[8][0], annotations.rightEyeLower0[8][1]);


						// console.log(pointTracker.pointCount, cameraFramesSinceFacemeshUpdate.length, pointTracker.curXY);

						pointsBasedOnFaceInViewConfidence = facemeshPrediction.faceInViewConfidence;

						// TODO: separate confidence threshold for removing vs adding points?


						// cull points to those within useful facial region
						function regionFilter([x, y]) {

							// distance from tip of nose (stretched so make an ellipse taller than wide)
							let distance = Math.hypot(
								(annotations.noseTip[0][0] - x) * 1.4,
								annotations.noseTip[0][1] - y
							);
							let headSize = Math.hypot(
								annotations.leftCheek[0][0] - annotations.rightCheek[0][0],
								annotations.leftCheek[0][1] - annotations.rightCheek[0][1]
							);
							if (distance > headSize) {
								return false;
							}
							// Avoid mouth affecting pointer position.
							distance = annotations.lipsLowerInner.map((lipPoint) =>
								Math.min(
									Math.hypot(lipPoint[0] - x, lipPoint[1] - y),
									Math.hypot(lipPoint[0] - x, lipPoint[1] + headSize * 0.1 - y), // a bit below too
									Math.hypot(lipPoint[0] - x, lipPoint[1] + headSize * 0.2 - y), // a bit below too
									Math.hypot(lipPoint[0] - x, lipPoint[1] + headSize * 0.3 - y), // a bit below too
									Math.hypot(lipPoint[0] - x, lipPoint[1] + headSize * 0.4 - y), // a bit below too (yeah I'm being a little lazy here)
								)
							).reduce((a, b) => Math.min(a, b), Infinity);
							if (distance < headSize * 0.1) {
								return false;
							}
							// Avoid blinking eyes affecting pointer position.
							// distance to outer corners of eyes
							distance = Math.min(
								Math.hypot(
									annotations.leftEyeLower0[0][0] - x,
									annotations.leftEyeLower0[0][1] - y
								),
								Math.hypot(
									annotations.rightEyeLower0[0][0] - x,
									annotations.rightEyeLower0[0][1] - y
								),
							);
							if (distance < headSize * 0.42) {
								return false;
							}
							return true;
						}
						pointTracker.filterPoints((pointIndex) => {
							let pointOffset = pointIndex * 2;
							const point = [pointTracker.curXY[pointOffset], pointTracker.curXY[pointOffset + 1]];
							return regionFilter(point);
						});

						// Debug visualization for region filter (a sort of heatmap of where points will be culled)
						if (showDebugRegionFilter) {
							ctx.save();
							if (s.mirror) {
								ctx.translate(canvas.width, 0);
								ctx.scale(-1, 1);
							}
							ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
							const vizStep = 4;
							for (let x = 0; x < canvas.width; x += vizStep) {
								for (let y = 0; y < canvas.height; y += vizStep) {
									if (!regionFilter([x, y])) {
										ctx.fillRect(x - 5, y - 5, vizStep, vizStep);
									}
								}
							}
							ctx.restore();
						}

						// Head pose (core/src/pose/head-tilt.js), smoothed with One Euro filters.
						const rawTilt = VM.computeHeadTilt(facemeshPrediction.keypoints);
						if (rawTilt) {
							headTilt.keypoints = rawTilt.keypoints;
							const smoothedTilt = headTiltSmoother.filter(rawTilt, performance.now() / 1000);
							headTilt.pitch = smoothedTilt.pitch;
							headTilt.yaw = smoothedTilt.yaw;
							headTilt.roll = smoothedTilt.roll;
						}

						// Gesture detectors live in core/src/gestures (EAR / MAR / brow with hysteresis).

						const prevMouthOpen = mouthInfo?.thresholdMet;

						// Gesture detection (core/src/gestures — same math as before, pinned by tests).
						const thresholds = gestureThresholds();
						blinkInfo = VM.detectBlinks(annotations, blinkInfo, performance.now(), thresholds.eye);
						mouthInfo = VM.detectMouthOpen(annotations, mouthInfo, thresholds.mouth);
						foreheadInfo = VM.detectForeheadRaised(annotations, foreheadInfo, thresholds.brow);

						const now = performance.now();
						const gestureDt = Math.min(now - lastForeheadTimestamp, 200);
						lastForeheadTimestamp = now;

						// Raise eyebrows ~3 s: open the on-screen keyboard.
						const eyebrowStep = VM.stepEyebrowHold({
							progress: eyebrowGestureProgress,
							cooldownUntil: eyebrowGestureCooldownUntil,
							raised: foreheadInfo.thresholdMet,
							allowed: s.eyebrowRaiseOpensKeyboard !== false,
							now,
							dt: gestureDt,
							duration: eyebrowGestureDuration,
						});
						eyebrowGestureProgress = eyebrowStep.progress;
						eyebrowGestureCooldownUntil = eyebrowStep.cooldownUntil;
						if (eyebrowStep.completed) {
							console.log("Forehead 3-second hold completed: Opening On-Screen Keyboard");
							emitEngine("gesture", { gesture: "brow", action: "KEYBOARD" });
							Vision.openOnScreenKeyboard();
						}

						// Close both eyes ~2 s: toggle pause (if enabled).
						const sleepStep = VM.stepSleepHold({
							progress: sleepGestureProgress,
							bothClosed: !blinkInfo.rightEye.open && !blinkInfo.leftEye.open,
							dt: deltaTime,
							duration: sleepGestureEyesClosedDuration,
						});
						sleepGestureProgress = sleepStep.progress;
						if (sleepStep.completed && s.closeEyesToToggle) {
							paused = !paused;
							updatePaused();
							sleepSweep?.sleepModeWasToggled(paused);
							emitEngine("gesture", { gesture: "sleep", action: paused ? "PAUSE" : "RESUME" });
						}

						// Mouth open + head tilted up/down scrolls (setting mouthTiltScroll, default on).
						mouthScrollDirection = s.mouthTiltScroll === false ? 0 : VM.mouthScrollDirection(mouthInfo.thresholdMet, headTilt, s.headTiltPitchOffset);
						isMouthScrolling = mouthScrollDirection !== 0;
						if (isMouthScrolling) {
							window.electronAPI?.scrollMouse?.(mouthScrollDirection);
						}

						const arbitration = VM.resolveClickButton({
							clickingMode: s.clickingMode,
							blinkInfo,
							mouthInfo,
							prevMouthOpen,
							isMouthScrolling,
							mouseButtonUntilMouthCloses,
						});
						const clickButton = arbitration.clickButton;
						mouseButtonUntilMouthCloses = arbitration.mouseButtonUntilMouthCloses;

						const buttonNames = ["left", "middle", "right"];
						for (let buttonIndex = 0; buttonIndex < 3; buttonIndex++) {
							const buttonIsActive = clickButton === buttonIndex;
							if (buttonIsActive !== buttonStates[buttonNames[buttonIndex]]) {
								// Wait for confirmation of the button state change before playing SFX
								// but not before updating buttonStates, since we check that in this loop
								// to decide whether to call setMouseButtonState.
								// We don't want to send extraneous mouse button changes to the main process,
								// even if it does track button states itself. If nothing else it's wasted IPC.
								// That said, an argument could be made for updating lastMouseDownTime later
								// if the IPC is slow, to extend the time frame for making a simple click
								// rather than a drag.
								if (!setMouseButtonState) {
									console.warn("setMouseButtonState function not provided");
								} else {
									const maybeAPromise = setMouseButtonState(buttonIndex, buttonIsActive);
									const playSoundForButton = (changedButtonState) => {
										if (changedButtonState) {
											if (buttonIndex === 1) {
												playSound(buttonIsActive ? "middleClickPress" : "middleClickRelease", {
													volume: 4,
												});
											} else {
												playSound(buttonIsActive ? "clickPress" : "clickRelease", {
													playbackRate: buttonIndex === 0 ? 1 : buttonIndex === 2 ? 1.2 : 1.5,
												});
											}
										}
									};
									if (maybeAPromise instanceof Promise) {
										maybeAPromise.then(playSoundForButton);
									} else {
										playSoundForButton(maybeAPromise);
									}
								}
								buttonStates[buttonNames[buttonIndex]] = buttonIsActive;
								emitEngine("click", { button: buttonNames[buttonIndex], down: buttonIsActive, source: "gesture" });
								if (buttonIsActive) {
									lastMouseDownTime = performance.now();
								} else {
									// Limit "Delay Before Dragging" effect to the duration of a click.
									// TODO: consider how this affects releasing a mouse button if two are pressed (not currently possible)
									// TODO: rename variable, maybe change it to store a cool-down timer? but that would need more state management just for concept clarity
									lastMouseDownTime = -Infinity; // sorry, making this variable a misnomer
								}
							}
						}
					}, (err) => {
						console.error("[Vision] Facemesh estimation failed:", err);
						facemeshEstimating = false;
						facemeshFirstEstimation = false;
						handleTrackingLoss("facemesh-error");
					});
				}
			}
			pointTracker.update(imageData);
		}

		updateInputFeedback?.({
			headNotFound: !face && !facemeshPrediction,
			blinkInfo,
			mouthInfo,
			foreheadInfo,
			eyebrowGestureProgress,
		});

		if (facemeshPrediction) {
			ctx.fillStyle = "red";

			const bad = facemeshPrediction.faceInViewConfidence < faceInViewConfidenceThreshold;
			ctx.fillStyle = bad ? 'rgb(255,255,0)' : 'rgb(130,255,50)';
			if (!bad || pointTracker.pointCount < 3 || facemeshPrediction.faceInViewConfidence > pointsBasedOnFaceInViewConfidence + 0.05) {
				if (bad) {
					ctx.fillStyle = 'rgba(255,0,255)';
				}
				for (const { x, y } of facemeshPrediction.keypoints) {
					ctx.fillRect(x, y, 1, 1);
				}
			} else {
				if (update && useFacemesh) {
					pointsBasedOnFaceInViewConfidence -= 0.001;
				}
			}

			const keypoints = facemeshPrediction.keypoints;
			if (showDebugHeadTilt && keypoints) {
				const { top, bottom, left, right } = headTilt.keypoints;
				const nose = keypoints[1];

				if (top && bottom && left && right && nose) {

					const cx = nose.x;
					const cy = nose.y;
					const arrowLen = 100;

					ctx.save();
					ctx.translate(cx, cy);

					ctx.fillStyle = "cyan";
					ctx.font = "bold 20px monospace";
					ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
					ctx.lineWidth = 3;
					ctx.lineJoin = "round";

					const textX = 60;
					const textLineHeight = 25;
					const textYStart = -10;


					const headTiltRows = [
						{ label: t("debug.headTilt.pitch", { defaultValue: "Pitch:" }), value: `${(headTilt.pitch * 180 / Math.PI).toFixed(1)}°` },
						{ label: t("debug.headTilt.yaw", { defaultValue: "Yaw:" }), value: `${(headTilt.yaw * 180 / Math.PI).toFixed(1)}°` },
						{ label: t("debug.headTilt.roll", { defaultValue: "Roll:" }), value: `${(headTilt.roll * 180 / Math.PI).toFixed(1)}°` },
					];
					const labelWidths = headTiltRows.map(row => ctx.measureText(row.label).width);
					const maxLabelWidth = Math.max(...labelWidths);
					const valueColumnTemplate = "-180.0°";
					const maxValueWidth = ctx.measureText(valueColumnTemplate).width;
					const labelToValueGap = 10;
					const boxPadding = 10;
					const boxWidth = boxPadding * 2 + maxLabelWidth + labelToValueGap + maxValueWidth;
					const boxHeight = textLineHeight * headTiltRows.length;
					const valueColumnRightOffset = boxPadding + maxLabelWidth + labelToValueGap + maxValueWidth;

					// Calculate screen coordinates for the text box
					let screenX = s.mirror ? canvas.width - cx : cx;
					let screenY = cy;

					// Nominal position relative to head center
					let textScreenX = screenX + textX;
					let textScreenY = screenY + textYStart;

					// Clamp to canvas bounds
					textScreenX = Math.max(boxPadding, Math.min(canvas.width - boxWidth - boxPadding, textScreenX));
					textScreenY = Math.max(textLineHeight, Math.min(canvas.height - boxHeight + textLineHeight, textScreenY));

					ctx.save();
					if (s.mirror) {
						ctx.scale(-1, 1);
					}

					const screenNoseX = s.mirror ? canvas.width - cx : cx;
					const screenNoseY = cy;

					const dx = textScreenX - screenNoseX;
					const dy = textScreenY - screenNoseY;

					for (let i = 0; i < headTiltRows.length; i++) {
						const row = headTiltRows[i];
						const baselineY = dy + textLineHeight * (i + 1);
						const labelX = dx + boxPadding;
						const valueTextWidth = ctx.measureText(row.value).width;
						const valueRightX = dx + valueColumnRightOffset;
						const valueX = valueRightX - valueTextWidth;
						ctx.strokeText(row.label, labelX, baselineY);
						ctx.fillText(row.label, labelX, baselineY);
						ctx.strokeText(row.value, valueX, baselineY);
						ctx.fillText(row.value, valueX, baselineY);
					}

					ctx.restore();

					// Visualize head direction
					const vUp = { x: top.x - bottom.x, y: top.y - bottom.y, z: top.z - bottom.z }; // Up vector (Chin to Top)
					const vRight = { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z }; // Right vector (Right to Left)

					// Cross Product: Right x Up
					const vFwd = {
						x: vRight.y * vUp.z - vRight.z * vUp.y,
						y: vRight.z * vUp.x - vRight.x * vUp.z,
						z: vRight.x * vUp.y - vRight.y * vUp.x
					};

					const mag = Math.hypot(vFwd.x, vFwd.y, vFwd.z);
					if (mag > 0.001) {
						ctx.strokeStyle = "cyan";
						ctx.beginPath();
						ctx.moveTo(0, 0);
						const s = arrowLen / mag;
						ctx.lineTo(vFwd.x * s, vFwd.y * s);
						ctx.stroke();

						ctx.fillStyle = "cyan";
						ctx.beginPath();
						ctx.arc(vFwd.x * s, vFwd.y * s, 5, 0, Math.PI * 2);
						ctx.fill();
					}

					ctx.restore();
				}
			}
		}

		const drawAspectMetrics = ({ corners, lowest, highest, active, thresholdMet }) => {
			const [a, b] = corners;
			ctx.strokeStyle = active ? "red" : thresholdMet ? "yellow" : "cyan";
			ctx.beginPath();
			ctx.moveTo(a[0], a[1]);
			ctx.lineTo(b[0], b[1]);
			ctx.stroke();
			// draw extents as a rectangle
			ctx.save();
			ctx.translate(a[0], a[1]);
			ctx.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
			ctx.beginPath();
			ctx.rect(0, lowest, Math.hypot(b[0] - a[0], b[1] - a[1]), highest - lowest);
			ctx.stroke();
			ctx.restore();
		};

		if (blinkInfo?.used) {
			ctx.save();
			ctx.lineWidth = 2;
			drawAspectMetrics(blinkInfo.leftEye);
			drawAspectMetrics(blinkInfo.rightEye);

			if (showDebugEyeZoom) {
				debugEyeCanvas.style.display = "";
				const boxWidth = 150;
				const boxHeight = 100;

				if (debugEyeCanvas.width !== boxWidth * 2 || debugEyeCanvas.height !== boxHeight) {
					debugEyeCanvas.width = boxWidth * 2;
					debugEyeCanvas.height = boxHeight;
				}

				debugEyeCtx.fillStyle = "black";
				debugEyeCtx.fillRect(0, 0, debugEyeCanvas.width, debugEyeCanvas.height);
				debugEyeCtx.save();
				debugEyeCtx.translate(s.mirror ? debugEyeCanvas.width : 0, 0);
				debugEyeCtx.scale(s.mirror ? -1 : 1, 1);

				const zoom = 5;
				const drawDebugEye = (eye, offsetX) => {
					const points = [...eye.upperContour, ...eye.lowerContour];
					let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
					for (const [x, y] of points) {
						minX = Math.min(minX, x);
						minY = Math.min(minY, y);
						maxX = Math.max(maxX, x);
						maxY = Math.max(maxY, y);
					}
					const cx = (minX + maxX) / 2;
					const cy = (minY + maxY) / 2;

					const sw = boxWidth / zoom;
					const sh = boxHeight / zoom;
					const sx = cx - sw / 2;
					const sy = cy - sh / 2;

					debugEyeCtx.drawImage(cameraVideo, sx, sy, sw, sh, offsetX, 0, boxWidth, boxHeight);

					debugEyeCtx.save();
					debugEyeCtx.beginPath();
					debugEyeCtx.rect(offsetX, 0, boxWidth, boxHeight);
					debugEyeCtx.clip();

					debugEyeCtx.translate(offsetX, 0);
					debugEyeCtx.scale(zoom, zoom);
					debugEyeCtx.translate(-sx, -sy);

					debugEyeCtx.lineWidth = 1 / zoom * 2;
					debugEyeCtx.strokeStyle = "lime";

					for (const contour of [eye.upperContour, eye.lowerContour]) {
						debugEyeCtx.beginPath();
						for (let i = 0; i < contour.length; i++) {
							const [x, y] = contour[i];
							if (i === 0) debugEyeCtx.moveTo(x, y);
							else debugEyeCtx.lineTo(x, y);
						}
						debugEyeCtx.stroke();
					}
					debugEyeCtx.restore();
				};

				drawDebugEye(blinkInfo.rightEye, 0);
				drawDebugEye(blinkInfo.leftEye, boxWidth);

				debugEyeCtx.restore();
			} else {
				debugEyeCanvas.style.display = "none";
			}
			ctx.restore();
		}
		if (mouthInfo?.used) {
			ctx.save();
			ctx.lineWidth = 2;
			drawAspectMetrics(mouthInfo);
			ctx.restore();
		}


		if (face) {
			const bad = faceScore < faceScoreThreshold;
			ctx.strokeStyle = bad ? 'rgb(255,255,0)' : 'rgb(130,255,50)';
			if (!bad || pointTracker.pointCount < 2 || faceScore > pointsBasedOnFaceScore + 0.05) {
				if (bad) {
					ctx.strokeStyle = 'rgba(255,0,255)';
				}
				if (update && useClmTracking) {
					pointsBasedOnFaceScore = faceScore;

					// nostrils
					maybeAddPoint(pointTracker, face[42][0], face[42][1]);
					maybeAddPoint(pointTracker, face[43][0], face[43][1]);
					// inner eye corners
					// maybeAddPoint(pointTracker, face[25][0], face[25][1]);
					// maybeAddPoint(pointTracker, face[30][0], face[30][1]);

					// TODO: separate confidence threshold for removing vs adding points?

					// cull points to those within useful facial region
					pointTracker.filterPoints((pointIndex) => {
						let pointOffset = pointIndex * 2;
						// distance from tip of nose (stretched so make an ellipse taller than wide)
						let distance = Math.hypot(
							(face[62][0] - pointTracker.curXY[pointOffset]) * 1.4,
							face[62][1] - pointTracker.curXY[pointOffset + 1]
						);
						// distance based on outer eye corners
						let headSize = Math.hypot(
							face[23][0] - face[28][0],
							face[23][1] - face[28][1]
						);
						if (distance > headSize) {
							return false;
						}
						return true;
					});
				}
			} else {
				if (update && useClmTracking) {
					pointsBasedOnFaceScore -= 0.001;
				}
			}
			if (showClmTracking) {
				clmTracker.draw(canvas, undefined, undefined, true);
			}
		}
		ctx.fillStyle = "lime";
		pointTracker.draw(ctx);
		debugPointsCtx.fillStyle = "green";
		pointTracker.draw(debugPointsCtx);

		if (update) {
			const screenWidth = window.electronAPI ? (virtualDisplayBounds?.width ?? screen.width) : innerWidth;
			const screenHeight = window.electronAPI ? (virtualDisplayBounds?.height ?? screen.height) : innerHeight;
			const screenOffsetX = window.electronAPI ? (virtualDisplayBounds?.x ?? 0) : 0;
			const screenOffsetY = window.electronAPI ? (virtualDisplayBounds?.y ?? 0) : 0;

			let [movementX, movementY] = pointTracker.getMovement();
			lastMovement[0] = movementX;
			lastMovement[1] = movementY;

			const hasValidFace = Boolean(
				(useFacemesh && facemeshPrediction) ||
				(useClmTracking && face && faceScore >= faceScoreThreshold)
			);

			if (!hasValidFace) {
				movementX = 0;
				movementY = 0;
				handleTrackingLoss("no-valid-face");
			}

			// Acceleration curve, optional head-tilt influence, motion threshold and drag delay.
			// (core/src/tracking/cursor-motion.js — same math as before, pinned by tests.)
			const timeSinceMouseDown = performance.now() - lastMouseDownTime;
			let { deltaX, deltaY } = VM.computeCursorDelta({ movementX, movementY, s, headTilt, mouseX, mouseY, screenWidth, screenHeight, timeSinceMouseDown });
			const accelerate = (delta) => VM.accelerate(delta, s.headTrackingAcceleration);

			if (debugAcceleration) {
				const graphWidth = 200;
				const graphHeight = 150;
				const graphMaxInput = 0.2;
				const graphMaxOutput = 0.4;
				const highlightInputRange = 0.01;
				ctx.save();
				ctx.fillStyle = "black";
				ctx.fillRect(0, 0, graphWidth, graphHeight);
				const highlightInput = movementX * s.headTrackingSensitivityX;
				for (let x = 0; x < graphWidth; x++) {
					const input = x / graphWidth * graphMaxInput;
					const output = accelerate(input, input);
					const y = output / graphMaxOutput * graphHeight;
					// ctx.fillStyle = Math.abs(y - deltaX) < 1 ? "yellow" : "lime";
					const highlight = Math.abs(Math.abs(input) - Math.abs(highlightInput)) < highlightInputRange;
					if (highlight) {
						ctx.fillStyle = "rgba(255, 255, 0, 0.3)";
						ctx.fillRect(x, 0, 1, graphHeight);
					}
					ctx.fillStyle = highlight ? "yellow" : "lime";
					ctx.fillRect(x, graphHeight - y, 1, y);
				}
				ctx.restore();
			}

			// This should never happen
			if (!isFinite(deltaX) || !isFinite(deltaY)) {
				return;
			}

			if (!paused) {
				mouseX -= deltaX * screenWidth;
				mouseY += deltaY * screenHeight;

				mouseX = Math.min(Math.max(screenOffsetX, mouseX), screenOffsetX + screenWidth);
				mouseY = Math.min(Math.max(screenOffsetY, mouseY), screenOffsetY + screenHeight);

				if (mouseNeedsInitPos) {
					// TODO: option to get preexisting mouse position instead of set it to center of screen
					mouseX = screenOffsetX + screenWidth / 2;
					mouseY = screenOffsetY + screenHeight / 2;
					mouseNeedsInitPos = false;
				}
				if (window.electronAPI) {
					window.electronAPI.moveMouse(~~mouseX, ~~mouseY);
					pointerEl.style.display = "none";
				} else {
					pointerEl.style.display = "";
					pointerEl.style.left = `${Math.floor(mouseX)}px`;
					pointerEl.style.top = `${Math.floor(mouseY)}px`;
				}
				if (Vision.onPointerMove) {
					Vision.onPointerMove(mouseX, mouseY);
				}
			}
		}
		ctx.restore();

		if (showDebugText) {
			ctx.save();
			ctx.fillStyle = "#fff";
			ctx.strokeStyle = "#000";
			ctx.lineWidth = 3;
			ctx.font = "20px sans-serif";
			ctx.beginPath();
			const text3 = `${t("debug.faceConvergenceScore", { defaultValue: "Face convergence score:" })} ${((useFacemesh && facemeshPrediction) ? t("common.notApplicable", { defaultValue: "N/A" }) : faceConvergence.toFixed(4))}`;
			const text1 = `${t("debug.faceTrackingScore", { defaultValue: "Face tracking score:" })} ${((useFacemesh && facemeshPrediction) ? facemeshPrediction.faceInViewConfidence : faceScore).toFixed(4)}`;
			const text2 = `${t("debug.pointsBasedOnScore", { defaultValue: "Points based on score:" })} ${((useFacemesh && facemeshPrediction) ? pointsBasedOnFaceInViewConfidence : pointsBasedOnFaceScore).toFixed(4)}`;
			ctx.strokeText(text1, 50, 50);
			ctx.fillText(text1, 50, 50);
			ctx.strokeText(text2, 50, 70);
			ctx.fillText(text2, 50, 70);
			ctx.strokeText(text3, 50, 170);
			ctx.fillText(text3, 50, 170);
			ctx.fillStyle = "lime";
			ctx.fillRect(0, 150, faceConvergence, 5);
			ctx.fillRect(0, 0, faceScore * canvas.width, 5);
			ctx.restore();
		}

		// Real-Time System Telemetry & Action Word HUD updates
		const currentFps = deltaTime > 0 ? (1000 / deltaTime) : 0;
		smoothedFPS = smoothedFPS === 0 ? currentFps : (smoothedFPS * 0.92 + currentFps * 0.08);

		if (telemetryFpsEl) {
			telemetryFpsEl.textContent = `${Math.round(smoothedFPS)} FPS`;
		}
		if (telemetryPointsEl) {
			telemetryPointsEl.textContent = `${pointTracker?.pointCount ?? 0} PTS`;
		}
		if (telemetryPoseEl) {
			const yawDeg = Math.round((headTilt?.yaw ?? 0) * 180 / Math.PI);
			const pitchDeg = Math.round((headTilt?.pitch ?? 0) * 180 / Math.PI);
			telemetryPoseEl.textContent = `Y: ${yawDeg > 0 ? '+' : ''}${yawDeg}° P: ${pitchDeg > 0 ? '+' : ''}${pitchDeg}°`;
		}
		if (telemetryModeEl) {
			const modeNames = {
				"blink": "Wink to Click",
				"open-mouth": "Mouth + Modifiers",
				"open-mouth-simple": "Open Mouth (Simple)",
				"open-mouth-ignoring-eyes": "Open Mouth",
				"dwell": "Dwell to Click",
				"off": "Disabled"
			};
			telemetryModeEl.textContent = modeNames[s.clickingMode] || s.clickingMode || "Active";
		}
		if (telemetryStatusEl) {
			telemetryStatusEl.textContent = paused ? "STANDBY" : "ACTIVE";
			telemetryStatusEl.classList.toggle("status-active", !paused);
			telemetryStatusEl.classList.toggle("status-paused", paused);
		}

		if (activeActionWordEl && activeActionDescEl) {
			const now = performance.now();
			if (paused) {
				activeActionWordEl.textContent = "STANDBY / PAUSED";
				activeActionDescEl.textContent = "PRESS F9 OR CLICK START TO RESUME";
				actionWordContainerEl?.classList.remove("action-triggered");
			} else if (!face && !facemeshPrediction) {
				activeActionWordEl.textContent = "SEARCHING FOR FACE";
				activeActionDescEl.textContent = "POSITION HEAD IN CAMERA FRAME";
				actionWordContainerEl?.classList.remove("action-triggered");
			} else if (eyebrowGestureProgress > 0.08) {
				activeActionWordEl.textContent = "FOREHEAD RAISED";
				activeActionDescEl.textContent = `OPENING KEYBOARD (${Math.round(eyebrowGestureProgress * 100)}%)`;
				actionWordContainerEl?.classList.add("action-triggered");
			} else if (now < eyebrowGestureCooldownUntil && (eyebrowGestureCooldownUntil - now) > 1000) {
				activeActionWordEl.textContent = "KEYBOARD OPENED";
				activeActionDescEl.textContent = "BUILT-IN ON-SCREEN KEYBOARD LAUNCHED";
				actionWordContainerEl?.classList.add("action-triggered");
			} else if (blinkInfo?.leftEye?.active) {
				activeActionWordEl.textContent = "WINK LEFT";
				activeActionDescEl.textContent = "TRIGGER: LEFT CLICK ACTION";
				actionWordContainerEl?.classList.add("action-triggered");
			} else if (blinkInfo?.rightEye?.active) {
				activeActionWordEl.textContent = "WINK RIGHT";
				activeActionDescEl.textContent = "TRIGGER: RIGHT CLICK / CONTEXT";
				actionWordContainerEl?.classList.add("action-triggered");
			} else if (blinkInfo && !blinkInfo.leftEye?.open && !blinkInfo.rightEye?.open && sleepGestureProgress > 0.25) {
				activeActionWordEl.textContent = "BLINK HOLD";
				activeActionDescEl.textContent = `HOLD TO TOGGLE STATE (${Math.round(sleepGestureProgress * 100)}%)`;
				actionWordContainerEl?.classList.add("action-triggered");
			} else if (isMouthScrolling) {
				const dirLabel = mouthScrollDirection === -1 ? "SCROLLING UP" : "SCROLLING DOWN";
				activeActionWordEl.textContent = dirLabel;
				activeActionDescEl.textContent = mouthScrollDirection === -1 ? "MOUTH OPEN + HEAD TILT UP" : "MOUTH OPEN + HEAD TILT DOWN";
				actionWordContainerEl?.classList.add("action-triggered");
			} else if (mouthInfo?.thresholdMet) {
				if (s.clickingMode === "open-mouth") {
					const btn = mouseButtonUntilMouthCloses;
					const btnLabel = btn === 1 ? "MIDDLE CLICK (SCROLL)" : btn === 2 ? "RIGHT CLICK (CONTEXT)" : "PRIMARY LEFT CLICK";
					activeActionWordEl.textContent = "MOUTH OPEN";
					activeActionDescEl.textContent = `TRIGGER: ${btnLabel} (TILT HEAD UP/DOWN TO SCROLL)`;
				} else {
					activeActionWordEl.textContent = "MOUTH OPEN";
					activeActionDescEl.textContent = "TRIGGER: PRIMARY LEFT CLICK / DRAG (TILT HEAD UP/DOWN TO SCROLL)";
				}
				actionWordContainerEl?.classList.add("action-triggered");
			} else if (headTilt && Math.abs(headTilt.yaw * 180 / Math.PI) > 16) {
				const yawDeg = Math.round(headTilt.yaw * 180 / Math.PI);
				activeActionWordEl.textContent = `HEAD TILT ${yawDeg > 0 ? "RIGHT" : "LEFT"}`;
				activeActionDescEl.textContent = `ORIENTATION: ${Math.abs(yawDeg)}° ROTATION`;
				actionWordContainerEl?.classList.add("action-triggered");
			} else if (headTilt && Math.abs(headTilt.pitch * 180 / Math.PI) > 16) {
				const pitchDeg = Math.round(headTilt.pitch * 180 / Math.PI);
				activeActionWordEl.textContent = `HEAD TILT ${pitchDeg > 0 ? "UP" : "DOWN"}`;
				activeActionDescEl.textContent = `ORIENTATION: ${Math.abs(pitchDeg)}° ELEVATION`;
				actionWordContainerEl?.classList.add("action-triggered");
			} else {
				activeActionWordEl.textContent = "NEUTRAL / TRACKING";
				const modeTips = {
					"blink": "PROFILE: WINK L = LEFT CLICK • WINK R = RIGHT CLICK • TILT = SCROLL",
					"open-mouth-simple": "PROFILE: DROP JAW ('O' SHAPE) TO LEFT CLICK & DRAG",
					"open-mouth": "PROFILE: MOUTH = LEFT CLICK • MOUTH + WINK L/R = RIGHT/MID CLICK",
					"dwell": "PROFILE: HOLD CURSOR STEADY TO AUTO-CLICK",
					"open-mouth-ignoring-eyes": "PROFILE: OPEN MOUTH TO CLICK & HOLD",
					"off": "PROFILE: HEAD MOTION ONLY (CLICKING DISABLED)",
				};
				activeActionDescEl.textContent = modeTips[s.clickingMode] || "CONTINUOUS OPTICAL FLOW ACTIVE";
				actionWordContainerEl?.classList.remove("action-triggered");
			}
		}

		stats?.update();
	}

	// ---- Engine API (state / frame / settings) ----------------------------------------
	let facemeshHz = 0;
	let lastFacemeshEstimateTime = performance.now();
	const lastMovement = [0, 0];
	let brightnessFrameCounter = 0;
	let frameBrightness = NaN;
	let lastStatePublish = 0;
	const previousGestureActive = {};
	const MESH_CONTOURS = ["silhouette", "leftEyeUpper0", "leftEyeLower0", "rightEyeUpper0", "rightEyeLower0", "lipsUpperInner", "lipsLowerInner", "leftEyebrowUpper", "rightEyebrowUpper"];

	function isFaceFound() {
		return Boolean(facemeshPrediction) || Boolean(useClmTracking && face && faceScore >= faceScoreThreshold);
	}

	function activeGestures() {
		const active = [];
		if (blinkInfo?.leftEye?.active) active.push("leftWink");
		if (blinkInfo?.rightEye?.active) active.push("rightWink");
		if (mouthInfo?.thresholdMet) active.push("mouth");
		if (foreheadInfo?.thresholdMet) active.push("brow");
		if (blinkInfo && !blinkInfo.leftEye?.open && !blinkInfo.rightEye?.open) active.push("sleep");
		return active;
	}

	function getEngineState() {
		const faceFound = isFaceFound();
		const cameraOn = Boolean(cameraVideo.srcObject) && cameraVideo.readyState >= 2;
		const cameraStatus = cameraOn ? "on" : lastCameraError ? "error" : cameraVideo.srcObject ? "starting" : "off";
		const status =
			cameraStatus === "error" ? "camera-error" :
				cameraStatus !== "on" ? "starting" :
					paused ? "paused" :
						faceFound ? "tracking" : "no-face";
		const box = facemeshPrediction ? VM.faceBox(facemeshPrediction) : null;
		const framing = VM.assessFraming({
			faceFound,
			brightness: frameBrightness,
			faceBox: box,
			frameWidth: canvas.width,
			frameHeight: canvas.height,
		});
		const eye = (info) => info ? { ratio: info.heightRatio, open: Boolean(info.open), active: Boolean(info.active) } : null;
		return {
			status,
			paused,
			fps: Math.round(smoothedFPS * 10) / 10,
			facemeshHz: Math.round(facemeshHz * 10) / 10,
			faceFound,
			tracker: facemeshPrediction ? "facemesh" : (useClmTracking ? "clmtrackr" : "facemesh"),
			points: pointTracker?.pointCount ?? 0,
			pose: {
				yaw: VM.radToDeg(headTilt.yaw || 0),
				pitch: VM.radToDeg(headTilt.pitch || 0),
				roll: VM.radToDeg(headTilt.roll || 0),
			},
			gestures: {
				leftEye: eye(blinkInfo?.leftEye),
				rightEye: eye(blinkInfo?.rightEye),
				mouth: mouthInfo ? { ratio: mouthInfo.heightRatio, open: Boolean(mouthInfo.thresholdMet), active: Boolean(mouthInfo.active) } : null,
				brow: foreheadInfo ? { ratio: foreheadInfo.avgRatio, raised: Boolean(foreheadInfo.thresholdMet), progress: eyebrowGestureProgress } : null,
				sleep: { progress: sleepGestureProgress, enabled: Boolean(s.closeEyesToToggle) },
				scroll: mouthScrollDirection,
				thresholds: gestureThresholds(),
				bindings: VM.gestureBindings(s),
				active: activeGestures(),
			},
			buttons: { ...buttonStates },
			cursor: { x: mouseX, y: mouseY },
			clickingMode: s.clickingMode,
			camera: {
				status: cameraStatus,
				error: lastCameraError ? { name: lastCameraError.name, message: lastCameraError.message } : null,
				width: canvas.width,
				height: canvas.height,
			},
			framing,
			lastError: lastShownErrorDetails && !errorMessage.hidden ? { message: lastShownErrorDetails.message } : null,
		};
	}

	function publishEngineState() {
		if (!_emitEngineEvent) {
			return;
		}
		// Rising edges of gestures (checked every frame, so short gestures are not missed).
		const active = activeGestures();
		let bindings = null;
		for (const gesture of VM.GESTURES) {
			const isActive = active.includes(gesture);
			if (isActive && !previousGestureActive[gesture]) {
				bindings ??= VM.gestureBindings(s);
				emitEngine("gesture", { gesture, action: bindings[gesture], phase: "start" });
			}
			previousGestureActive[gesture] = isActive;
		}
		const now = performance.now();
		if (now - lastStatePublish >= 50) {
			lastStatePublish = now;
			emitEngine("state", getEngineState());
		}
	}

	/** Data for drawing a viewfinder: tracked points, face contours, nose anchor, motion (camera pixels, unmirrored). */
	function getEngineFrame() {
		const count = pointTracker?.pointCount ?? 0;
		const contours = {};
		let nose = null;
		if (facemeshPrediction?.keypoints) {
			const keypoints = facemeshPrediction.keypoints;
			for (const name of MESH_CONTOURS) {
				contours[name] = MESH_ANNOTATIONS[name].map((index) => keypoints[index] ? [keypoints[index].x, keypoints[index].y] : null).filter(Boolean);
			}
			const tip = keypoints[1];
			nose = tip ? [tip.x, tip.y] : null;
		}
		return {
			width: canvas.width,
			height: canvas.height,
			mirror: Boolean(s.mirror),
			pointCount: count,
			points: pointTracker ? pointTracker.curXY.slice(0, count * 2) : new Float32Array(0),
			contours,
			nose,
			motion: [lastMovement[0], lastMovement[1]],
			faceBox: facemeshPrediction ? VM.faceBox(facemeshPrediction) : null,
		};
	}

	const engineSettingsApi = {
		get: (key) => s[key],
		getAll: () => ({ ...s }),
		has: (key) => settingsByKey.has(key),
		set(key, value) {
			const setting = settingsByKey.get(key);
			if (!setting) {
				throw new Error(`Unknown setting: ${key}`);
			}
			setting._set(value);
		},
		/** Metadata in SETTING units (sliders convert from their input units). */
		describe(key) {
			const setting = settingsByKey.get(key);
			if (!setting) {
				return null;
			}
			const toSetting = setting.inputValueToSettingValue ?? ((x) => x);
			return {
				key,
				type: setting.type,
				label: setting.label,
				description: setting.description,
				min: setting.min !== undefined ? toSetting(setting.min) : undefined,
				max: setting.max !== undefined ? toSetting(setting.max) : undefined,
				default: setting.default !== undefined ? toSetting(setting.default) : undefined,
				options: setting.options?.map(({ value, label }) => ({ value, label })),
				visible: setting.visible ? setting.visible() !== false : true,
			};
		},
		keys: () => [...settingsByKey.keys()],
	};

	function circle(ctx, x, y, r) {
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
	}

	// Can't use requestAnimationFrame, doesn't work with webPreferences.backgroundThrottling: false (at least in some version of Electron (v12 I think, when I tested it), on Ubuntu, with XFCE)
	const iid = setInterval(function animationLoop() {
		try {
			draw(!paused || document.visibilityState === "visible" || isDesktopApp);
			// Engine API events (also before the camera is up, so the UI sees "starting").
			publishEngineState();
		} catch (drawErr) {
			console.error("[Vision] Unhandled exception in animationLoop:", drawErr);
			handleTrackingLoss("draw-exception");
		}
	}, 15);

	let autoDemo = false;
	try {
		autoDemo = localStorage.VisionAutoDemo === "true";
	} catch (_error) {
		// ignore; this is just for development
	}
	if (autoDemo) {
		Vision.useDemoFootage();
	} else if (window.electronAPI) {
		Vision.useCamera();
	} else {
		// Passively querying the camera permission isn't supported in all browsers,
		// hence some of the complex logic in useCamera, but when it is,
		// we can connect to the camera right away if the permission is already granted.
		// This speeds up the development cycle, at the very least.
		navigator.permissions?.query?.({ name: "camera" }).then((status) => {
			if (status.state === "granted") {
				Vision.useCamera();
			}
		}, (error) => {
			console.log("Error querying permissions:", error);
		});
	}

	const updateStartStopButton = () => {
		if (paused) {
			startStopButton.textContent = t("ui.startStopButton.start", { defaultValue: "Start Tracking" });
			startStopButton.setAttribute("aria-pressed", "false");
			startStopButton.classList.remove("tracking-active");
		} else {
			startStopButton.textContent = t("ui.startStopButton.stop", { defaultValue: "Stop Tracking" });
			startStopButton.setAttribute("aria-pressed", "true");
			startStopButton.classList.add("tracking-active");
		}
		const dot = document.getElementById("system-status-indicator");
		if (dot) {
			dot.style.backgroundColor = paused ? "#d29922" : "#3fb950";
		}
	};
	const updatePaused = () => {
		mouseNeedsInitPos = true;
		if (paused) {
			pointerEl.style.display = "none";
			handleTrackingLoss("tracking-paused");
		}
		updateStartStopButton();
		notifyToggleState?.(!paused);
	};
	const handleShortcut = (shortcutType) => {
		if (shortcutType === "toggle-tracking") {
			paused = !paused;
			updatePaused();
		}
	};
	settingsLoadedPromise.then(updatePaused);

	// Try to handle both the global and local shortcuts
	// If the global shortcut successfully registered, keydown shouldn't occur for the shortcut, right?
	// I hope there's no cross-platform issue with this.
	let removeShortcutListener = null;
	if (window.electronAPI) {
		removeShortcutListener = window.electronAPI.onShortcut(handleShortcut);
	}
	const handleKeydown = (event) => {
		// Same shortcut as the global shortcut in the electron app
		if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === "F9") {
			handleShortcut("toggle-tracking");
		}
	};
	addEventListener("keydown", handleKeydown);

	return {
		_element: uiContainer,
		_setPaused(value) {
			paused = value;
			updatePaused();
		},
		_getPaused() {
			return paused;
		},
		_getEngineState: () => getEngineState(),
		_getEngineFrame: () => getEngineFrame(),
		_settingsApi: engineSettingsApi,
		_useCamera: () => Vision.useCamera(),
		_waitForSettingsLoaded() {
			return settingsLoadedPromise;
		},
		get _facemeshPrediction() {
			return facemeshPrediction;
		},
		get _headTilt() {
			return headTilt;
		},
		get _video() {
			return cameraVideo;
		},
		get _cameraError() {
			return lastCameraError;
		},
		dispose() {
			// TODO: re-structure so that cleanup can succeed even if initialization fails
			// OOP would help with this, by storing references in an object, but it doesn't necessarily
			// need to be converted to a class, it could just be an object, with a try-finally used for returning the API with a `dispose` method.
			// Wouldn't need to change the API that way.
			// (Would also be easy to maintain backwards compatibility while switching to using a class,
			// returning an instance of the class from `Vision.init` but deprecating it in favor of constructing the class.)

			clearInterval(iid);

			// Fail-safe release of any held mouse buttons
			handleTrackingLoss("vision-disposed");

			// stopping camera stream is important, not sure about other resetting
			reset();

			// just in case there's any async code looking at whether it's paused
			paused = true;

			if (detector) {
				try {
					detector.dispose();
				} catch (err) {
					console.warn("[Vision] Error disposing detector:", err);
				}
				detector = null;
			}
			if (clmTracker) {
				try {
					clmTracker.reset();
				} catch (err) {
					console.warn("[Vision] Error resetting clmTracker:", err);
				}
			}

			pointerEl.remove();

			stats?.domElement.remove(); // there is no dispose method but this may be all that it would need to do https://github.com/mrdoob/stats.js/pull/96

			removeEventListener("keydown", handleKeydown);

			removeShortcutListener?.();

			// This is a little awkward, reversing the initialization based on a possibly-preexisting element
			// Could save and restore innerHTML but that won't restore event listeners, references, etc.
			// and may not even be desired if the HTML was placeholder text mentioning it not yet being initialized for example.
			uiContainer.classList.remove("vision-ui");
			uiContainer.innerHTML = "";
			if (!div) {
				uiContainer.remove();
			}
		},
	};
};

// Wrapper that manages an inner instance and recreates it when the language is changed.
Vision.init = function (div, opts = {}) {
	let inner = null;

	// UI state saving could be cleaner as part of the inner instance idk
	// Or, you know, ideally we update the UI text reactively without
	// stopping/starting the camera stream etc. when switching languages.
	const saveUIState = () => {
		const paused = inner._getPaused();
		const collapsibles = inner._element.querySelectorAll("details");
		const openStates = Array.from(collapsibles).map(c => c.open);
		const scrollables = inner._element.querySelectorAll("*");
		const scrollPositions = Array.from(scrollables).map(s => [s.scrollLeft, s.scrollTop]);
		const focusedElementSelector = Array.from(document.activeElement?.classList || []).map(c => `.${c}`).join("");
		return { paused, openStates, scrollPositions, focusedElementSelector };
	};
	const restoreUIState = ({ paused, openStates, scrollPositions, focusedElementSelector }) => {
		inner._waitForSettingsLoaded().then(() => {
			inner._setPaused(paused);
		});
		// assuming DOM structure doesn't change
		const collapsibles = inner._element.querySelectorAll("details");
		for (let i = 0; i < collapsibles.length; i++) {
			collapsibles[i].open = openStates[i];
		}
		const scrollables = inner._element.querySelectorAll("*");
		for (let i = 0; i < scrollables.length; i++) {
			const [scrollLeft, scrollTop] = scrollPositions[i];
			scrollables[i].scrollLeft = scrollLeft;
			scrollables[i].scrollTop = scrollTop;
		}
		if (focusedElementSelector) {
			const elementToFocus = inner._element.querySelector(focusedElementSelector);
			elementToFocus?.focus();
		}
	};
	const reinit = () => {
		const uiState = saveUIState();
		inner.dispose();
		createInner();
		restoreUIState(uiState);
	};

	const createInner = () => {
		inner = Vision._initInner(div, opts, reinit);
	};

	createInner();

	return new Proxy({}, {
		get(_target, prop) {
			if (prop in inner) {
				return inner[prop];
			}
		}
	});

};

/**
 * Starts the tracking engine WITHOUT the legacy UI and returns a small, stable API.
 * This is the only surface the new desktop UI talks to.
 *
 *   const engine = Vision.initEngine();
 *   engine.getState()   // { status, fps, faceFound, pose:{yaw,pitch,roll}, gestures:{...}, cursor, paused, camera, framing, ... }
 *   engine.getFrame()   // tracked points, face contours, nose anchor, motion (for drawing a viewfinder)
 *   engine.getVideoStream()
 *   engine.on("state" | "gesture" | "click" | "error" | "camera" | "settings" | "toast", callback) // returns unsubscribe
 *   engine.settings.get(key) / set(key, value) / getAll() / describe(key)
 *   engine.setPaused(bool) / togglePaused() / useCamera() / openOnScreenKeyboard()
 *
 * The engine survives language changes (the inner instance is rebuilt; listeners stay).
 * Seam for later: this object could be mirrored over IPC (e.g. for the VISION voice assistant).
 */
Vision.initEngine = function (opts = {}) {
	if (!Vision.modules) {
		throw new Error("VISION core modules are not loaded. Call `await Vision.loadCoreModules()` before Vision.initEngine().");
	}
	const emitter = Vision.modules.createEmitter();
	// The engine still keeps its (hidden) legacy controls as its settings store.
	const host = document.createElement("div");
	host.className = "vision-engine-host";
	host.hidden = true;
	host.setAttribute("aria-hidden", "true");
	document.body.appendChild(host);

	const instance = Vision.init(host, {
		...opts,
		headless: true,
		_emitEngineEvent: (type, payload) => emitter.emit(type, payload),
	});

	const engine = {
		getState: () => instance._getEngineState(),
		getFrame: () => instance._getEngineFrame(),
		getVideoStream: () => {
			const source = instance._video?.srcObject;
			return source instanceof MediaStream ? source : null;
		},
		on: (type, callback) => emitter.on(type, callback),
		off: (type, callback) => emitter.off(type, callback),
		settings: {
			get: (key) => instance._settingsApi.get(key),
			getAll: () => instance._settingsApi.getAll(),
			has: (key) => instance._settingsApi.has(key),
			set: (key, value) => instance._settingsApi.set(key, value),
			describe: (key) => instance._settingsApi.describe(key),
			keys: () => instance._settingsApi.keys(),
		},
		isPaused: () => instance._getPaused(),
		// No-op when unchanged (re-applying would also re-centre the cursor).
		setPaused: (value) => {
			if (instance._getPaused() !== Boolean(value)) {
				instance._setPaused(Boolean(value));
			}
		},
		togglePaused: () => instance._setPaused(!instance._getPaused()),
		useCamera: () => instance._useCamera(),
		openOnScreenKeyboard: () => Vision.openOnScreenKeyboard(),
		ready: () => instance._waitForSettingsLoaded(),
		dispose: () => {
			instance.dispose();
			host.remove();
		},
	};
	return engine;
};

// CommonJS export is untested. Script tag usage recommended.
// Just including this in case it is somehow useful.
// eslint-disable-next-line no-undef
if (typeof module !== "undefined" && module.exports) {
	// eslint-disable-next-line no-undef
	module.exports = Vision;
}
