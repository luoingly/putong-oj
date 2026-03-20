import type { Context } from 'koa'
import { env } from 'node:process'
import { AvatarPresetsQueryResultSchema, PublicConfigQueryResultSchema } from '@putongoj/shared'
import { v4 } from 'uuid'
import { globalConfig } from '../config'
import redis from '../config/redis'
import { loadProfile } from '../middlewares/authn'
import cryptoService from '../services/crypto'
import { settingsService } from '../services/settings'
import { createEnvelopedResponse } from '../utils'

function parseBuildTime (): Date | null {
  const buildTimeStr = env.NODE_BUILD_TIME
  if (!buildTimeStr) {
    return null
  }
  const timestamp = Date.parse(buildTimeStr)
  if (Number.isNaN(timestamp)) {
    return null
  }
  return new Date(timestamp)
}

const commitHash = env.NODE_BUILD_SHA || 'unknown'
const buildAt = parseBuildTime()

const serverTime = (ctx: Context) => {
  ctx.body = {
    serverTime: Date.now(),
  }
}

export async function getPublicConfig (ctx: Context) {
  const { helpDocURL, oauthConfigs, umamiAnalytics } = globalConfig
  const apiPublicKey = await cryptoService.getServerPublicKey()
  const result = PublicConfigQueryResultSchema.encode({
    name: 'Putong OJ',
    backendVersion: {
      commitHash,
      buildAt: buildAt || new Date(),
    },
    apiPublicKey,
    oauthEnabled: {
      CJLU: oauthConfigs.CJLU.enabled,
      Codeforces: oauthConfigs.Codeforces.enabled,
    },
    helpDocURL,
    umamiAnalytics: umamiAnalytics.websiteId
      ? {
          websiteId: umamiAnalytics.websiteId,
          scriptURL: umamiAnalytics.scriptURL,
        }
      : undefined,
  })
  return createEnvelopedResponse(ctx, result)
}

export async function getWebSocketToken (ctx: Context) {
  const profile = await loadProfile(ctx)
  const token = v4()
  await redis.setex(`websocket:token:${token}`, 10, profile.uid)
  return createEnvelopedResponse(ctx, { token })
}

export async function getAvatarPresets (ctx: Context) {
  const presets = await settingsService.getAvatarPresets()
  const result = AvatarPresetsQueryResultSchema.parse(presets)
  return createEnvelopedResponse(ctx, result)
}

const utilsController = {
  serverTime,
  getPublicConfig,
  getWebSocketToken,
  getAvatarPresets,
} as const

export default utilsController
