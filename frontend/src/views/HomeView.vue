<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { PackageSearchIcon, SearchIcon } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import CopyButton from "@/components/CopyButton.vue";
import PackageRow from "@/components/PackageRow.vue";
import { fetchPackages, type PublicPackageListing } from "@/lib/api";
import { mirrorUrl } from "@/lib/mirror";

const listing = ref<PublicPackageListing | null>(null);
const error = ref(false);
const query = ref("");

const repositorySnippet = `{
    "repositories": [
        {
            "type": "composer",
            "url": "${mirrorUrl}"
        }
    ]
}`;

const filtered = computed(() => {
	if (!listing.value) {
		return [];
	}
	const needle = query.value.trim().toLowerCase();
	if (!needle) {
		return listing.value.packages;
	}
	return listing.value.packages.filter(
		(pkg) =>
			pkg.name.toLowerCase().includes(needle) ||
			pkg.description?.toLowerCase().includes(needle),
	);
});

const lastSynced = computed(() => {
	const timestamp = listing.value?.lastSyncedAt;
	if (!timestamp) {
		return null;
	}
	const minutes = Math.round((Date.now() - timestamp * 1000) / 60_000);
	if (minutes < 1) {
		return "just now";
	}
	if (minutes < 60) {
		return `${minutes} min ago`;
	}
	const hours = Math.round(minutes / 60);
	return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
});

async function load() {
	error.value = false;
	listing.value = null;
	try {
		listing.value = await fetchPackages();
	} catch {
		error.value = true;
	}
}

onMounted(load);
</script>

<template>
	<!-- Hero -->
	<section class="grid items-center gap-8 py-10 sm:py-14 md:grid-cols-[1fr_minmax(0,22rem)]">
		<div>
			<p class="mb-3 font-mono text-xs tracking-widest text-primary uppercase">
				FriendsOfShopware
			</p>
			<h1 class="font-display text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
				Shopware store packages, mirrored for your CI.
			</h1>
			<p class="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
				A Composer repository that mirrors packages from packages.shopware.com — synced every
				hour, served from Cloudflare. Point Composer at it and install as usual.
			</p>
			<p class="mt-6 font-mono text-xs text-muted-foreground">
				<template v-if="listing">
					{{ listing.totalPackages }} packages · {{ listing.totalVersions }} versions
					<template v-if="lastSynced"> · synced {{ lastSynced }}</template>
				</template>
				<Skeleton v-else-if="!error" class="h-4 w-64" />
			</p>
		</div>

		<!-- Signature: the repository config, ready to paste -->
		<div class="overflow-hidden rounded-xl bg-terminal shadow-lg">
			<div class="flex items-center justify-between border-b border-white/10 py-1 pr-1 pl-4">
				<span class="font-mono text-xs text-terminal-muted">composer.json</span>
				<CopyButton :text="repositorySnippet" label="Copy repository config" variant="terminal" />
			</div>
			<pre
				class="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-terminal-foreground"
			><code>{
    <span class="text-terminal-accent">"repositories"</span>: [
        {
            <span class="text-terminal-accent">"type"</span>: <span class="text-terminal-foreground">"composer"</span>,
            <span class="text-terminal-accent">"url"</span>: <span class="text-terminal-foreground">"{{ mirrorUrl }}"</span>
        }
    ]
}</code></pre>
			<p class="border-t border-white/10 px-4 py-2.5 font-mono text-[11px] text-terminal-muted">
				auth: composer config --auth bearer.{{ mirrorUrl.replace("https://", "") }} &lt;token&gt;
			</p>
		</div>
	</section>

	<!-- Search -->
	<section aria-label="Package list">
		<div class="mb-4 flex items-center gap-3">
			<div class="relative flex-1">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					v-model="query"
					type="search"
					placeholder="Search packages…"
					class="h-10 bg-card pl-9"
					aria-label="Search packages"
				/>
			</div>
			<span v-if="listing && query" class="shrink-0 text-sm text-muted-foreground">
				{{ filtered.length }} of {{ listing.totalPackages }}
			</span>
		</div>

		<!-- Loading -->
		<div v-if="!listing && !error" class="overflow-hidden rounded-xl border border-border bg-card">
			<div v-for="i in 8" :key="i" class="border-b border-border px-4 py-4 last:border-b-0">
				<Skeleton class="h-4 w-1/3" />
				<Skeleton class="mt-2 h-3 w-2/3" />
			</div>
		</div>

		<!-- Error -->
		<div
			v-else-if="error"
			class="rounded-xl border border-border bg-card px-6 py-12 text-center"
		>
			<p class="text-sm text-muted-foreground">The package list could not be loaded.</p>
			<Button variant="outline" size="sm" class="mt-4" @click="load">Try again</Button>
		</div>

		<!-- Empty search -->
		<div
			v-else-if="filtered.length === 0"
			class="rounded-xl border border-border bg-card px-6 py-12 text-center"
		>
			<PackageSearchIcon class="mx-auto size-6 text-muted-foreground" />
			<p class="mt-3 text-sm text-muted-foreground">
				No packages match “{{ query }}”.
			</p>
		</div>

		<!-- List -->
		<ul v-else class="overflow-hidden rounded-xl border border-border bg-card">
			<PackageRow v-for="pkg in filtered" :key="pkg.name" :pkg="pkg" />
		</ul>
	</section>
</template>
