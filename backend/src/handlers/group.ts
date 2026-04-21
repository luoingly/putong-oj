import type { AppContext, HonoEnv } from '../types/koa'
import { Hono } from 'hono'
import { GroupListQueryResultSchema } from '@putongoj/shared'
import groupService from '../services/group'
import { createEnvelopedResponse } from '../utils'

export async function findGroups (c: AppContext) {
  const groups = await groupService.findGroups()
  const result = GroupListQueryResultSchema.encode(groups)
  return createEnvelopedResponse(c, result)
}

function registerGroupHandlers (app: Hono<HonoEnv>) {
  const groupApp = new Hono<HonoEnv>()

  groupApp.get('/', findGroups)

  app.route('/group', groupApp)
}

export default registerGroupHandlers
