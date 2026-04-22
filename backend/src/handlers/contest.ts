import type { ContestModel } from '@putongoj/shared'
import type { AppContext, HonoEnv } from '../types/koa'
import type { Types } from 'mongoose'
import type { DiscussionQueryFilters } from '../services/discussion'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  ContestConfigEditPayloadSchema,
  ContestConfigQueryResultSchema,
  ContestCreatePayloadSchema,
  ContestDetailQueryResultSchema,
  ContestListQueryResultSchema,
  ContestListQuerySchema,
  ContestParticipantListQueryResultSchema,
  ContestParticipantListQuerySchema,
  ContestParticipantUpdatePayloadSchema,
  ContestParticipatePayloadSchema,
  ContestParticipationQueryResultSchema,
  ContestRanklistQueryResultSchema,
  ContestSolutionListExportQueryResultSchema,
  ContestSolutionListExportQuerySchema,
  ContestSolutionListQueryResultSchema,
  ContestSolutionListQuerySchema,
  DiscussionListQueryResultSchema,
  DiscussionListQuerySchema,
  ErrorCode,
  JudgeStatus,
  ParticipationStatus,
} from '@putongoj/shared'
import { loadProfile, loginRequire } from '../middlewares/authn'
import { dataExportLimit } from '../middlewares/ratelimit'
import Group from '../models/Group'
import Problem from '../models/Problem'
import Solution from '../models/Solution'
import User from '../models/User'
import { loadContestState } from '../policies/contest'
import { loadCourseStateById, loadCourseStateOrThrow } from '../policies/course'
import { publicDiscussionTypes } from '../policies/discussion'
import { CacheKey, cacheService } from '../services/cache'
import { contestService } from '../services/contest'
import discussionService from '../services/discussion'
import solutionService from '../services/solution'
import { getUser } from '../services/user'
import {
  createEnvelopedResponse,
  createErrorResponse,
  createZodErrorResponse,
} from '../utils'
import { ERR_PERM_DENIED } from '../utils/constants'

async function findContests (c: AppContext) {
  const query = ContestListQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }

  const profile = c.get('profile')
  const { page, pageSize, sort, sortBy, title, course: courseId } = query.data

  let showHidden: boolean = !!profile?.isAdmin
  let courseDocId: Types.ObjectId | undefined
  if (courseId) {
    const { course, role } = await loadCourseStateOrThrow(c, courseId)
    if (!role.basic) {
      throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
    }
    if (role.manageContest) {
      showHidden = true
    }
    courseDocId = course._id
  }

  const contests = await contestService.findContests(
    { page, pageSize, sort, sortBy },
    { title, course: courseDocId }, showHidden)
  const result = ContestListQueryResultSchema.encode(contests)
  return createEnvelopedResponse(c, result)
}

async function getParticipation (c: AppContext) {
  const state = await loadContestState(c)
  if (!state) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }

  const { contest, participation, isJury, isIpBlocked, hasStarted } = state
  const profile = await loadProfile(c)
  let canParticipate: boolean = false
  let canParticipateByPassword: boolean = false

  if (!isIpBlocked) {
    if (contest.isPublic || isJury) {
      canParticipate = true
    } else {
      if (contest.password && contest.password.length > 0) {
        canParticipateByPassword = true
      }
      if (contest.allowedUsers.includes(profile._id)) {
        canParticipate = true
      }
      /**
       * @TODO allowed groups
       */
    }
  }

  const result = ContestParticipationQueryResultSchema.encode({
    isJury, participation, canParticipate, canParticipateByPassword, isIpBlocked, hasStarted,
  })
  return createEnvelopedResponse(c, result)
}

async function findParticipants (c: AppContext) {
  const query = ContestParticipantListQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }
  const state = await loadContestState(c)
  if (!state || !state.isJury) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }

  const participants = await contestService.findParticipants(
    state.contest._id, query.data,
    { user: query.data.user, status: query.data.status },
  )
  const result = ContestParticipantListQueryResultSchema.encode(participants)
  return createEnvelopedResponse(c, result)
}

async function updateParticipantStatus (c: AppContext) {
  const body = await c.req.json().catch(() => ({}))
  const payload = ContestParticipantUpdatePayloadSchema.safeParse(body)
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }
  const state = await loadContestState(c)
  if (!state || !state.isJury) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }

  const profile = await loadProfile(c)
  const user = await getUser(c.req.param('username'))
  if (!user) {
    return createErrorResponse(c, ErrorCode.NotFound, 'User not found')
  }

  const updated = await contestService.updateParticipantStatus(
    user._id, state.contest._id, payload.data.status,
  )
  if (!updated) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Participation not found')
  }

  c.get('auditLog').info(
    `<User:${profile.uid}> updated <User:${user.uid}> participation in <Contest:${state.contest.contestId}> to <ParticipationStatus:${payload.data.status}>`,
  )
  return createEnvelopedResponse(c, null)
}

async function participateContest (c: AppContext) {
  const body = await c.req.json().catch(() => ({}))
  const payload = ContestParticipatePayloadSchema.safeParse(body)
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }
  const state = await loadContestState(c)
  if (!state) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }
  const profile = await loadProfile(c)
  const { contest, participation, isJury } = state

  if (state.isIpBlocked) {
    return createErrorResponse(c, ErrorCode.Forbidden, 'Your IP address is not in the whitelist for this contest')
  }

  if (participation !== ParticipationStatus.NotApplied) {
    return createErrorResponse(c, ErrorCode.BadRequest, 'You have already participated in this contest')
  }

  let canParticipate: boolean = false
  if (contest.isPublic || isJury) {
    canParticipate = true
  } else {
    const pwd = payload.data.password ?? ''
    if (contest.password && contest.password.length > 0 && contest.password === pwd) {
      canParticipate = true
    }
  }
  if (!canParticipate) {
    return createErrorResponse(c, ErrorCode.Forbidden, 'You cannot participate in this contest')
  }

  await contestService.updateParticipation(
    profile._id, contest._id, ParticipationStatus.Approved)
  c.get('auditLog').info(`<User:${profile.uid}> participated in contest <Contest:${contest.contestId}>`)
  return createEnvelopedResponse(c, null)
}

async function getContest (c: AppContext) {
  const state = await loadContestState(c)
  if (!state || !state.accessible) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }
  const profile = await loadProfile(c)
  const { contest, isJury } = state

  const [ problemsBasic, attempted, solved ] = await Promise.all([
    contestService.getProblemsWithStats(contest._id, isJury),
    Solution.distinct('pid', {
      mid: contest.contestId, uid: profile.uid,
    }).lean(),
    Solution.distinct('pid', {
      mid: contest.contestId, uid: profile.uid, judge: JudgeStatus.Accepted,
    }).lean(),
  ])

  const problems = problemsBasic.map(problem => ({
    ...problem,
    isAttempted: attempted.includes(problem.problemId),
    isSolved: solved.includes(problem.problemId),
  }))

  let course: { courseId: number, name: string } | null = null
  if (contest.course) {
    const courseState = await loadCourseStateById(c, contest.course)
    if (courseState) {
      const { courseId, name } = courseState.course
      course = { courseId, name }
    }
  }
  const result = ContestDetailQueryResultSchema.encode({
    ...contest, isJury, problems, course,
  })
  return createEnvelopedResponse(c, result)
}

async function getConfig (c: AppContext) {
  const state = await loadContestState(c)
  if (!state || !state.isJury) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }
  const { contest } = state

  const [ allowedUsers, allowedGroups, problems ] = await Promise.all([
    (async () => {
      const users = await User
        .find({ _id: { $in: contest.allowedUsers } })
        .select({ _id: 0, uid: 1, nick: 1 })
        .lean()
      return users.map(({ uid, nick }) => ({ username: uid, nickname: nick }))
    })(),
    (async () => {
      const groups = await Group
        .find({ _id: { $in: contest.allowedGroups } })
        .select({ _id: 0, gid: 1, title: 1 })
        .lean()
      return groups.map(({ gid, title }) => ({ groupId: gid, name: title }))
    })(),
    (async () => {
      const problems = await Problem
        .find({ _id: { $in: contest.problems } })
        .select({ _id: 1, pid: 1, title: 1 })
        .lean()
      return problems
        .map(({ _id, pid, title }) => ({
          index: contest.problems.findIndex((p: Types.ObjectId) => p.equals(_id)),
          problemId: pid, title,
        }))
        .sort((a, b) => a.index - b.index)
    })(),
  ])

  const ipWhitelist = (contest.ipWhitelist ?? []).map((entry: any) => ({
    cidr: entry.cidr,
    comment: entry.comment === undefined ? null : entry.comment,
  }))

  let course: { courseId: number, name: string } | null = null
  if (contest.course) {
    const courseState = await loadCourseStateById(c, contest.course)
    if (courseState) {
      const { courseId, name } = courseState.course
      course = { courseId, name }
    }
  }

  const result = ContestConfigQueryResultSchema.encode({
    ...contest,
    ipWhitelist,
    scoreboardFrozenAt: contest.scoreboardFrozenAt ?? null,
    scoreboardUnfrozenAt: contest.scoreboardUnfrozenAt ?? null,
    allowedUsers,
    allowedGroups,
    problems,
    course,
  })
  return createEnvelopedResponse(c, result)
}

async function updateConfig (c: AppContext) {
  const body = await c.req.json().catch(() => ({}))
  const payload = ContestConfigEditPayloadSchema.safeParse(body)
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }
  const state = await loadContestState(c)
  if (!state || !state.isJury) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }
  const profile = await loadProfile(c)
  const { contest } = state

  let allowedUsers: Types.ObjectId[] | undefined
  if (payload.data.allowedUsers !== undefined) {
    const users = await User.find({ uid: { $in: payload.data.allowedUsers } }).select([ '_id' ]).lean()
    allowedUsers = users.map(u => u._id)
  }
  let allowedGroups: Types.ObjectId[] | undefined
  if (payload.data.allowedGroups !== undefined) {
    const groups = await Group.find({ gid: { $in: payload.data.allowedGroups } }).select([ '_id' ]).lean()
    allowedGroups = groups.map(g => g._id)
  }
  let ipWhitelist: { cidr: string, comment: string | null }[] | undefined
  if (payload.data.ipWhitelist !== undefined) {
    ipWhitelist = payload.data.ipWhitelist.map(entry => ({
      cidr: entry.cidr,
      comment: entry.comment === undefined ? null : entry.comment,
    }))
  }
  let problems: Types.ObjectId[] | undefined
  if (payload.data.problems !== undefined) {
    const problemsOrder = payload.data.problems
    const problemsDocs = await Problem.find({ pid: { $in: payload.data.problems } }).select([ '_id', 'pid' ]).lean()
    problems = problemsDocs.sort((a, b) => {
      return problemsOrder.indexOf(a.pid) - problemsOrder.indexOf(b.pid)
    }).map(p => p._id)
  }
  let course: Types.ObjectId | null | undefined
  if (profile.isRoot && payload.data.course !== undefined) {
    if (payload.data.course === null) {
      course = null
    } else {
      const courseDoc = await loadCourseStateOrThrow(c, payload.data.course)
      course = courseDoc.course._id
    }
  }

  const data: Partial<ContestModel> = {
    ...payload.data,
    allowedUsers,
    allowedGroups, ipWhitelist,
    problems,
    course,
  }

  await contestService.updateContest(contest.contestId, data)
  c.get('auditLog').info(`<Contest:${contest.contestId}> config updated`)

  if (problems !== undefined) {
    await Promise.all([
      cacheService.remove(CacheKey.contestProblems(contest._id, true)),
      cacheService.remove(CacheKey.contestProblems(contest._id, false)),
    ])
  }

  return createEnvelopedResponse(c, null)
}

export async function getRanklist (c: AppContext) {
  const state = await loadContestState(c)
  if (!state || !state.accessible) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }
  const { contest, isJury } = state

  const ranklist = await contestService.getRanklist(contest._id, isJury)
  const result = ContestRanklistQueryResultSchema.encode(ranklist)
  return createEnvelopedResponse(c, result)
}

export async function findSolutions (c: AppContext) {
  const query = ContestSolutionListQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }
  const state = await loadContestState(c)
  if (!state || !state.isJury) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }
  const { contest } = state
  const solutions = await solutionService.findSolutions({
    ...query.data,
    contest: contest.contestId,
  })
  const result = ContestSolutionListQueryResultSchema.encode(solutions)
  return createEnvelopedResponse(c, result)
}

export async function exportSolutions (c: AppContext) {
  const query = ContestSolutionListExportQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }
  const state = await loadContestState(c)
  if (!state || !state.isJury) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }
  const { contest } = state
  const solutions = await solutionService.exportSolutions({
    ...query.data,
    contest: contest.contestId,
  })
  const result = ContestSolutionListExportQueryResultSchema.encode(solutions)
  return createEnvelopedResponse(c, result)
}

export async function findContestDiscussions (c: AppContext) {
  const query = DiscussionListQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }
  const state = await loadContestState(c)
  if (!state || !state.accessible) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Contest not found or access denied')
  }
  const { contest } = state

  const profile = await loadProfile(c)
  const { page, pageSize, sort, sortBy, type, author } = query.data

  const queryFilter: DiscussionQueryFilters = {}
  if (type) {
    queryFilter.type = type
  }
  if (author) {
    const authorUser = await getUser(author)
    if (authorUser) {
      queryFilter.author = authorUser._id
    }
  }

  const filters: DiscussionQueryFilters[] = [
    { contest: contest._id }, queryFilter,
  ]
  if (!profile.isAdmin) {
    filters.push({
      $or: [
        { type: { $in: publicDiscussionTypes } },
        { author: profile._id },
      ],
    })
  }

  const discussions = await discussionService.findDiscussions(
    { page, pageSize, sort, sortBy },
    { $and: filters },
    [ 'discussionId', 'author', 'problem', 'type', 'pinned', 'title', 'createdAt', 'lastCommentAt', 'comments' ],
    { author: [ 'uid', 'avatar' ], problem: [ 'pid' ] },
  )
  const result = DiscussionListQueryResultSchema.encode({
    ...discussions,
    docs: discussions.docs.map(discussion => ({
      ...discussion, contest: { contestId: contest.contestId },
    })),
  })
  return createEnvelopedResponse(c, result)
}

export async function createContest (c: AppContext) {
  const body = await c.req.json().catch(() => ({}))
  const payload = ContestCreatePayloadSchema.safeParse(body)
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }

  const opt = payload.data
  const profile = await loadProfile(c)
  const hasPermission = async (): Promise<boolean> => {
    if (profile.isAdmin) {
      return true
    }
    if (opt.course) {
      const { role } = await loadCourseStateOrThrow(c, opt.course)
      return role.manageContest
    }
    return false
  }
  if (!await hasPermission()) {
    return createErrorResponse(c, ErrorCode.Forbidden, 'Permission denied to create contest')
  }

  let course: Types.ObjectId | null = null
  if (opt.course) {
    const { course: { _id } } = await loadCourseStateOrThrow(c, opt.course)
    course = _id
  }

  try {
    const contest = await contestService.createContest({ ...opt, course })
    c.get('auditLog').info(`<Contest:${contest.contestId}> created by <User:${profile.uid}>`)
    return createEnvelopedResponse(c, { contestId: contest.contestId })
  } catch (e: any) {
    return createErrorResponse(c, ErrorCode.BadRequest, `Failed to create contest: ${e.message}`)
  }
}

function registerContestHandlers (app: Hono<HonoEnv>) {
  const contestApp = new Hono<HonoEnv>()

  contestApp.get('/', findContests)
  contestApp.get('/:contestId', loginRequire, getContest)
  contestApp.get('/:contestId/participation', loginRequire, getParticipation)
  contestApp.post('/:contestId/participation', loginRequire, participateContest)
  contestApp.get('/:contestId/participants', loginRequire, findParticipants)
  contestApp.put('/:contestId/participants/:username', loginRequire, updateParticipantStatus)
  contestApp.get('/:contestId/ranklist', loginRequire, getRanklist)
  contestApp.post('/', loginRequire, createContest)
  contestApp.get('/:contestId/configs', loginRequire, getConfig)
  contestApp.put('/:contestId/configs', loginRequire, updateConfig)

  contestApp.get('/:contestId/solutions', loginRequire, findSolutions)
  contestApp.get('/:contestId/solutions/export', loginRequire, dataExportLimit, exportSolutions)

  contestApp.get('/:contestId/discussions', loginRequire, findContestDiscussions)

  app.route('/contests', contestApp)
}

export default registerContestHandlers
