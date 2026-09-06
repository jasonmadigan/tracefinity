import { loginReturnDestination } from '@/lib/loginReturn'
import LoginForm from './login-form'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>
}) {
  const { returnTo } = await searchParams
  const destination = loginReturnDestination(returnTo, process.env.AUTH_LOGIN_RETURN_ORIGINS)
  return <LoginForm returnTo={destination} />
}
