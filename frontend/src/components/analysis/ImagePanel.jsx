import { useRef } from 'react'

export default function ImagePanel({
  containerRef,
  imgRef,
  svgRef,
  boxSize,
  imageUrl,
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
      className={`relative flex w-full items-center justify-center overflow-hidden bg-black p-3 md:p-4 ${heightClass}`}
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
        crossOrigin="anonymous"
        onLoad={onImageLoad}
        style={
            box
            ? {
                position: 'absolute',
                width: `${box.width}px`,
                height: `${box.height}px`,
                left: `${box.left}px`,
                top: `${box.top}px`,
                // transform: `translate(${offset.x * boxSize.width}px, ${offset.y * boxSize.height}px) scale(${zoom})`,
                // transformOrigin: '0 0',
                pointerEvents: 'none',
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