import { useRef, useState } from 'react'

// In Docker Compose, the frontend container reaches the backend container
// by its service name. In the browser (outside Docker), it's localhost.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function App() {
  const [imageUrl, setImageUrl] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const canvasRef = useRef(null)
  const imgRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setImageUrl(URL.createObjectURL(file))
    setResult(null)
    setLoading(true)

    const formData = new FormData()
    formData.append('image', file)

    try {
      const res = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      setResult(data)
    } catch (err) {
      console.error(err)
      alert('Could not reach the backend. Is it running?')
    } finally {
      setLoading(false)
    }
  }

  function handleImageLoad() {
    if (!result || !canvasRef.current || !imgRef.current) return
    const img = imgRef.current
    const canvas = canvasRef.current
    canvas.width = img.clientWidth
    canvas.height = img.clientHeight
    const scaleX = img.clientWidth / result.imageWidth
    const scaleY = img.clientHeight / result.imageHeight

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = 'white'
    ctx.lineWidth = 2
    result.lines?.forEach((l) => {
      ctx.beginPath()
      ctx.moveTo(l.x1 * scaleX, l.y1 * scaleY)
      ctx.lineTo(l.x2 * scaleX, l.y2 * scaleY)
      ctx.stroke()
    })
    if (result.vanishingPoint) {
      ctx.strokeStyle = 'red'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(
        result.vanishingPoint.x * scaleX,
        result.vanishingPoint.y * scaleY,
        14,
        0,
        2 * Math.PI
      )
      ctx.stroke()
    }
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 20 }}>
      <h2>SketchConnect — dev scaffold</h2>
      <input type="file" accept="image/*" onChange={handleFile} />
      {loading && <p>Analyzing...</p>}
      {imageUrl && (
        <div style={{ position: 'relative', marginTop: 16, maxWidth: 600 }}>
          <img
            ref={imgRef}
            src={imageUrl}
            style={{ width: '100%', display: 'block' }}
            onLoad={handleImageLoad}
          />
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
          />
        </div>
      )}
    </div>
  )
}
