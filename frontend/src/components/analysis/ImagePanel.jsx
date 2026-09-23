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
  zoom = 1,
  offset = { x: 0, y: 0 },
  box,
  heightClass,
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onImageLoad,
  onClick,
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
      className={`relative flex w-full select-none items-center justify-center overflow-hidden bg-black p-3 md:p-4 ${heightClass}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
        overflow: 'hidden',
        // border: '0.5px solid grey',
        }}
        >
        <img
        ref={imgRef}
        src={imageUrl}
        alt=""
        crossOrigin={crossOrigin}
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
            style={{
            border: '0.5px solid grey',
            // transform: `translate(${offset.x * boxSize.width}px, ${offset.y * boxSize.height}px) scale(${zoom})`,
            // transformOrigin: '0 0',
            }}
        >
            {children}
        </svg>
        )}
    </div>
    )}
    </div>
  )
}