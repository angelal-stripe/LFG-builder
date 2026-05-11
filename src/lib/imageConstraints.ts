/** Shared between the upload UI and `POST /api/render`. */

export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const ALLOWED_IMAGE_MIME = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);

export const ALLOWED_IMAGE_DESCRIPTION = "PNG, JPEG, or WebP";

/** Stay under typical Vercel body limits; tune per plan. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
