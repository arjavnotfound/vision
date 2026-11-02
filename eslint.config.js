const globals = require("globals");
const js = require("@eslint/js");

/** @type {import('@types/eslint').Linter.FlatConfig[]} */
module.exports = [
	{
		"ignores": [
			"**/node_modules",
			"**/out",
			"**/dist",
			"**/build",
			"**/bin",
			"**/lib",
			"**/private",
			"**/.*",
			"console/**",
			"agent/**",
			"vision-dev/**",
			"release/**",
			"build/**",
		],
	},
	js.configs.recommended,
	{
		"languageOptions": {
			"globals": {
				...globals.browser,
				// ...globals.es2021,
			},
			"ecmaVersion": "latest"
		},
		"rules": {
			"indent": [
				"error",
				"tab",
				{ "SwitchCase": 1 }
			],
			// "quotes": [
			// 	"error",
			// 	"single"
			// ],
			"semi": [
				"error",
				"always"
			],
			// "no-unused-vars": "off",
			// "@typescript-eslint/no-unused-vars": [
			// 	"warn", // or "error"
			// 	{
			// 		"argsIgnorePattern": "^_",
			// 		"varsIgnorePattern": "^_",
			// 		"caughtErrorsIgnorePattern": "^_"
			// 	}
			// ]
			"no-unused-vars": ["warn", {
				"args": "all",
				"argsIgnorePattern": "^_",
				"caughtErrorsIgnorePattern": "^_",
				// "varsIgnorePattern": "^_",
			}],
			"no-var": "error",
		},
	},
	{
		"files": [
			"app/src/vision-bin.js",
			"app/src/electron-main/*",
			"app/src/preload-app-window.js",
			"app/src/preload-screen-overlay.js",
			"app/src/preload-orb.js",
			"app/forge.config.js",
			"scripts/list-ipc-events.js",
			"scripts/flatten-folders.js",
			"eslint.config.js",
			"scripts/bench/**",
			"scripts/qa/**",
			"scripts/capture-screens.js",
			"tests/**/*.js",
		],
		"languageOptions": {
			"globals": {
				// ...globals.commonjs,
				...globals.node
			},
			"sourceType": "commonjs"
		},
	},
	{
		// ES module tests and pure engine modules (also run under Node in tests)
		"files": [
			"tests/**/*.mjs",
			"core/src/**/*.js",
		],
		"languageOptions": {
			"globals": {
				...globals.node,
				...globals.browser,
			},
			"sourceType": "module",
		},
	},
	{
		"files": [
			"app/src/electron-main/electron-main.js",
		],
		"rules": {
			"id-denylist": ["error",
				// Disallow translation function because i18next-cli extract can't parse this file due to top-level return.
				"t"
			],
		},
	}
];
