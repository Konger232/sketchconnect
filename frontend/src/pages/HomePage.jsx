import Header from '../components/common/Header'
import Footer from '../components/common/Footer'
import VisitorHome from './VisitorHome'
import RegisteredUserHome from './RegisteredUserHome'
import { useAuth } from '../components/common/AuthContext'

// Home. A registered sketcher sees sketches near them, with search
// (RegisteredUserHome); their own page is behind their avatar. A visitor
// sees the public story and recent sketches (VisitorHome).
export default function HomePage() {
  const { user, loading } = useAuth()

  if (user) return <RegisteredUserHome />

  return (
    <div>
      <Header />
      {loading ? <main className="ed-page"><p className="text-ink/50">Loading…</p></main> : <VisitorHome />}
      <Footer />
    </div>
  )
}
