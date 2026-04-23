import type { MiddlewareHandler } from 'hono'
import type { HonoEnv } from '../types/koa'
import { ErrorCode, ErrorCodeValues } from '@putongoj/shared'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import config from '../config'
import { COOKIE_NAME, COOKIE_OPTIONS, decodeCookie, encodeCookie } from '../services/cookieSession'
import { createErrorResponse } from '../utils'
import logger from '../utils/logger'
import authnMiddleware from './authn'

export const parseClientIp: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const { reverseProxy } = config
  const remoteIp: string = (c.env as any)?.incoming?.socket?.remoteAddress || '127.0.0.1'
  if (!reverseProxy.enabled) {
    c.set('clientIp', remoteIp)
    await next()
    return
  }

  const { forwardLimit } = reverseProxy
  const trustedProxies = new Set(reverseProxy.trustedProxies)
  const forwardedHeader = c.req.header(reverseProxy.forwardedForHeader) || ''

  let ipChain: string[] = []
  if (forwardedHeader) {
    ipChain = forwardedHeader.split(',').map(s => s.trim()).filter(s => s)
  }
  ipChain.push(remoteIp)

  let forwardCount = 0
  let clientIp = remoteIp

  for (let i = ipChain.length - 1; i >= 0; i -= 1) {
    if (forwardCount >= forwardLimit) {
      clientIp = ipChain[i]
      break
    }
    if (!trustedProxies.has(ipChain[i])) {
      clientIp = ipChain[i]
      break
    }

    forwardCount += 1

    if (i === 0) {
      clientIp = ipChain[0]
    }
  }

  c.set('clientIp', clientIp)
  await next()
}

export const setupAuditLog: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const buildTraceInfo = () => {
    const requestId = c.get('requestId')
    const clientIp = c.get('clientIp')
    const sessionId = c.get('sessionId')
    const trace = [ `Req ${requestId}`, `IP ${clientIp}` ]
    if (sessionId) {
      trace.push(`Sess ${sessionId}`)
    }
    return `[${trace.join(', ')}]`
  }

  c.set('auditLog', {
    info (message: string) {
      logger.info(`${message} ${buildTraceInfo()}`)
    },
    error (message: string, error?: any) {
      const trace = buildTraceInfo()
      if (error) {
        logger.error(`${message} ${trace}`, error)
      } else {
        logger.error(`${message} ${trace}`)
      }
    },
    warn (message: string) {
      logger.warn(`${message} ${buildTraceInfo()}`)
    },
  })
  await next()
}

export const setupSession: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const cookieValue = getCookie(c, COOKIE_NAME)
  const session = cookieValue
    ? decodeCookie(cookieValue, config.secretKey) ?? {}
    : {}

  c.set('session', session)
  await next()

  // Write session cookie if modified
  if (session._modified) {
    if (session.userId || session.sessionId) {
      const { _modified: _, ...sessionData } = session
      setCookie(c, COOKIE_NAME, encodeCookie(sessionData, config.secretKey), {
        ...COOKIE_OPTIONS,
        maxAge: config.sessionMaxAge,
      })
    } else {
      deleteCookie(c, COOKIE_NAME, { path: '/' })
    }
  }
}

export const setupRequestContext: MiddlewareHandler<HonoEnv> = async (c, next) => {
  c.set('requestId', c.req.header('X-Request-ID') || 'unknown')
  await authnMiddleware.checkSession(c)
  await next()
}

export function createOnError (_app: { fetch: any }) {
  return (err: Error, c: any) => {
    const auditLog = c.get('auditLog')

    let errorCode: ErrorCode
    let message: string | undefined

    if (err instanceof HTTPException) {
      errorCode = ErrorCodeValues.includes(err.status)
        ? (err.status as ErrorCode)
        : ErrorCode.InternalServerError
      message = err.message
    } else {
      errorCode = ErrorCode.InternalServerError
      message = undefined
    }

    if (errorCode >= ErrorCode.InternalServerError) {
      if (auditLog) {
        auditLog.error('Unhandled server error', err)
      } else {
        logger.error('Unhandled server error', err)
      }
    } else {
      if (auditLog) {
        auditLog.warn(`HTTP/${errorCode}: ${err.message}`)
      }
    }

    return createErrorResponse(c, errorCode, message)
  }
}
