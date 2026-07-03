import { createRouter, createWebHistory } from "vue-router";
import HomeView from "./views/HomeView.vue";

export const router = createRouter({
	history: createWebHistory(),
	routes: [
		{ path: "/", component: HomeView },
		{
			path: "/package/:vendor/:name",
			component: () => import("./views/PackageDetailView.vue"),
		},
	],
	scrollBehavior(_to, _from, savedPosition) {
		return savedPosition ?? { top: 0 };
	},
});
