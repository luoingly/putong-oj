import type { Types } from 'mongoose'
import type { CourseDocument } from '../models/Course'
import type { ProblemState } from '../policies/problem'
import type { AppContext, HonoEnv } from '../types/koa'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import {
  ErrorCode,
  JudgeStatus,
  SolutionSubmitPayloadSchema,
  SolutionSubmitResultSchema,
} from '@putongoj/shared'
import fse from 'fs-extra'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { pick } from 'lodash'
import redis from '../config/redis'
import { loadProfile, loginRequire, rootRequire } from '../middlewares/authn'
import { solutionCreateLimit } from '../middlewares/ratelimit'
import Contest from '../models/Contest'
import Problem from '../models/Problem'
import Solution from '../models/Solution'
import { loadContestState } from '../policies/contest'
import { loadCourseStateOrThrow } from '../policies/course'
import { loadProblemState } from '../policies/problem'
import { createEnvelopedResponse, createErrorResponse, createZodErrorResponse, toObjectRecord } from '../utils'

export async function findOne (c: AppContext) {
  const opt = Number.parseInt(c.req.param('sid') ?? '', 10)
  if (!Number.isInteger(opt) || opt <= 0) {
    throw new HTTPException(400, { message: 'Invalid submission id' })
  }

  const solution = await Solution.findOne({ sid: opt }).lean()
  if (!solution) {
    throw new HTTPException(400, { message: 'No such a solution' })
  }

  const profile = await loadProfile(c)
  const hasPermission = await (async () => {
    if (solution.uid === profile.uid) {
      return true
    }
    if (profile.isAdmin) {
      return true
    }
    if (solution.mid > 0) {
      const contest = await Contest
        .findOne({ contestId: solution.mid }, 'course')
        .populate<{ course: CourseDocument }>('course')
      if (contest && contest.course) {
        const { role } = await loadCourseStateOrThrow(c, contest.course.courseId)
        if (role.viewSolution) {
          return true
        }
      }
    }
    return false
  })()
  if (!hasPermission) {
    throw new HTTPException(403, { message: 'Permission denied' })
  }

  // 如果是 admin 请求，并且有 sim 值(有抄袭嫌隙)，那么也样将可能被抄袭的提交也返回
  let simSolution
  if (profile.isAdmin && solution.sim) {
    simSolution = await Solution.findOne({ sid: solution.sim_s_id }).lean().exec()
  }

  return c.json({
    solution: {
      ...pick(solution, [ 'sid', 'pid', 'uid', 'mid', 'course', 'code', 'language',
        'create', 'status', 'judge', 'time', 'memory', 'error', 'sim', 'sim_s_id', 'testcases' ]),
      simSolution: simSolution
        ? pick(simSolution, [ 'sid', 'uid', 'code', 'create' ])
        : undefined,
    },
  })
}

/**
 * 创建一个提交
 */
const create = async (c: AppContext) => {
  const profile = await loadProfile(c)
  const payload = SolutionSubmitPayloadSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!payload.success) {
    return createZodErrorResponse(c, payload.error)
  }

  const uid = profile.uid
  const pid = payload.data.problem
  const code = payload.data.code
  const language = payload.data.language
  const mid = payload.data.contest ?? -1

  let problemState: ProblemState | null = null
  if (mid > 0) {
    const contestState = await loadContestState(c, mid)
    if (!contestState) {
      throw new HTTPException(400, { message: 'No such a contest' })
    }
    const { contest, accessible, isIpBlocked, isJury } = contestState

    if (isIpBlocked) {
      throw new HTTPException(403, { message: 'Your IP address is not in the whitelist for this contest' })
    }
    if (!accessible) {
      throw new HTTPException(403, { message: 'Permission denied' })
    }

    const now = new Date()
    if (!isJury && contest.startsAt > now) {
      throw new HTTPException(400, { message: 'Contest is not started yet!' })
    }
    if (!isJury && contest.endsAt < now) {
      throw new HTTPException(400, { message: 'Contest is ended!' })
    }

    problemState = await loadProblemState(c, pid, contest.contestId)
    if (!problemState) {
      throw new HTTPException(404, { message: 'Problem not found or access denied' })
    }
    const contestProblem = problemState.problem
    if (!contest.problems.some((problemId: Types.ObjectId) => problemId.equals(contestProblem._id))) {
      throw new HTTPException(400, { message: 'No such a problem in the contest' })
    }
    if (contest.allowedLanguages && !contest.allowedLanguages.includes(language)) {
      throw new HTTPException(400, { message: 'This language is not allowed in the contest' })
    }
  } else {
    problemState = await loadProblemState(c, pid)
    if (!problemState) {
      throw new HTTPException(404, { message: 'Problem not found or access denied' })
    }
  }

  const { problem } = problemState

  try {
    const timeLimit = problem.time
    const memoryLimit = problem.memory
    const type = problem.type
    const additionCode = problem.code

    let meta = { testcases: [] }
    const dir = path.resolve(__dirname, `../../data/${pid}`)
    const file = path.resolve(dir, 'meta.json')
    if (fse.existsSync(file)) {
      meta = await fse.readJson(file)
    }
    const testcases = meta.testcases.map((item: { uuid: string }) => {
      return {
        uuid: item.uuid,
        input: { src: `/app/data/${pid}/${item.uuid}.in` },
        output: { src: `/app/data/${pid}/${item.uuid}.out` },
      }
    })

    const solution = new Solution({
      pid, mid, uid, code, language,
      length: Buffer.from(code).length, // 这个属性是不是没啥用？
    })

    await solution.save()

    const sid = solution.sid
    const submission = {
      sid, timeLimit, memoryLimit,
      testcases, language, code,
      type, additionCode,
    }

    await redis.rpush('judger:task', JSON.stringify(submission))
    c.get('auditLog').info(`<Submission:${sid}> of <Problem:${pid}>${mid > 0 ? ` in <Contest:${mid}>` : ''} created by <User:${uid}>`)

    const result = SolutionSubmitResultSchema.encode({ solution: sid })
    return createEnvelopedResponse(c, result)
  } catch (e: any) {
    throw new HTTPException(400, { message: e.message })
  }
}

async function updateSolution (c: AppContext) {
  const profile = await loadProfile(c)
  const opt = toObjectRecord(await c.req.json().catch(() => ({})))

  const sid = Number(c.req.param('sid'))
  if (!Number.isInteger(sid) || sid <= 0) {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Invalid submission id')
  }
  const updatedJudge = Number(opt.judge)
  if (updatedJudge !== JudgeStatus.RejudgePending && updatedJudge !== JudgeStatus.Skipped) {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Invalid judge status, only support RejudgePending and Skipped')
  }

  const solution = await Solution.findOne({ sid })
  if (!solution) {
    return createErrorResponse(c, ErrorCode.NotFound)
  }
  const pid = solution.pid
  const problem = await Problem.findOne({ pid })
  if (!problem) {
    return createErrorResponse(c, ErrorCode.NotFound, 'Problem of the solution not found')
  }

  try {
    solution.judge = updatedJudge
    solution.time = 0
    solution.memory = 0
    solution.error = ''
    solution.sim = 0
    solution.sim_s_id = 0
    solution.testcases = []

    await solution.save()
  } catch (err) {
    c.get('auditLog').error('Failed to update solution', err)
    return createErrorResponse(c, ErrorCode.InternalServerError)
  }

  if (updatedJudge !== JudgeStatus.RejudgePending) {
    return createEnvelopedResponse(c, solution)
  }

  try {
    const timeLimit = problem.time
    const memoryLimit = problem.memory
    const type = problem.type
    const additionCode = problem.code

    let meta = { testcases: [] }
    const dir = path.resolve(__dirname, `../../data/${pid}`)
    const file = path.resolve(dir, 'meta.json')
    if (fse.existsSync(file)) {
      meta = await fse.readJson(file)
    }
    const testcases = meta.testcases.map((item: { uuid: string }) => {
      return {
        uuid: item.uuid,
        input: { src: `/app/data/${pid}/${item.uuid}.in` },
        output: { src: `/app/data/${pid}/${item.uuid}.out` },
      }
    })
    const submission = {
      sid, timeLimit, memoryLimit, testcases,
      language: solution.language,
      code: solution.code,
      type, additionCode,
    }

    await redis.rpush('judger:task', JSON.stringify(submission))
    c.get('auditLog').info(`<Submission:${sid}> rejudged by <User:${profile.uid}>`)
  } catch (err) {
    c.get('auditLog').error('Failed to push solution to judger queue', err)
    return createErrorResponse(c, ErrorCode.InternalServerError)
  }

  return createEnvelopedResponse(c, solution)
}

function registerSolutionHandlers (app: Hono<HonoEnv>) {
  const solutionApp = new Hono<HonoEnv>()

  solutionApp.get('/:sid', loginRequire, findOne)
  solutionApp.put('/:sid', rootRequire, updateSolution)
  solutionApp.post('/', loginRequire, solutionCreateLimit, create)

  app.route('/status', solutionApp)
}

export default registerSolutionHandlers
