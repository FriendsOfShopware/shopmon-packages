export type PublicPackage = {
	name: string;
	description: string | null;
	latestVersion: string;
	versions: string[];
};

export type PublicPackageListing = {
	packages: PublicPackage[];
	totalPackages: number;
	totalVersions: number;
	lastSyncedAt: number | null;
};

export type PackageVersion = {
	version: string;
	releasedAt: string | null;
	shopwareCore: string | null;
};

export type PackageDetail = {
	name: string;
	description: string | null;
	type: string | null;
	homepage: string | null;
	license: string | null;
	latestVersion: string;
	versions: PackageVersion[];
};

let listingCache: PublicPackageListing | null = null;

export async function fetchPackages(): Promise<PublicPackageListing> {
	if (listingCache) {
		return listingCache;
	}
	const response = await fetch("/api/public/packages");
	if (!response.ok) {
		throw new Error(`Request failed with status ${response.status}`);
	}
	listingCache = (await response.json()) as PublicPackageListing;
	return listingCache;
}

export async function fetchPackageDetail(name: string): Promise<PackageDetail | null> {
	const response = await fetch(`/api/public/packages/${name}`);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`Request failed with status ${response.status}`);
	}
	return response.json();
}
