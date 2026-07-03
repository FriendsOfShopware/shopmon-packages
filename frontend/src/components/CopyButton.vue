<script setup lang="ts">
import { ref } from "vue";
import { CheckIcon, CopyIcon } from "lucide-vue-next";
import { Button } from "@/components/ui/button";

const props = defineProps<{
	text: string;
	label: string;
	variant?: "ghost" | "outline" | "terminal";
}>();

const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
	await navigator.clipboard.writeText(props.text);
	copied.value = true;
	clearTimeout(resetTimer);
	resetTimer = setTimeout(() => {
		copied.value = false;
	}, 1500);
}
</script>

<template>
	<Button
		:variant="variant === 'terminal' ? 'ghost' : (variant ?? 'ghost')"
		size="icon-sm"
		:aria-label="copied ? 'Copied' : label"
		:class="
			variant === 'terminal'
				? 'text-terminal-muted hover:text-terminal-foreground hover:bg-white/10'
				: 'text-muted-foreground hover:text-foreground'
		"
		@click.stop="copy"
	>
		<CheckIcon v-if="copied" class="text-emerald-500" />
		<CopyIcon v-else />
	</Button>
</template>
