<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { ChevronRightIcon } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import type { PublicPackage } from "@/lib/api";
import CopyButton from "./CopyButton.vue";

const props = defineProps<{ pkg: PublicPackage }>();

const vendor = computed(() => props.pkg.name.split("/")[0]);
const shortName = computed(() => props.pkg.name.split("/").slice(1).join("/"));
</script>

<template>
	<li class="border-b border-border last:border-b-0">
		<div class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 sm:gap-4">
			<RouterLink
				:to="`/package/${pkg.name}`"
				class="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:gap-4"
			>
				<span class="min-w-0 flex-1">
					<span class="block truncate font-mono text-sm">
						<span class="text-muted-foreground">{{ vendor }}/</span
						><span class="font-medium text-foreground">{{ shortName }}</span>
					</span>
					<span v-if="pkg.description" class="mt-0.5 block truncate text-sm text-muted-foreground">
						{{ pkg.description }}
					</span>
				</span>
				<span class="hidden shrink-0 text-xs text-muted-foreground sm:block">
					{{ pkg.versions.length }} {{ pkg.versions.length === 1 ? "version" : "versions" }}
				</span>
				<Badge variant="secondary" class="shrink-0 bg-accent font-mono text-accent-foreground">
					{{ pkg.latestVersion }}
				</Badge>
			</RouterLink>
			<CopyButton
				:text="`composer require ${pkg.name}`"
				:label="`Copy composer require for ${pkg.name}`"
			/>
			<RouterLink
				:to="`/package/${pkg.name}`"
				class="text-muted-foreground transition-colors hover:text-foreground"
				:aria-label="`View ${pkg.name}`"
				tabindex="-1"
			>
				<ChevronRightIcon class="size-4" />
			</RouterLink>
		</div>
	</li>
</template>
