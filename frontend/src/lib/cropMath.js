// Shared math for the Capture screen's Instagram-style crop frame
// (CropFrame.jsx). Kept separate from the component so the on-screen
// preview and the canvas export that bakes the final photo use the exact
// same formula -- any drift between the two would mean what the sketcher
// saw isn't what actually got saved.

export const ASPECT_RATIOS = {
  original: null, // resolved from the photo's own natural size at call time
  '1:1': 1,
  '4:5': 4 / 5,
  '16:9': 16 / 9,
}

export const ASPECT_RATIO_ORDER = ['original', '1:1', '4:5', '16:9']

export function resolveAspectRatio(key, naturalSize) {
  const fixed = ASPECT_RATIOS[key]
  if (fixed != null) return fixed
  if (naturalSize && naturalSize.height) return naturalSize.width / naturalSize.height
  return 1
}

// Where the photo sits inside a frame of frameWidth x frameHeight (any
// unit -- called with on-screen CSS pixels for the live preview, and with
// export-resolution pixels when baking). `zoom` is a multiplier on top of
// the scale that makes the photo exactly "cover" the frame -- zoom 1 is
// that default cover point, >1 crops in tighter (the common case), and
// <1 shrinks the photo smaller than the frame, revealing whatever sits
// behind it (CropFrame paints that black). `offsetX`/`offsetY` are
// fractions of the frame's own width/height, not pixels, so the same
// composition reproduces correctly regardless of the frame's actual
// on-screen size vs. its export size.
export function computeImageBox(frameWidth, frameHeight, naturalWidth, naturalHeight, zoom, offsetX, offsetY) {
  const baseScale = Math.max(frameWidth / naturalWidth, frameHeight / naturalHeight)
  const scale = baseScale * zoom
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  const centerX = frameWidth / 2 + offsetX * frameWidth
  const centerY = frameHeight / 2 + offsetY * frameHeight
  return { width, height, left: centerX - width / 2, top: centerY - height / 2 }
}

// Renders the current frame state to a JPEG Blob at a fixed export width,
// letterboxed with black wherever zoom < 1 leaves the frame not fully
// covered by the photo -- the actual "Save" of the crop.
export function bakeCrop({ imageEl, naturalSize, aspectRatioKey, zoom, offset, exportWidth = 1440 }) {
  const ratio = resolveAspectRatio(aspectRatioKey, naturalSize)
  const exportHeight = Math.round(exportWidth / ratio)
  const canvas = document.createElement('canvas')
  canvas.width = exportWidth
  canvas.height = exportHeight
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, exportWidth, exportHeight)
  const box = computeImageBox(
    exportWidth,
    exportHeight,
    naturalSize.width,
    naturalSize.height,
    zoom,
    offset.x,
    offset.y
  )
  ctx.drawImage(imageEl, box.left, box.top, box.width, box.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.9)
  })
}

// True once the sketcher has actually touched the framing -- used to skip
// baking (and keep the full-quality original) on the common "just save
// it" path where nothing was cropped.
export function isIdentityTransform(aspectRatioKey, zoom, offset) {
  return aspectRatioKey === 'original' && zoom === 1 && offset.x === 0 && offset.y === 0
}
