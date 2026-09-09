// js/avatar-crop.js — a lightweight, dependency-free crop editor for the
// "Upload photo…" avatar flow (see js/profile.js). No existing crop
// library is present anywhere in this project (it's a plain static-file
// app with no build step/npm dependencies at all — grep confirms it), so
// per the brief this is a small Canvas + Pointer Events implementation
// rather than pulling in a bundler-only dependency.
//
// Public API: openAvatarCropEditor(file) -> Promise<Blob|null>
// Resolves with the final cropped/compressed JPEG Blob on Save, or null
// on Cancel/close. Everything (object URLs, the decoded bitmap, pointer
// listeners) is torn down on every exit path — see cleanup() below.
//
// Format: JPEG, not WebP — Safari's canvas.toBlob() does not actually
// support encoding to image/webp (the spec allows silently falling back
// to PNG when the requested type isn't supported, which on iOS Safari
// would mean a full uncompressed PNG instead of a compressed photo,
// exactly the "excessively large upload" this feature exists to avoid).
// Since "must work on iPhone Safari" is an explicit requirement, JPEG is
// the safe, predictable choice — also matches the format the previous
// upload path already used.

const OUTPUT_SIZE = 512;
const JPEG_QUALITY = 0.88;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function openAvatarCropEditor(file) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('cropModalOverlay');
    const canvas = document.getElementById('cropCanvas');
    const previewCanvas = document.getElementById('cropPreviewCanvas');
    const zoomSlider = document.getElementById('cropZoomSlider');
    const zoomOut = document.getElementById('cropZoomOut');
    const zoomIn = document.getElementById('cropZoomIn');
    const rotateBtn = document.getElementById('cropRotateBtn');
    const cancelBtn = document.getElementById('cropCancelBtn'); // top-left back arrow
    const cancelBtn2 = document.getElementById('cropCancelBottomBtn'); // bottom "Cancel" pill — same action, second affordance
    const saveBtn = document.getElementById('cropSaveBtn');
    const closeBtn = document.getElementById('cropCloseBtn');
    const statusEl = document.getElementById('cropStatus');

    const ctx = canvas.getContext('2d');
    const previewCtx = previewCanvas.getContext('2d');

    let bitmap = null;       // decoded image, reused for every redraw (decode once)
    let objectUrl = null;    // only set on the <img>+URL.createObjectURL fallback path
    let naturalW = 0, naturalH = 0;
    let rotation = 0;        // 0 | 90 | 180 | 270
    let userZoom = 1;        // MIN_ZOOM..MAX_ZOOM, multiplies baseScale
    let offsetX = 0, offsetY = 0; // pan, in crop-canvas CSS px, image-space (pre-rotation)
    let dragging = false;
    let dragStart = null;    // { x, y, offsetX, offsetY }
    const activePointers = new Map(); // pointerId -> {x,y}, for pinch
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let closed = false;

    const cropSize = canvas.width; // canvas is square; width/height set in HTML, backing store == CSS size (see below)

    function baseScale() {
      // The zoom level at which the (unrotated) image's SHORT side exactly
      // covers the crop square — rotation swaps which side is "short" on
      // screen but min(w,h) is the same either way, so one formula covers
      // all four rotation states.
      return cropSize / Math.min(naturalW, naturalH);
    }

    function effectiveScale() { return baseScale() * userZoom; }

    // Clamps offsetX/offsetY so the scaled+rotated image can never leave a
    // gap inside the crop square (Section 3/6: never show empty space,
    // never let the user drag past the edge).
    function clampOffsets() {
      const s = effectiveScale();
      const w = naturalW * s, h = naturalH * s;
      // At 90/270 the on-screen bounding box has width/height swapped.
      const onScreenW = (rotation % 180 === 0) ? w : h;
      const onScreenH = (rotation % 180 === 0) ? h : w;
      const maxX = Math.max(0, (onScreenW - cropSize) / 2);
      const maxY = Math.max(0, (onScreenH - cropSize) / 2);
      offsetX = clamp(offsetX, -maxX, maxX);
      offsetY = clamp(offsetY, -maxY, maxY);
    }

    function drawInto(targetCtx, size) {
      targetCtx.save();
      targetCtx.clearRect(0, 0, size, size);
      const s = (size / cropSize) * effectiveScale();
      targetCtx.translate(size / 2 + (offsetX * size / cropSize), size / 2 + (offsetY * size / cropSize));
      targetCtx.rotate((rotation * Math.PI) / 180);
      targetCtx.drawImage(bitmap, -naturalW * s / 2, -naturalH * s / 2, naturalW * s, naturalH * s);
      targetCtx.restore();
    }

    function render() {
      if (closed) return;
      drawInto(ctx, cropSize);
      drawInto(previewCtx, previewCanvas.width);
    }

    function setZoom(z) {
      userZoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
      zoomSlider.value = String(userZoom);
      clampOffsets();
      render();
    }

    // ---- pointer drag + pinch (unified touch/mouse/pen via Pointer Events) ----
    function onPointerDown(e) {
      // A pointer capture request can be rejected for a pointer the browser
      // doesn't consider currently active (rare, but seen with some
      // multi-touch edge cases) — must not abort the rest of the handler,
      // or a second finger landing mid-gesture would silently kill drag/pinch.
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 1) {
        dragging = true;
        dragStart = { x: e.clientX, y: e.clientY, offsetX, offsetY };
      } else if (activePointers.size === 2) {
        dragging = false;
        const pts = [...activePointers.values()];
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        pinchStartZoom = userZoom;
      }
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size >= 2) {
        const pts = [...activePointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        setZoom(pinchStartZoom * (dist / pinchStartDist));
      } else if (dragging && dragStart) {
        offsetX = dragStart.offsetX + (e.clientX - dragStart.x);
        offsetY = dragStart.offsetY + (e.clientY - dragStart.y);
        clampOffsets();
        render();
      }
      e.preventDefault();
    }
    function onPointerUp(e) {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) { pinchStartDist = 0; }
      if (activePointers.size === 0) { dragging = false; dragStart = null; }
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
    function onWheel(e) {
      e.preventDefault();
      setZoom(userZoom - e.deltaY * 0.0015);
    }

    function onZoomSlider() { setZoom(parseFloat(zoomSlider.value)); }
    function onZoomOut() { setZoom(userZoom - 0.2); }
    function onZoomIn() { setZoom(userZoom + 0.2); }
    function onRotate() {
      rotation = (rotation + 90) % 360;
      clampOffsets();
      render();
    }

    function cleanup() {
      closed = true;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      zoomSlider.removeEventListener('input', onZoomSlider);
      zoomOut.removeEventListener('click', onZoomOut);
      zoomIn.removeEventListener('click', onZoomIn);
      rotateBtn.removeEventListener('click', onRotate);
      cancelBtn.removeEventListener('click', onCancel);
      cancelBtn2.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      saveBtn.removeEventListener('click', onSave);
      activePointers.clear();
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      if (bitmap && typeof bitmap.close === 'function') bitmap.close(); // ImageBitmap only
      bitmap = null;
      overlay.hidden = true;
      overlay.classList.remove('show');
      statusEl.textContent = '';
      saveBtn.disabled = false;
    }

    function onCancel() { cleanup(); resolve(null); }

    async function onSave() {
      saveBtn.disabled = true;
      statusEl.textContent = '';
      try {
        // ONE crop + resize pass, straight to the final output resolution
        // (Section 10) — the interactive canvas above is only ever the
        // small editing preview, never the source for the saved file.
        const out = document.createElement('canvas');
        out.width = OUTPUT_SIZE;
        out.height = OUTPUT_SIZE;
        const outCtx = out.getContext('2d');
        drawInto(outCtx, OUTPUT_SIZE);
        const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', JPEG_QUALITY));
        cleanup();
        resolve(blob);
      } catch (err) {
        statusEl.textContent = err?.message || 'Could not process that photo.';
        saveBtn.disabled = false;
      }
    }

    async function init() {
      overlay.hidden = false;
      overlay.classList.add('show');
      statusEl.textContent = '';
      saveBtn.disabled = true;

      // Attached immediately, not after decode: the image can take a
      // moment to decode (a multi-MB phone photo), and Cancel/Close must
      // work the instant the modal is visible, not only once decoding
      // finishes.
      cancelBtn.addEventListener('click', onCancel);
      cancelBtn2.addEventListener('click', onCancel);
      closeBtn.addEventListener('click', onCancel);

      try {
        if ('createImageBitmap' in window) {
          bitmap = await createImageBitmap(file);
        } else {
          objectUrl = URL.createObjectURL(file);
          bitmap = await new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = () => rej(new Error('Could not read that image'));
            img.src = objectUrl;
          });
        }
      } catch {
        cleanup();
        resolve(null);
        return;
      }
      if (closed) return; // editor was cancelled while the image was still decoding

      naturalW = bitmap.width || bitmap.naturalWidth;
      naturalH = bitmap.height || bitmap.naturalHeight;
      if (!naturalW || !naturalH) { cleanup(); resolve(null); return; }

      rotation = 0; userZoom = 1; offsetX = 0; offsetY = 0;
      zoomSlider.value = '1';
      saveBtn.disabled = false;
      clampOffsets();
      render();

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      zoomSlider.addEventListener('input', onZoomSlider);
      zoomOut.addEventListener('click', onZoomOut);
      zoomIn.addEventListener('click', onZoomIn);
      rotateBtn.addEventListener('click', onRotate);
      saveBtn.addEventListener('click', onSave);
    }

    init();
  });
}
