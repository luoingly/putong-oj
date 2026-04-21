import type { MiddlewareHandler } from 'hono'
import type { HonoEnv } from '../types/koa'
import config from '../config'
import redis from '../config/redis'

function createRatelimitMiddleware (
  duration: number,
  max: number,
  id: (c: any) => string,
): MiddlewareHandler<HonoEnv> {
  if (config.disableRateLimit) {
    return async (_, next) => { await next() }
  }
  return async (c, next) => {
    const key = `ratelimit:${id(c)}`
    const current = await redis.incr(key)
    if (current === 1) {
      await redis.expire(key, duration)
    }
    if (current > max) {
      return c.json({ success: false, code: 429, message: 'Rate limit exceeded, please try again later.' }, 429)
    }
    await next()
  }
}

export function limitByIp (prefixKey: string, duration: number, max: number) {
  return createRatelimitMiddleware(duration, max, (c) => {
    const ip = (c.get('clientIp') || '').replace(/:/g, '_')
    return `${prefixKey}:${ip}`
  })
}

export function limitByUser (prefixKey: string, duration: number, max: number) {
  return createRatelimitMiddleware(duration, max, (c) => {
    const username = c.get('profile')?.uid || 'anonymous'
    return `${prefixKey}:${username}`
  })
}

export const userLoginLimit = limitByIp('user_login', 60, 10)
export const userRegisterLimit = limitByIp('user_register', 300, 5)
export const solutionCreateLimit = limitByUser('solution_create', 5, 1)
export const commentCreateLimit = limitByUser('comment_create', 30, 3)
export const discussionCreateLimit = limitByUser('discussion_create', 30, 1)
export const dataExportLimit = limitByUser('data_export', 5, 1)

const ratelimitMiddleware = {
  limitByIp,
  limitByUser,
  userLoginLimit,
  userRegisterLimit,
  solutionCreateLimit,
  commentCreateLimit,
  discussionCreateLimit,
  dataExportLimit,
} as const

export default ratelimitMiddleware
