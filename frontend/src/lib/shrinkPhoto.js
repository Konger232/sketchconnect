// Shrinks a large photo in the browser before it's uploaded with others:
// the server accepts at most 32 MB per request, and ten phone photos can
// pass that. Long side 2400 px, JPEG. A small photo, or one the browser
// can't open (HEIC outside Safari), goes as it is.
const MAX_SIDE = 2400
const SMALL = 2.5 * 1024 * 1024

export async function shrinkPhoto(file) {
  if (!file || file.size <= SMALL) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}
