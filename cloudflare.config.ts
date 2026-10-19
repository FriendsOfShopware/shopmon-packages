import { bindings, defineConfig, triggers } from "cf/config";

const PROD_DB_ID = "b0add9b3-5192-40aa-994f-60aba7aab9bf";
const STAGING_DB_ID = "56cfef2f-2fcc-4a8b-8678-d51ba0beb581";

export default defineConfig((ctx) => {
	const staging = ctx.mode === "staging";
	const suffix = staging ? "-staging" : "";

	return {
		worker: {
			name: `shopmon-packages${suffix}`,
			compatibilityDate: "2026-07-06",
			compatibilityFlags: [
				"nodejs_compat",
			],
			entrypoint: "src/index.ts",
			placement: {
				mode: "smart",
			},
			cache: {
				enabled: true,
			},
			observability: {
				enabled: true,
			},
			domains: [
				staging ? "packages.staging.fos.gg" : "packages.fos.gg",
			],
			triggers: [
				triggers.scheduled({
					schedule: "0 * * * *",
				}),
				triggers.queue({
					maxBatchSize: 100,
					maxConcurrency: 5,
					name: `package-downloads${suffix}`,
				}),
			],
			env: {
				DB: bindings.d1({
					name: `packages-mirror${suffix}`,
					id: staging ? STAGING_DB_ID : PROD_DB_ID,
				}),
				PACKAGES_BUCKET: bindings.r2({
					name: `packages-mirror${suffix}`,
				}),
				DOWNLOAD_QUEUE: bindings.queue({
					name: `package-downloads${suffix}`,
				}),
				ASSETS: bindings.assets(),
				// Admin API token, uploaded as a secret (cf deploy --secrets-file or wrangler secret put).
				API_TOKEN: bindings.secret(),
			},
		},
	};
});
