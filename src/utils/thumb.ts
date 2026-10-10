/**
 * Thumbnail helper.
 *
 * `read_image_data_url` returns the file's raw bytes base64-encoded, which is
 * right for the big preview panel but far too heavy for the icon-sized
 * thumbnails in the list (a 6 MB photo becomes an ~8 MB string). We decode and
 * downscale once in the webview and cache only the small result, so a folder of
 * photographs costs kilobytes per thumbnail instead of megabytes.
 *
 * No `image` crate on the Rust side, so the binary stays small.
 */

/** Shrink a data URL to fit a `maxSide` square, returning a small PNG data URL. */
export function shrinkDataUrl(src: string, maxSide: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return resolve(null);
      // Already small enough: hand the original back untouched.
      if (w <= maxSide && h <= maxSide) return resolve(src);
      const scale = Math.min(maxSide / w, maxSide / h);
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      try {
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        // Images with alpha (PNG/WebP/SVG) look better against a dark chip.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}