import type { SessionData } from '../types/koa'
import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = 'ptoj.session'
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
}

function sign (payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function encodeCookie (data: Omit<SessionData, '_modified'>, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const signature = sign(payload, secret)
  return `${payload}.${signature}`
}

function decodeCookie (value: string, secret: string): SessionData | null {
  const dotIndex = value.lastIndexOf('.')
  if (dotIndex < 0) {
    return null
  }
  const payload = value.slice(0, dotIndex)
  const signature = value.slice(dotIndex + 1)
  const expected = sign(payload, secret)
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null
    }
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return parsed as SessionData
  } catch {
    return null
  }
}

export { COOKIE_NAME, COOKIE_OPTIONS, decodeCookie, encodeCookie }
