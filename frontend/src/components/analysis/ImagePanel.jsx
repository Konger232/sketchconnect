import { useRef } from 'react'

export default function ImagePanel({
  containerRef,
  imgRef,
  svgRef,
  boxSize,
  imageUrl,
  // Only CreateSketch.jsx's crop step actually needs this -- it later
  // draws this exact <img> onto a canvas (bakeCrop, via imgRef) to
  // produce the cropped/framed image, and a canvas tainted by a
  // cross-origin image with no CORS attribute throws on export. A
  // read-only display (AIGuidance, focal points,
  // etc.) never touches canvas pixels, and forcing crossOrigin="anonymous"
  // there just adds a real CORS check the browser doesn't otherwise
  // require for a plain <img> -- if that check fails for any reason, the
  // image silently never loads (onLoad never fires, box stays null, and
  // ImagePanel renders it at 1px/opacity:0 below).
  crossOrigin,
  // Extra class on the <img> only, e.g. 'photo-bw' for the Marks step's
  // black-and-white toggle. The SVG overlay on top is not affected.
  imageClassName = '',
  zoom = 1,
  offset = { x: 0, y: 0 },
  box,
  heightClass,
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  onImageLoad,
  onClick,
  // Crop step: draw the crop frame (white border, thirds, corner handles)
  // and show the photo outside the frame, dimmed (.crop-frame, index.css).
  cropFrame = false,
  // Crop step: the frame while a corner is being dragged ({ x, y, width,
  // height } in px, relative to the photo box). Null means the full box.
  cropRect = null,
  // Crop step: corner drag handlers { down(corner, e), move(e), up(e) }.
  // corner is 'tl' | 'tr' | 'bl' | 'br'.
  cornerHandlers,
  // --- New props for self-contained uploading ---
  fileInputRef,
  onFileChange,
  saving = false,
}) {
  const internalFileInputRef = useRef(null)
  const activeFileInputRef = fileInputRef || internalFileInputRef

  return (
    <div
      ref={containerRef}
      // touch-none while a gesture handler is attached (pan/zoom, drawing),
      // so a finger on the photo doesn't scroll the page instead.
      className={`relative flex w-full select-none items-center justify-center overflow-hidden bg-sc-modal p-3 md:p-[var(--stage-inset)] ${onPointerDown ? 'touch-none' : ''} ${heightClass}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
    > 
      {/* If no image is provided, 
      render the upload trigger button inside the panel */}
      {!imageUrl ? (
        <div className="flex h-full w-full flex-col items-center justify-center p-6">
          <button
            type="button"
            onClick={() => activeFileInputRef.current?.click()}
            disabled={saving}
            className="flex h-64 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 bg-white/5 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50 md:h-full"
          >
            <span className="text-4xl">📷</span>
            <span>{saving ? 'Uploading...' : 'Upload or Take Photo'}</span>
          </button>
          <input
            ref={activeFileInputRef}
            type="file"
            accept="image/*,.heic"
            onChange={onFileChange}
            className="hidden"
          />
        </div>
      ) : (
      <div
        style={{
        position: 'relative',
        width: `${boxSize.width || 0}px`,
        height: `${boxSize.height || 0}px`,
        overflow: cropFrame ? 'visible' : 'hidden',
        }}
        >
        <img
        ref={imgRef}
        src={imageUrl}
        alt=""
        crossOrigin={crossOrigin}
        className={imageClassName}
        draggable={false}
        onLoad={onImageLoad}
        style={
            box
            ? {
                position: 'absolute',
                width: `${box.width}px`,
                height: `${box.height}px`,
                left: `${box.left}px`,
                top: `${box.top}px`,
                maxWidth: 'none',
                maxHeight: 'none',
                pointerEvents: 'none',
                userSelect: 'none',     //Chrome + FireFox
                WebkitUserDrag: 'none', // safari
                }
            : { position: 'absolute', opacity: 0, width: '1px', height: '1px' }
        }
        />

        {box && (
        <svg
            ref={svgRef}
            onClick={onClick}
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
        >
            {children}
        </svg>
        )}
        {box && cropFrame && (
          <div
            className="crop-frame"
            style={cropRect ? { inset: 'auto', left: cropRect.x, top: cropRect.y, width: cropRect.width, height: cropRect.height } : undefined}
          >
            <span className="crop-frame__third crop-frame__third--v" style={{ left: '33.333%' }} />
            <span className="crop-frame__third crop-frame__third--v" style={{ left: '66.667%' }} />
            <span className="crop-frame__third crop-frame__third--h" style={{ top: '33.333%' }} />
            <span className="crop-frame__third crop-frame__third--h" style={{ top: '66.667%' }} />
            {['tl', 'tr', 'bl', 'br'].map((corner) => (
              <span
                key={corner}
                className={`crop-frame__corner crop-frame__corner--${corner}`}
                onPointerDown={cornerHandlers ? (e) => cornerHandlers.down(corner, e) : undefined}
                onPointerMove={cornerHandlers?.move}
                onPointerUp={cornerHandlers?.up}
                onPointerCancel={cornerHandlers?.up}
              />
            ))}
          </div>
        )}
    </div>
    )}
    </div>
  )
}