<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
import { Button } from "@/components/ui/button";
</script>

<template>
	<div class="flex min-h-screen flex-col border-t-2 border-t-primary">
		<header class="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-5 sm:px-6">
			<RouterLink to="/" class="font-display text-base font-semibold tracking-tight">
				packages<span class="text-primary">.fos.gg</span>
			</RouterLink>
			<Button variant="ghost" size="sm" as-child>
				<a href="https://github.com/FriendsOfShopware/shopmon-packages">GitHub</a>
			</Button>
		</header>

		<main class="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 sm:px-6">
			<RouterView />
		</main>

		<footer class="border-t border-border">
			<div
				class="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:px-6"
			>
				<span>
					Maintained by
					<a href="https://friendsofshopware.com" class="underline underline-offset-2 hover:text-foreground">
						FriendsOfShopware
					</a>
				</span>
				<span>Not affiliated with shopware AG</span>
			</div>
		</footer>
	</div>
</template>
