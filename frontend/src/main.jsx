import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './assets/styles/index.css'

// Sketchers' images can't be saved with a right-click (design doc:
// protecting sketchers' work). A deterrent, not a lock: CSS also turns off
// dragging and the phone's long-press "Save image".
document.addEventListener('contextmenu', (e) => {
  if (e.target instanceof HTMLImageElement || e.target.closest?.('.ed-slide, .protect')) e.preventDefault()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
