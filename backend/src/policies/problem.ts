import type { AppContext } from '../types/koa'
import type { Types } from 'mongoose'
import type { ProblemDocumentPopulated } from '../models/Problem'
import { HTTPException } from 'hono/http-exception'
import { loadContestState } from '../policies/contest'
import courseService from '../services/course'
import problemService from '../services/problem'
import constants, { ERR_NOT_FOUND } from '../utils/constants'

const { status } = constants

export interface ProblemState {
  problem: ProblemDocumentPopulated
}

function buildProblemState (c: AppContext, problem: ProblemDocumentPopulated) {
  const state: ProblemState = { problem }

  c.set('problem', state)
  return state
}

export async function loadProblemState (c: AppContext, inputId?: string | number, fromContestId?: number): Promise<ProblemState | null> {
  const problemId = Number(inputId ?? c.req.param('pid') ?? c.req.query('pid'))
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return null
  }
  if (c.get('problem')?.problem.pid === problemId) {
    return c.get('problem')!
  }

  const problem = await problemService.getProblem(problemId)
  if (!problem) {
    return null
  }

  if (problem.status === status.Available) {
    return buildProblemState(c, problem)
  }

  const profile = c.get('profile')
  if (profile && profile.isAdmin) {
    return buildProblemState(c, problem)
  }

  const contestId = Number(fromContestId ?? c.req.query('cid'))
  if (Number.isInteger(contestId) && contestId > 0) {
    const contestState = await loadContestState(c, contestId)
    if (contestState && contestState.accessible) {
      const { contest } = contestState
      if (contest.problems.some((p: Types.ObjectId) => p.equals(problem._id))) {
        return buildProblemState(c, problem)
      }
    }
  }

  if (profile && problem.owner && problem.owner.equals(profile._id)) {
    return buildProblemState(c, problem)
  }

  if (profile && await courseService.hasProblemRole(profile._id, problem._id, 'basic')) {
    return buildProblemState(c, problem)
  }

  return null
}

/**
 * @deprecated Controller should handle error throwing
 */
export async function loadProblemOrThrow (c: AppContext, inputId?: string | number, fromContestId?: number) {
  const problemState = await loadProblemState(c, inputId, fromContestId)
  if (!problemState) {
    throw new HTTPException(ERR_NOT_FOUND[0] as number, { message: ERR_NOT_FOUND[1] })
  }
  return problemState.problem
}
