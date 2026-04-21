import type { AppContext, HonoEnv } from '../types/koa'
import { env } from 'node:process'
import { Hono } from 'hono'
import { AvatarPresetsQueryResultSchema, PublicConfigQueryResultSchema } from '@putongoj/shared'
import { v4 } from 'uuid'
import { globalConfig } from '../config'
import redis from '../config/redis'
import { loadProfile, loginRequire } from '../middlewares/authn'
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

const serverTime = (c: AppContext) => {
  return c.json({
    serverTime: Date.now(),
  })
}

export async function getPublicConfig (c: AppContext) {
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
      cjlu: oauthConfigs.cjlu.enabled,
      codeforces: oauthConfigs.codeforces.enabled,
    },
    helpDocURL,
    umamiAnalytics: umamiAnalytics.websiteId
      ? {
          websiteId: umamiAnalytics.websiteId,
          scriptURL: umamiAnalytics.scriptURL,
        }
      : undefined,
  })
  return createEnvelopedResponse(c, result)
}

export async function getWebSocketToken (c: AppContext) {
  const profile = await loadProfile(c)
  const token = v4()
  await redis.setex(`websocket:token:${token}`, 10, profile.uid)
  return createEnvelopedResponse(c, { token })
}

export async function getAvatarPresets (c: AppContext) {
  const presets = await settingsService.getAvatarPresets()
  const result = AvatarPresetsQueryResultSchema.parse(presets)
  return createEnvelopedResponse(c, result)
}

function registerUtilsHandlers (app: Hono<HonoEnv>) {
  const utilsApp = new Hono<HonoEnv>()

  utilsApp.get('/servertime', serverTime)
  utilsApp.get('/config', getPublicConfig)
  utilsApp.get('/websocket/token', loginRequire, getWebSocketToken)
  utilsApp.get('/utils/avatar-presets', loginRequire, getAvatarPresets)

  app.route('/', utilsApp)
}

export default registerUtilsHandlers
