import { applyExifOrientation } from "./exif-orientation.mjs";
import { loadPhoton } from "./photon.mjs";
import type { ModelImageResizeOptions } from "./types.ts";

/**
 * TILES (2026-11, «PDF og høye bilder kan ikke leses»): a tall or wide
 * picture — a scanned answer that is one 1010 × 5694 strip, a long
 * screenshot — used to be shrunk whole to the model's longest-side limit,
 * which left it 355 px wide and the handwriting unreadable. Such a picture
 * is now cut into overlapping tiles at readable resolution instead, in
 * reading order, each within the model's limits.
 *
 * Rules (owner-approved):
 * - tile only when fitting the whole picture would shrink its short side
 *   below MIN_READABLE_SIDE and the tiles would be clearly sharper (an
 *   ordinary page or photo still goes as one picture);
 * - a tile's long side is at most TILE_ASPECT × its short side (≈ 1:1.4),
 *   its short side as wide as the source allows up to what the limit lets
 *   a 1:1.4 tile have (2000 / 1.4 ≈ 1428 px);
 * - neighbours overlap by at least TILE_OVERLAP of a tile, so a line on a
 *   seam is whole in one of them;
 * - never more than MAX_TILES per picture: an extremely long strip gets
 *   longer tiles rather than more of them.
 *
 * Lines are never split sideways: a tall picture is cut top → bottom only,
 * a wide one left → right only.
 */

export const TILE_ASPECT = 1.4;
export const TILE_OVERLAP = 0.05;
export const MAX_TILES = 10;
export const MIN_READABLE_SIDE = 1000;
/** Tiles must be at least this much sharper than the fitted whole picture. */
const MIN_GAIN = 1.5;
/** pi-ai's default per-image limit (catalog `inputLimits.images.resize`). */
const DEFAULT_MAX_SIDE = 2000;

export type TileDirection = "down" | "across";

export interface TileRect {
	/** Position in the SCALED picture (scale below), in px. */
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface TilePlan {
	direction: TileDirection;
	/** Applied to the source before cutting (≤ 1). */
	scale: number;
	/** The scaled picture the rects index into. */
	width: number;
	height: number;
	tiles: TileRect[];
}

/** Where a tiled picture is cut, or null when it should go as one picture.
 *  Pure: same size and limits, same plan. */
export function planTiles(width: number, height: number, limits?: Pick<ModelImageResizeOptions, "maxWidth" | "maxHeight">): TilePlan | null {
	if (![width, height].every((n) => Number.isFinite(n) && n > 0)) return null;
	const maxWidth = limits?.maxWidth ?? DEFAULT_MAX_SIDE;
	const maxHeight = limits?.maxHeight ?? DEFAULT_MAX_SIDE;
	const direction: TileDirection = height >= width ? "down" : "across";
	const short = Math.min(width, height);
	const long = Math.max(width, height);
	const fit = Math.min(1, maxWidth / width, maxHeight / height);
	// One picture is fine when its short side survives the fit readable.
	if (short * fit >= MIN_READABLE_SIDE) return null;
	const maxLong = direction === "down" ? maxHeight : maxWidth;
	const maxShort = direction === "down" ? maxWidth : maxHeight;
	// The tile shape: 1:1.4, unless that would need more than MAX_TILES.
	const steps = 1 + (MAX_TILES - 1) * (1 - TILE_OVERLAP);
	const aspect = Math.max(TILE_ASPECT, long / short / steps);
	const tileShort = Math.max(1, Math.min(short, maxShort, Math.floor(maxLong / aspect)));
	// …and when tiles would not be clearly sharper than the fitted whole (a
	// small source, a near-square picture, a model with tiny limits).
	if (tileShort < MIN_GAIN * short * fit) return null;
	const scale = tileShort / short;
	const scaledLong = Math.max(1, Math.round(long * scale));
	const tileLong = Math.min(scaledLong, maxLong, Math.round(tileShort * aspect));
	if (scaledLong <= tileLong) return null;
	const count = Math.min(MAX_TILES, Math.ceil((scaledLong - tileLong) / (tileLong * (1 - TILE_OVERLAP))) + 1);
	const step = (scaledLong - tileLong) / (count - 1);
	const tiles: TileRect[] = [];
	for (let i = 0; i < count; i++) {
		const start = i === count - 1 ? scaledLong - tileLong : Math.round(i * step);
		tiles.push(direction === "down"
			? { x: 0, y: start, width: tileShort, height: tileLong }
			: { x: start, y: 0, width: tileLong, height: tileShort });
	}
	return {
		direction,
		scale,
		width: direction === "down" ? tileShort : scaledLong,
		height: direction === "down" ? scaledLong : tileShort,
		tiles,
	};
}

/** The tile's place in reading order, for the text next to it. */
export function tilePosition(plan: TilePlan, index: number): string {
	const arrow = plan.direction === "down" ? "top → bottom" : "left → right";
	return `part ${index + 1} of ${plan.tiles.length} (${arrow})`;
}

/** One line for the result text: how a tiled picture arrives. */
export function tileSummary(direction: TileDirection, count: number): string {
	const order = direction === "down" ? "top to bottom" : "left to right";
	return `${count} overlapping parts, ${order}; a line on a seam appears in both neighbours`;
}

export interface CutPicture {
	plan: TilePlan;
	/** PNG bytes, one per plan tile, in reading order. */
	tiles: Uint8Array[];
}

/** A PNG's pixel size from its header (the renderer's pages are PNG). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Cut a picture into tiles, or null to send it whole (no plan, or it
 *  cannot be decoded). Photon in process: decode once (EXIF orientation
 *  applied, like the resizer), scale once, crop each tile, encode PNG. */
export async function cutPicture(bytes: Uint8Array, limits?: Pick<ModelImageResizeOptions, "maxWidth" | "maxHeight">): Promise<CutPicture | null> {
	// A PNG header settles the common "no tiling" case without decoding.
	const header = pngSize(bytes);
	if (header && !planTiles(header.width, header.height, limits)) return null;
	const photon = await loadPhoton();
	if (!photon) return null;
	let raw: InstanceType<typeof photon.PhotonImage> | undefined;
	let source: InstanceType<typeof photon.PhotonImage> | undefined;
	let scaled: InstanceType<typeof photon.PhotonImage> | undefined;
	try {
		raw = photon.PhotonImage.new_from_byteslice(bytes);
		source = applyExifOrientation(photon, raw, bytes);
		const plan = planTiles(source.get_width(), source.get_height(), limits);
		if (!plan) return null;
		scaled = plan.scale < 1
			? photon.resize(source, plan.width, plan.height, photon.SamplingFilter.Lanczos3)
			: source;
		const tiles: Uint8Array[] = [];
		for (const rect of plan.tiles) {
			const tile = photon.crop(scaled, rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
			try {
				tiles.push(tile.get_bytes());
			} finally {
				tile.free();
			}
		}
		return { plan, tiles };
	} catch {
		return null;
	} finally {
		if (scaled && scaled !== source) scaled.free();
		if (source && source !== raw) source.free();
		raw?.free();
	}
}
