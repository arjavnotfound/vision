const fs = require('fs');

/** For maker-deb, this has to match name from package.json of the desktop app */
const executableName = "vision-face-control";

const sharedDebRpmOptions = {
	name: "vision-face-control",
	productName: "VISION Face Control",
	productDescription: "Hands-free mouse control",
	genericName: "Facial Mouse",
	homepage: "https://github.com/arjavnotfound/VISION-Research-Prototype",
	icon: "images/vision-logo-512.png",
	categories: [
		"Utility",
	],
	mimeType: [
		// Affects whether the app shows as a recommended app in the "Open With" menu/dialog.
		// Not sure if this would be useful for a config file format, or only standard file formats.
		// "application/x-vision",
	],
};

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
	rebuildConfig: {
		onlyModules: [],
	},
	packagerConfig: {
		icon: "./images/vision-logo",
		name: "VISION Face Control",
		executableName,
		appBundleId: "io.github.arjavnotfound.vision-face-control",
		appCategoryType: "public.app-category.utilities",
		appCopyright: "© 2026 arjavnotfound. Based on Tracky Mouse (MIT) by Isaiah Odhner.",
		junk: true,
		// TODO: assess filtering of files; check node_modules to make sure prune is working
		ignore: [
			".history", // VS Code "Local History" extension
			// TODO: organize image files so I can ignore most of them
			// Maybe add a custom lint script to check that no images are being used by the app
			// that won't be packaged, and that all images are being used
		],
		// TODO: maybe
		// https://electron.github.io/packager/main/interfaces/Options.html#darwinDarkModeSupport
	},
	hooks: {
		// (The exact hook time is not necessarily important
		// but I wanted these to be separate hooks.)
		packageAfterCopy: async (_forgeConfig, buildPath) => {
			// Add marker file for official releases built in CI
			if (process.env.VISION_OFFICIAL_RELEASE) {
				const markerPath = require('path').join(buildPath, 'official-release.txt');
				fs.writeFileSync(markerPath, 'This file marks this build as an official release.');
				console.log('Created official release marker:', markerPath);
			} else {
				console.log('Not creating official release marker since VISION_OFFICIAL_RELEASE is not set.');
			}
		},
		packageAfterPrune: async (_forgeConfig, buildPath) => {
			// Fix broken symlinks in the packaged app.
			// This is needed due to https://github.com/electron/forge/issues/3238

			const sourceAppRoot = __dirname;
			const log = (...args) => {
				console.log("[fix-broken-symlinks]", ...args);
			};

			log("🔧 Fixing broken symlinks in packaged app...");

			const { unlink, mkdir } = require('fs').promises;
			const { dirname, join } = require('path');
			const { execSync } = require('child_process');
			const { extract } = require('tar');
			const modulesToCopy = ['vision-hft'];
			for (const moduleName of modulesToCopy) {
				const sourcePath = dirname(require.resolve(join(moduleName, 'package.json')));
				const destPath = join(buildPath, 'node_modules', moduleName);
				log(`Deleting presumed broken symlink: ${destPath}`);
				await unlink(destPath);
				log(`Packing module: ${moduleName}`);
				const tarballName = execSync(`npm pack ${sourcePath}`, { cwd: sourceAppRoot }).toString().trim();
				const tarballPath = join(sourceAppRoot, tarballName);
				log(`Created tarball: ${tarballPath}`);
				// --prefix parameter is undocumented https://github.com/npm/cli/issues/1368#issuecomment-1241076700
				// and this command would install not just the tarball but ALL DEPENDENCIES, including those that have been pruned
				// log(`Installing tarball into ${buildPath}`);
				// execSync(`npm install --no-save ${tarballPath} --prefix ${buildPath}`, { stdio: "inherit" });
				// tar command isn't available on Windows (or doesn't handle Windows paths, or doesn't work the same)
				// log(`Extracting tarball into ${join(buildPath, 'node_modules')}`);
				// execSync(`tar -xzf ${tarballPath} -C ${join(buildPath, 'node_modules')}`, { stdio: "inherit" });
				log(`Extracting tarball to ${destPath}`);
				await mkdir(destPath);
				await extract({ file: tarballPath, C: destPath, strip: 1 });
				log(`Removing tarball: ${tarballPath}`);
				await unlink(tarballPath);
			}
		},
	},
	makers: [
		{
			name: "@electron-forge/maker-squirrel",
			config: {
				name: "vision-face-control",
				exe: `${executableName}.exe`,
				title: "VISION Face Control",
				description: "Hands-free mouse control",
				iconUrl: "https://raw.githubusercontent.com/arjavnotfound/VISION-Research-Prototype/main/app/images/vision-logo-512.png",
				setupIcon: "./images/vision-logo.ico",
				loadingGif: "./images/vision-logo-thick-360-spin.gif",
			},
		},
		{
			name: '@electron-forge/maker-msix',
			config: {
				appManifest: './Package.appxmanifest',
				logLevel: 'debug',
				// Windows Store supposedly allows certificates but they cause problems and won't be used anyway
				sign: false,
			}
		},
		{
			name: "@electron-forge/maker-zip",
			platforms: [
				"darwin",  // macOS uses a .zip, which may be automatically extracted when opened
			],
		},
		{
			name: "@electron-forge/maker-deb",
			config: {
				options: {
					...sharedDebRpmOptions,
					section: "utils",
					maintainer: "arjavnotfound",
				},
			},
		},
		{
			name: "@electron-forge/maker-rpm",
			config: {
				options: {
					...sharedDebRpmOptions,
					license: "MIT",
				},
			},
		},
		{
			name: "@reforged/maker-appimage",
			config: {
				options: {
					// No productDescription field?
					// There is an option to a desktopFile...
					bin: executableName,
					name: "vision-face-control",
					productName: "VISION Face Control",
					genericName: "Facial Mouse",
					homepage: "https://github.com/arjavnotfound/VISION-Research-Prototype",
					icon: "images/vision-logo-512.png",
					categories: [
						"Utility",
						"Accessibility",
					],
					keywords: [
						"vision",
						"camera mouse",
						"mouse",
						"camera",
						"webcam",
						"head tracker",
						"head tracking",
						"facial recognition",
						"face tracker",
						"face tracking",
						"headmouse",
						"facial mouse",
						"facemesh",
						"eye tracker",
						"eye tracking",
						"eye gaze",
						"accessibility",
						"assistive-technology",
						"cursor",
						"pointer",
						"pointing",
						"input method",
						"hands-free",
						"handsfree",
						"desktop automation",
						"telekinesis",
					],
				}
			}
		},
	],
	publishers: [
		{
			name: '@electron-forge/publisher-github',
			config: {
				repository: {
					owner: 'arjavnotfound',
					name: 'VISION-Research-Prototype'
				},
				prerelease: false,
				draft: true,
			}
		}
	],
};
