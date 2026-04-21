import type { AppContext, HonoEnv } from '../types/koa'
import type { UserDocument } from '../models/User'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  ErrorCode,
  JudgeStatus,
  UserItemListQueryResultSchema,
  UserProfileQueryResultSchema,
  UserRanklistExportQueryResultSchema,
  UserRanklistExportQuerySchema,
  UserRanklistQueryResultSchema,
  UserRanklistQuerySchema,
  UserSuggestQueryResultSchema,
  UserSuggestQuerySchema,
} from '@putongoj/shared'
import difference from 'lodash/difference'
import { adminRequire, loadProfile, loginRequire } from '../middlewares/authn'
import { dataExportLimit } from '../middlewares/ratelimit'
import Group from '../models/Group'
import Solution from '../models/Solution'
import userService from '../services/user'
import {
  createEnvelopedResponse,
  createErrorResponse,
  createZodErrorResponse,
} from '../utils'
import { ERR_INVALID_ID, ERR_NOT_FOUND } from '../utils/constants'

export async function loadUser (
  c: AppContext,
  input?: string,
): Promise<UserDocument> {
  const uid = String(c.req.param('uid') || input || '').trim()
  if (!uid) {
    throw new HTTPException(ERR_INVALID_ID[0] as number, { message: ERR_INVALID_ID[1] })
  }
  if (c.get('user')?.uid === uid) {
    return c.get('user')!
  }

  const user = await userService.getUser(uid)
  if (!user) {
    throw new HTTPException(ERR_NOT_FOUND[0] as number, { message: ERR_NOT_FOUND[1] })
  }

  c.set('user', user)
  return user
}

export async function findRanklist (c: AppContext) {
  const query = UserRanklistQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }

  const users = await userService.findRanklist(query.data)
  const result = UserRanklistQueryResultSchema.encode(users)
  return createEnvelopedResponse(c, result)
}

export async function exportRanklist (c: AppContext) {
  const query = UserRanklistExportQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }
  const profile = await loadProfile(c)
  if (!query.data.group && !profile.isAdmin) {
    return createErrorResponse(c, ErrorCode.Forbidden, 'Insufficient privilege to export full ranklist')
  }

  const users = await userService.exportRanklist(query.data)
  const result = UserRanklistExportQueryResultSchema.encode(users)
  return createEnvelopedResponse(c, result)
}

export async function getUser (c: AppContext) {
  const user = await loadUser(c)
  const [ solved, failed, groups, submissionHeatmap ] = await Promise.all([
    Solution
      .find({ uid: user.uid, judge: JudgeStatus.Accepted })
      .distinct('pid')
      .lean(),
    Solution
      .find({ uid: user.uid, judge: { $nin: [ JudgeStatus.Accepted, JudgeStatus.Skipped ] } })
      .distinct('pid')
      .lean(),
    Group
      .find({ gid: { $in: user.gid } })
      .select('-_id gid title')
      .lean(),
    userService.getSubmissionHeatmap(user._id),
  ])

  const codeforces = await userService.getCodeforcesProfile(user._id)
  const attempted = difference(failed, solved)
  const result = UserProfileQueryResultSchema.encode({
    ...user.toObject(), groups, solved, attempted, codeforces, submissionHeatmap,
  })
  return createEnvelopedResponse(c, result)
}

export async function suggestUsers (c: AppContext) {
  const query = UserSuggestQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }

  const users = await userService.suggestUsers(query.data.keyword, 10)
  const result = UserSuggestQueryResultSchema.encode(users)
  return createEnvelopedResponse(c, result)
}

export async function getAllUserItems (c: AppContext) {
  const users = await userService.getAllUserItems()
  const result = UserItemListQueryResultSchema.encode(users)
  return createEnvelopedResponse(c, result)
}

function registerUserHandlers (app: Hono<HonoEnv>) {
  const userApp = new Hono<HonoEnv>()

  userApp.get('/items', adminRequire, getAllUserItems)
  userApp.get('/suggest', loginRequire, suggestUsers)
  userApp.get('/ranklist', findRanklist)
  userApp.get('/ranklist/export', loginRequire, dataExportLimit, exportRanklist)
  userApp.get('/:uid', getUser)

  app.route('/users', userApp)
}

export default registerUserHandlers
