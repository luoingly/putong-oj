import type { HonoEnv } from './types/koa'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process, { env } from 'node:process'
import { createAdaptorServer } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import config from './config'
import redis from './config/redis'
import { databaseSetup } from './config/setup'
import {
  createOnError,
  parseClientIp,
  setupAuditLog,
  setupRequestContext,
  setupSession,
} from './middlewares'
import apiApp from './routes'
import appLogger from './utils/logger'
import './config/db'

const publicDir = path.resolve(__dirname, '..', 'public')

const honoApp = new Hono<HonoEnv>({ strict: false })

// Logger for development
if (env.NODE_ENV === 'development') {
  honoApp.use(logger())
}

honoApp.use('*', parseClientIp)
honoApp.use('*', setupAuditLog)
honoApp.use('*', setupSession)
honoApp.use('*', setupRequestContext)

// API routes
honoApp.route('/api', apiApp)

// Static file serving (uploaded files, SPA assets, etc.)
honoApp.use('*', serveStatic({ root: publicDir }))

// SPA fallback – serve index.html for all unmatched routes
honoApp.get('*', async (c) => {
  const content = await readFile(path.join(publicDir, 'index.html'))
  return c.body(content, 200, { 'Content-Type': 'text/html; charset=utf-8' })
})

// Error handler
honoApp.onError(createOnError(honoApp))

// Compatibility wrapper: app.listen() creates a new http.Server per call,
// matching Koa's behaviour so supertest tests continue to work.
const app = {
  listen (...args: any[]) {
    const server = createAdaptorServer({ fetch: honoApp.fetch })
    return server.listen(...args)
  },
}

// If not in test environment, start the server and listen on the configured port
if (env.NODE_ENV !== 'test') {
  const server = createAdaptorServer({ fetch: honoApp.fetch })

  server.listen(config.port, async () => {
    await databaseSetup()
    appLogger.info(`The server is running at http://localhost:${config.port}`)
  })

  async function shutdown (signal: string) {
    appLogger.info(`Received ${signal}, shutting down...`)
    await redis.quit()
    appLogger.info('Redis connection closed')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

export default app
