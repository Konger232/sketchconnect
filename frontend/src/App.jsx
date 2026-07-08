import { useRef, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function ValueStudyDemo() {
  const [imageUrl, setImageUrl] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [levels, setLevels] = useState(4)
  const [resultImage, setResultImage] = useState(null)
  const [toneValues, setToneValues] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setSelectedFile(file)
    setImageUrl(URL.createObjectURL(file))
    setResultImage(null)
    setError(null)
  }

  async function handleGenerate() {
    if (!selectedFile) return
    setLoading(true)
    setError(null)

    const formData = new FormData()
    formData.append('image', selectedFile)
    formData.append('levels', String(levels))

    try {
      const res = await fetch(`${API_URL}/value-study`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
        setResultImage(null)
      } else {
        setResultImage(data.valueStudyImage)
        setToneValues(data.toneValues)
      }
    } catch (err) {
      console.error(err)
      setError('Could not reach the backend. Is it running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid #ddd' }}>
      <h2>Value Study</h2>
      <input type="file" accept="image/*" onChange={handleFile} />

      <div style={{ marginTop: 12 }}>
        <label>
          Tonal levels:{' '}
          <input
            type="number"
            min={2}
            max={8}
            value={levels}
            onChange={(e) => setLevels(Number(e.target.value))}
            style={{ width: 50 }}
          />
        </label>
        <button
          onClick={handleGenerate}
          disabled={!selectedFile || loading}
          style={{ marginLeft: 12 }}
        >
          {loading ? 'Generating...' : 'Generate value study'}
        </button>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        {imageUrl && (
          <div>
            <p>Original</p>
            <img src={imageUrl} style={{ maxWidth: 400, display: 'block' }} />
          </div>
        )}
        {resultImage && (
          <div>
            <p>{levels}-value study</p>
            <img src={resultImage} style={{ maxWidth: 400, display: 'block' }} />
            {toneValues && (
              <p style={{ fontSize: 12, color: '#666' }}>
                Tone values used: {toneValues.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

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

      <ValueStudyDemo />
    </div>
  )
}