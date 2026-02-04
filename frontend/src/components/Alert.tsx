'use client'

import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react'
import { ReactNode } from 'react'

interface Props {
  variant?: 'error' | 'warning' | 'info' | 'success'
  children: ReactNode
  className?: string
}

const variants = {
  error: {
    container: 'bg-red-900/20 border-red-800',
    icon: 'text-red-400',
    text: 'text-red-200',
    Icon: XCircle,
  },
  warning: {
    container: 'bg-amber-900/20 border-amber-800',
    icon: 'text-amber-400',
    text: 'text-amber-200',
    Icon: AlertTriangle,
  },
  info: {
    container: 'bg-blue-900/20 border-blue-800',
    icon: 'text-blue-400',
    text: 'text-blue-200',
    Icon: Info,
  },
  success: {
    container: 'bg-green-900/20 border-green-800',
    icon: 'text-green-400',
    text: 'text-green-200',
    Icon: CheckCircle,
  },
}

export function Alert({ variant = 'info', children, className = '' }: Props) {
  const v = variants[variant]
  const Icon = v.Icon

  return (
    <div className={`flex items-start gap-3 p-3 border rounded-lg ${v.container} ${className}`}>
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${v.icon}`} />
      <div className={`text-sm ${v.text}`}>{children}</div>
    </div>
  )
}
