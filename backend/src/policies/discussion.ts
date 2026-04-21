import type { DiscussionDocument } from '../services/discussion'
import type { AppContext } from '../types/koa'
import { DiscussionType } from '@putongoj/shared'
import discussionService from '../services/discussion'
import { loadContest } from './contest'
import { loadCourseRoleById } from './course'

export interface DiscussionState {
  discussion: DiscussionDocument
  isJury: boolean
}

export const publicDiscussionTypes = [
  DiscussionType.OpenDiscussion,
  DiscussionType.PublicAnnouncement,
] as DiscussionType[]

export async function loadDiscussion (c: AppContext, inputId?: number | string) {
  const discussionId = Number(inputId ?? c.req.param('discussionId'))
  if (!Number.isInteger(discussionId) || discussionId <= 0) {
    return null
  }
  if (c.get('discussion')?.discussion.discussionId === discussionId) {
    return c.get('discussion')!
  }

  const discussion = await discussionService.getDiscussion(discussionId)
  if (!discussion) {
    return null
  }

  let isJury: boolean = false
  if (discussion.contest) {
    const contest = await loadContest(c, discussion.contest.contestId)
    const role = await loadCourseRoleById(c, contest?.course ?? null)
    if (role && role.manageContest) {
      isJury = true
    }
  }

  const profile = c.get('profile')
  const isAdmin = profile?.isAdmin ?? false
  const isAuthor = discussion.author._id.equals(profile?._id)
  const isProblemOwner = discussion.problem?.owner?.equals(profile?._id) ?? false
  if (isAdmin || isAuthor || isProblemOwner) {
    isJury = true
  }

  const isPublic = publicDiscussionTypes.includes(discussion.type)
  if (isPublic || isJury) {
    const state: DiscussionState = { discussion, isJury }

    c.set('discussion', state)
    return state
  }
  return null
}
