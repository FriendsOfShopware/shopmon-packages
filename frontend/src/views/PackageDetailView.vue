<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import CopyButton from "@/components/CopyButton.vue";
import { fetchPackageDetail, type PackageDetail } from "@/lib/api";

const route = useRoute();
const packageName = `${route.params.vendor}/${route.params.name}`;

const detail = ref<PackageDetail | null>(null);
const notFound = ref(false);
const error = ref(false);

const vendor = computed(() => packageName.split("/")[0]);
const shortName = computed(() => packageName.split("/").slice(1).join("/"));
const requireCommand = computed(() => `composer require ${packageName}`);

const hasReleaseDates = computed(
	() => detail.value?.versions.some((version) => version.releasedAt) ?? false,
);

const typeLabels: Record<string, string> = {
	"shopware-platform-plugin": "Plugin",
	"shopware-app": "App",
	"shopware-theme": "Theme",
};

function formatDate(iso: string | null) {
	if (!iso) {
		return "—";
	}
	return new Date(iso).toLocaleDateString("en-GB", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

async function load() {
	error.value = false;
	notFound.value = false;
	detail.value = null;
	try {
		const result = await fetchPackageDetail(packageName);
		if (result === null) {
			notFound.value = true;
		} else {
			detail.value = result;
		}
	} catch {
		error.value = true;
	}
}

onMounted(load);
</script>

<template>
	<div class="py-8 sm:py-10">
		<RouterLink
			to="/"
			class="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeftIcon class="size-4" />
			All packages
		</RouterLink>

		<!-- Loading -->
		<div v-if="!detail && !notFound && !error" class="mt-8">
			<Skeleton class="h-8 w-1/2" />
			<Skeleton class="mt-3 h-4 w-2/3" />
			<Skeleton class="mt-8 h-32 w-full" />
		</div>

		<!-- Not found -->
		<div v-else-if="notFound" class="mt-8 rounded-xl border border-border bg-card px-6 py-16 text-center">
			<p class="font-mono text-sm">{{ packageName }}</p>
			<p class="mt-2 text-sm text-muted-foreground">
				This package is not mirrored here. It may not be part of any registered token's scope.
			</p>
		</div>

		<!-- Error -->
		<div v-else-if="error" class="mt-8 rounded-xl border border-border bg-card px-6 py-16 text-center">
			<p class="text-sm text-muted-foreground">The package could not be loaded.</p>
			<Button variant="outline" size="sm" class="mt-4" @click="load">Try again</Button>
		</div>

		<template v-else-if="detail">
			<!-- Title -->
			<div class="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
				<h1 class="font-mono text-2xl font-medium tracking-tight sm:text-3xl">
					<span class="text-muted-foreground">{{ vendor }}/</span>{{ shortName }}
				</h1>
				<Badge variant="secondary" class="bg-accent font-mono text-accent-foreground">
					{{ detail.latestVersion }}
				</Badge>
			</div>
			<p v-if="detail.description" class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
				{{ detail.description }}
			</p>
			<dl class="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
				<div v-if="detail.type" class="flex gap-1.5">
					<dt>Type</dt>
					<dd class="text-foreground">{{ typeLabels[detail.type] ?? detail.type }}</dd>
				</div>
				<div v-if="detail.license" class="flex gap-1.5">
					<dt>License</dt>
					<dd class="text-foreground">{{ detail.license }}</dd>
				</div>
				<div v-if="detail.homepage" class="flex gap-1.5">
					<dt>Homepage</dt>
					<dd>
						<a
							:href="detail.homepage"
							class="inline-flex items-center gap-1 text-foreground underline underline-offset-2 hover:text-primary"
						>
							{{ detail.homepage.replace(/^https?:\/\//, "") }}
							<ExternalLinkIcon class="size-3" />
						</a>
					</dd>
				</div>
			</dl>

			<!-- Install -->
			<div class="mt-8 flex items-center overflow-hidden rounded-xl bg-terminal shadow-lg">
				<pre
					class="min-w-0 flex-1 overflow-x-auto px-4 py-3 font-mono text-xs text-terminal-foreground"
				><code><span class="text-terminal-muted">$ </span>{{ requireCommand }}</code></pre>
				<div class="pr-2">
					<CopyButton :text="requireCommand" label="Copy install command" variant="terminal" />
				</div>
			</div>

			<!-- Versions -->
			<section class="mt-10" aria-label="Versions">
				<h2 class="font-display text-sm font-semibold">
					Versions
					<span class="ml-1 font-sans text-xs font-normal text-muted-foreground">
						{{ detail.versions.length }} mirrored
					</span>
				</h2>
				<div class="mt-3 overflow-hidden rounded-xl border border-border bg-card">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-border text-left text-xs text-muted-foreground">
								<th class="px-4 py-2.5 font-medium">Version</th>
								<th
									class="px-4 py-2.5 font-medium"
									:class="hasReleaseDates ? 'hidden sm:table-cell' : 'text-right'"
								>
									Shopware core
								</th>
								<th v-if="hasReleaseDates" class="px-4 py-2.5 text-right font-medium">Released</th>
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="(version, index) in detail.versions"
								:key="version.version"
								class="border-b border-border transition-colors last:border-b-0 hover:bg-accent/40"
							>
								<td class="px-4 py-2.5 font-mono text-xs">
									{{ version.version }}
									<Badge
										v-if="index === 0"
										variant="secondary"
										class="ml-2 bg-accent text-[10px] text-accent-foreground"
									>
										latest
									</Badge>
								</td>
								<td
									class="px-4 py-2.5 font-mono text-xs text-muted-foreground"
									:class="hasReleaseDates ? 'hidden sm:table-cell' : 'text-right'"
								>
									{{ version.shopwareCore ?? "—" }}
								</td>
								<td
									v-if="hasReleaseDates"
									class="px-4 py-2.5 text-right text-xs text-muted-foreground"
								>
									{{ formatDate(version.releasedAt) }}
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>
		</template>
	</div>
</template>
