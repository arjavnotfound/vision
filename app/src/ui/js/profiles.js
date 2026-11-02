// Profiles: named snapshots of the settings that describe a person (sensitivity, click
// method, calibration). Stored in the engine's own settings ("profiles" JSON + "activeProfile"),
// so they persist in the same settings file.

export const PROFILE_KEYS = [
	"headTrackingSensitivityX",
	"headTrackingSensitivityY",
	"headTrackingAcceleration",
	"headTrackingTiltInfluence",
	"headTrackingMinDistance",
	"headTiltYawOffset",
	"headTiltPitchOffset",
	"headTiltYawRange",
	"headTiltPitchRange",
	"clickingMode",
	"delayBeforeDragging",
	"dwellTime",
	"dwellDrag",
	"mouthTiltScroll",
	"closeEyesToToggle",
	"eyebrowRaiseOpensKeyboard",
	"eyeThresholdHigh",
	"eyeThresholdLow",
	"mouthThresholdHigh",
	"mouthThresholdLow",
	"browThresholdHigh",
	"browThresholdLow",
];

export function createProfiles(settings) {
	const read = () => {
		try {
			const list = JSON.parse(settings.get("profiles") || "[]");
			return Array.isArray(list) ? list.filter((p) => p && typeof p.name === "string") : [];
		} catch (_error) {
			return [];
		}
	};
	const write = (list) => settings.set("profiles", JSON.stringify(list));
	const snapshot = () => {
		const values = {};
		for (const key of PROFILE_KEYS) {
			if (settings.has(key)) {
				values[key] = settings.get(key);
			}
		}
		return values;
	};

	function ensure() {
		const list = read();
		const active = settings.get("activeProfile") || "Default";
		if (!list.some((p) => p.name === active)) {
			list.push({ name: active, values: snapshot() });
			write(list);
		}
		return list;
	}

	return {
		list: () => ensure().map((p) => p.name),
		active: () => settings.get("activeProfile") || "Default",
		/** Save the current settings into the active profile. */
		saveActive() {
			const list = ensure();
			const active = settings.get("activeProfile") || "Default";
			const profile = list.find((p) => p.name === active);
			profile.values = snapshot();
			write(list);
		},
		/** Switch profiles, applying the saved values. */
		switchTo(name) {
			const list = ensure();
			this.saveActive();
			const profile = list.find((p) => p.name === name);
			if (!profile) {
				return false;
			}
			for (const [key, value] of Object.entries(profile.values || {})) {
				if (settings.has(key) && settings.get(key) !== value) {
					settings.set(key, value);
				}
			}
			settings.set("activeProfile", name);
			return true;
		},
		/** New profile starting from the current settings. */
		create() {
			const list = ensure();
			let n = list.length + 1;
			while (list.some((p) => p.name === `Profile ${n}`)) n++;
			const name = `Profile ${n}`;
			this.saveActive();
			list.push({ name, values: snapshot() });
			write(list);
			settings.set("activeProfile", name);
			return name;
		},
		remove(name) {
			const list = ensure().filter((p) => p.name !== name);
			if (!list.length) {
				return false;
			}
			write(list);
			if (settings.get("activeProfile") === name) {
				this.switchTo(list[0].name);
			}
			return true;
		},
	};
}
