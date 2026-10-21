import VisitorHome from './VisitorHome'
import RegisteredUserHome from './RegisteredUserHome'
import { PageMessage } from '../components/common/BasePage'
import { useAuth } from '../components/common/AuthContext'

// Home. A registered sketcher sees sketches near them, with search
// (RegisteredUserHome); their own page is behind their avatar. A visitor
// sees the public story and recent sketches (VisitorHome). Both build on
// BasePage.
export default function HomePage() {
  const { user, loading } = useAuth()
  if (user) return <RegisteredUserHome />
  if (loading) return <PageMessage muted>Loading…</PageMessage>
  return <VisitorHome />
}
