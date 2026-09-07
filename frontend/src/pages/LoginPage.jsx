import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'

// Matches the Claude Design Login screen: shared Header/Footer templates
// (the .dc.html hardcodes its own one-off header here instead of reusing
// the Header component — consolidated onto the shared one instead, so the
// camera/add icon now appears here too), big "Login" heading, labeled
// fields, black submit button, Register + Forgot-password links. Register
// stays a mode toggle on this same page rather than a separate route —
// Supabase's signUp/signInWithPassword calls are otherwise identical. The
// nav drawer's "Register" link deep-links here via ?mode=register.
export default function LoginPage() {
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState(searchParams.get('mode') === 'register' ? 'sign_up' : 'sign_in')
  useEffect( () => {
    setMode(searchParams.get('mode') === 'register' ? 'sign_up' : 'sign_in')
  }, [searchParams])
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
    const { data, error } =
      mode === 'sign_in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
    } else if (mode === 'sign_up' && !data.session) {
      setNotice('Check your email to confirm your account.')
    } else {
      navigate('/')
    }
  } catch (err) {
    setError(err.message || 'Something went wrong. Please try again.')
  } finally {
    setLoading(false)
  }
  }

  async function handleForgotPassword() {
    if (!email) {
      setError('Enter your email above first, then click "Forgot password?"')
      return
    }
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    setNotice(error ? null : `Password reset email sent to ${email}.`)
    if (error) setError(error.message)
  }

  return (
    <div>
      <Header />

      <main className="mx-auto max-w-sm px-6 py-10">
        <h1 className="font-heading text-4xl font-bold text-ink">{mode === 'sign_in' ? 'Login' : 'Register'}</h1>
        
        {error && <p className="text-sm" style={{ color: 'var(--sc-error)' }}>{error}</p>}
        {notice && <p className="text-sm text-green-700">{notice}</p>}
        
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
          <label className="block">
            <span className="text-lg" style={{ color: 'var(--sc-label)' }}>Email</span>
            <input
              type="email"
              required
              placeholder="jane@framer.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="sc-input mt-2"
            />
          </label>
          <label className="block">
            <span className="text-lg" style={{ color: 'var(--sc-label)' }}>Password</span>
            <input
              type="password"
              required
              minLength={6}
              placeholder="enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="sc-input mt-2"
            />
          </label>


          <button disabled={loading} className="sc-btn-primary">
            {loading ? 'Please wait…' : mode === 'sign_in' ? 'Login' : 'Register'}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center gap-2 text-sm">
          <button onClick={() => setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')} className="text-blue-600 underline">
            {mode === 'sign_in' ? "Don't have an account yet? Register" : 'Already have an account? Login'}
          </button>
          {mode === 'sign_in' && (
            <button onClick={handleForgotPassword} className="text-blue-600 underline">
              Forgot password?
            </button>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
