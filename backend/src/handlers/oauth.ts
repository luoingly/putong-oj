import type { OAuthConnection } from '@putongoj/shared'
import type { AppContext, HonoEnv } from '../types/koa'
import type { UserDocument } from '../models/User'
import type { OAuthState } from '../services/oauth'
import { Hono } from 'hono'
import {
  ErrorCode,
  OAuthAction,
  OAuthCallbackQueryResultSchema,
  OAuthCallbackQuerySchema,
  OAuthGenerateUrlQueryResultSchema,
  OAuthGenerateUrlQuerySchema,
  OAuthProvider,
  OAuthProviderSchema,
  OAuthUserConnectionsQueryResultSchema,
} from '@putongoj/shared'
import { loadProfile, loginRequire } from '../middlewares/authn'
import oauthService from '../services/oauth'
import sessionService from '../services/session'
import { createEnvelopedResponse, createErrorResponse, createZodErrorResponse } from '../utils'

export const providerMap: Record<string, OAuthProvider> = {
  cjlu: OAuthProvider.CJLU,
  codeforces: OAuthProvider.Codeforces,
} as const

const loginEnabledProviders: OAuthProvider[] = [
  OAuthProvider.CJLU,
] as const

export async function generateOAuthUrl (c: AppContext) {
  const provider = OAuthProviderSchema.safeParse(c.req.param('provider'))
  if (!provider.success) {
    return createZodErrorResponse(c, provider.error)
  }
  const query = OAuthGenerateUrlQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }

  try {
    const url = await oauthService.generateOAuthUrl(provider.data, query.data.action)
    const response = OAuthGenerateUrlQueryResultSchema.encode({ url })
    return createEnvelopedResponse(c, response)
  } catch (error: any) {
    return createErrorResponse(c, ErrorCode.BadRequest, error.message)
  }
}

export async function handleOAuthCallback (c: AppContext) {
  const provider = OAuthProviderSchema.safeParse(c.req.param('provider'))
  if (!provider.success) {
    return createZodErrorResponse(c, provider.error)
  }
  const query = OAuthCallbackQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }

  let stateData: OAuthState | null = null
  let connection: OAuthConnection | null = null
  try {
    const result = await oauthService.handleOAuthCallback(
      provider.data, query.data.state, query.data.code)
    stateData = result.stateData
    connection = result.connection
  } catch (error: any) {
    return createErrorResponse(c, ErrorCode.BadRequest, error.message)
  }

  let user: UserDocument | null = null
  if (stateData.action === OAuthAction.CONNECT) {
    const profile = await loadProfile(c)
    const isConnected = await oauthService
      .isOAuthConnectedToAnotherUser(profile._id, connection)
    if (isConnected) {
      return createErrorResponse(c, ErrorCode.BadRequest, 'This 3rd-party account has been connected to another user')
    }
    user = profile
  } else if (stateData.action === OAuthAction.LOGIN) {
    const { provider: prov, providerId } = connection
    if (!loginEnabledProviders.includes(prov)) {
      return createErrorResponse(c, ErrorCode.BadRequest, `Login via ${prov} OAuth is not enabled`)
    }
    const connectedUser = await oauthService
      .findUserByOAuthConnection(prov, providerId)
    if (!connectedUser) {
      return createErrorResponse(c, ErrorCode.BadRequest, 'No user is connected with this 3rd-party account, please login first and bind it')
    }
    user = connectedUser

    const userId = user._id.toString()
    const sessionId = await sessionService.createSession(
      userId, c.get('clientIp'), c.req.header('User-Agent') || '',
    )
    const session = c.get('session')
    session.userId = userId
    session.sessionId = sessionId
    session._modified = true

    c.get('auditLog').info(`<User:${user.uid}> logged in via ${prov} OAuth`)
  } else {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Invalid OAuth action')
  }
  const updatedConnection = await oauthService
    .upsertOAuthConnection(user._id, connection)
  const response = OAuthCallbackQueryResultSchema.encode({
    action: stateData.action,
    connection: updatedConnection,
  })
  return createEnvelopedResponse(c, response)
}

export async function getUserOAuthConnections (c: AppContext) {
  const profile = await loadProfile(c)
  const connections = await oauthService.getUserOAuthConnections(profile._id)
  const result = OAuthUserConnectionsQueryResultSchema.encode(connections)
  return createEnvelopedResponse(c, result)
}

function registerOAuthHandlers (app: Hono<HonoEnv>) {
  const oauthApp = new Hono<HonoEnv>()

  oauthApp.get('/', loginRequire, getUserOAuthConnections)
  oauthApp.get('/:provider/url', generateOAuthUrl)
  oauthApp.get('/:provider/callback', handleOAuthCallback)

  app.route('/oauth', oauthApp)
}

export default registerOAuthHandlers
