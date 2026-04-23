import type { AppContext, HonoEnv } from '../types/koa'
import { TagListQueryResultSchema } from '@putongoj/shared'
import { Hono } from 'hono'
import tagService from '../services/tag'
import { createEnvelopedResponse } from '../utils'

export async function findTags (c: AppContext) {
  const tags = await tagService.getTags()
  const result = TagListQueryResultSchema.encode(tags)
  return createEnvelopedResponse(c, result)
}

function registerTagHandlers (app: Hono<HonoEnv>) {
  const tagApp = new Hono<HonoEnv>()

  tagApp.get('/', findTags)

  app.route('/tags', tagApp)
}

export default registerTagHandlers
