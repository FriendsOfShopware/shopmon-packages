import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
	minify: true,
	types: {
		generate: false,
	},
	assetsDirectory: "./frontend/dist",
});
