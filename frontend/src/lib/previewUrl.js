// A URL for showing a picked photo in an <img>.
//
// Chrome and Firefox can't draw HEIC (iPhone photos), so a HEIC file is
// converted to a JPEG here for the preview only. The original file is
// still what gets uploaded: the backend decodes HEIC itself and reads
// location and time from its EXIF, which the converted JPEG would lose.
//
// The converter is large, so it only loads when a HEIC file is picked.

const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']

export function isHeicFile(file) {
  // Some browsers leave file.type empty for HEIC, so check the name too.
  return HEIC_TYPES.includes(file.type) || /\.(heic|heif)$/i.test(file.name)
}

// Resolves to an object URL. The caller revokes it (URL.revokeObjectURL).
export async function previewUrl(file) {
  if (!isHeicFile(file)) return URL.createObjectURL(file)
  const { heicTo } = await import('heic-to')
  const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.85 })
  return URL.createObjectURL(jpeg)
}
