import type { AppContext, HonoEnv } from '../types/koa'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ProblemTestcaseListQueryResultSchema } from '@putongoj/shared'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'
import fse from 'fs-extra'
import { v4 as uuid, validate } from 'uuid'
import { loadProfile, loginRequire } from '../middlewares/authn'
import { dataExportLimit } from '../middlewares/ratelimit'
import { loadProblemOrThrow } from '../policies/problem'
import courseService from '../services/course'
import { createEnvelopedResponse, toObjectRecord } from '../utils'
import { ERR_INVALID_ID, ERR_PERM_DENIED } from '../utils/constants'

export async function findTestcases (c: AppContext) {
  const problem = await loadProblemOrThrow(c)
  const profile = await loadProfile(c)
  if (!(profile.isAdmin || (problem.owner && problem.owner.equals(profile._id)))) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const { pid } = problem
  let meta = { testcases: [] }
  const dir = path.resolve(__dirname, `../../data/${pid}`)
  const file = path.resolve(dir, 'meta.json')
  if (!fse.existsSync(file)) {
    fse.ensureDirSync(dir)
    fse.outputJsonSync(file, meta, { spaces: 2 })
  } else {
    meta = await fse.readJson(file)
  }

  const result = ProblemTestcaseListQueryResultSchema.parse(meta.testcases)
  return createEnvelopedResponse(c, result)
}

export async function exportTestcases (c: AppContext) {
  const problem = await loadProblemOrThrow(c)
  const profile = await loadProfile(c)
  if (!(
    profile.isAdmin
    || (problem.owner && problem.owner.equals(profile._id))
    || await courseService.hasProblemRole(
      profile._id, problem._id, 'viewTestcase',
    )
  )) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const { pid } = problem
  const testDir = path.resolve(__dirname, `../../data/${pid}`)

  if (!fse.existsSync(testDir)) {
    throw new HTTPException(404, { message: 'No testcases found for this problem' })
  }

  const metaFile = path.resolve(testDir, 'meta.json')
  if (!fse.existsSync(metaFile)) {
    throw new HTTPException(404, { message: 'No testcases found for this problem' })
  }

  const meta = await fse.readJson(metaFile)
  const testcases = meta.testcases || []

  if (testcases.length === 0) {
    throw new HTTPException(404, { message: 'No testcases found for this problem' })
  }

  try {
    const zipWriter = new ZipWriter(new BlobWriter('application/zip'))

    for (const testcase of testcases) {
      const { uuid } = testcase

      const inFile = path.resolve(testDir, `${uuid}.in`)
      if (fse.existsSync(inFile)) {
        const inContent = await fse.readFile(inFile, 'utf8')
        await zipWriter.add(`${uuid}.in`, new TextReader(inContent))
      }

      const outFile = path.resolve(testDir, `${uuid}.out`)
      if (fse.existsSync(outFile)) {
        const outContent = await fse.readFile(outFile, 'utf8')
        await zipWriter.add(`${uuid}.out`, new TextReader(outContent))
      }
    }

    const zipBlob = await zipWriter.close()
    const filename = `PutongOJ-testcases-problem-${pid}-${Date.now()}.zip`

    c.get('auditLog').info(`Testcases for <Problem:${pid}> exported by user <User:${profile.uid}>`)
    return new Response(await zipBlob.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    c.get('auditLog').error(`Failed to export testcases for <Problem:${pid}>:`, error)
    throw new HTTPException(500, { message: 'Failed to export testcases' })
  }
}

export async function createTestcase (c: AppContext) {
  const problem = await loadProblemOrThrow(c)
  const profile = await loadProfile(c)
  if (!(profile.isAdmin || (problem.owner && problem.owner.equals(profile._id)))) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const { pid } = problem
  const { uid } = profile

  const body = toObjectRecord(await c.req.json().catch(() => ({})))
  const testin = String(body.in || '')
  const testout = String(body.out || '')

  if (!testin && !testout) {
    throw new HTTPException(400, { message: 'Cannot create testcase without both input and output' })
  }

  /**
   * 拿到输入输出的测试文件，然后将它移动到专门放测试数据的地方
   * 记得中间要修改对应的 meta.json
   */

  const testDir = path.resolve(__dirname, `../../data/${pid}`)
  const id = uuid() // 快速生成RFC4122 UUID

  // 将文件读取到meta对象
  const meta = await fse.readJson(path.resolve(testDir, 'meta.json'))
  meta.testcases.push({
    uuid: id,
  })

  await Promise.all([
    // 将test.in等文件写入本地文件，如果父级目录不存在(即testDir)，创建它
    fse.outputFile(path.resolve(testDir, `${id}.in`), testin),
    fse.outputFile(path.resolve(testDir, `${id}.out`), testout),
    fse.outputJson(path.resolve(testDir, 'meta.json'), meta, { spaces: 2 }),
  ])
  c.get('auditLog').info(`<Testcase:${id}> for <Problem:${pid}> created by <User:${uid}>`)

  const result = ProblemTestcaseListQueryResultSchema.parse(meta.testcases)
  return createEnvelopedResponse(c, result)
}

export async function removeTestcase (c: AppContext) {
  const problem = await loadProblemOrThrow(c)
  const profile = await loadProfile(c)
  if (!(profile.isAdmin || (problem.owner && problem.owner.equals(profile._id)))) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const { pid } = problem
  const { uid } = profile
  const uuidParam = String(c.req.param('uuid') || '').trim()
  if (!validate(uuidParam) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuidParam)) {
    throw new HTTPException(ERR_INVALID_ID[0] as number as any, { message: ERR_INVALID_ID[1] as string })
  }

  /**
   * 只移除 meta.json 中的对应元素，但并不删除测试数据的文件！
   * 保留测试数据的文件，原因是为了能够继续查看测试样例, 比如：
   * 一个提交的测试数据用的是 id 为 1 的测试数据，即时管理员不再用这个数据了，我们仍然能够看到当时这个提交用的测试数据
   */

  const testDir = path.resolve(__dirname, `../../data/${pid}`)
  const meta = await fse.readJson(path.resolve(testDir, 'meta.json'))

  meta.testcases = meta.testcases.filter((item: any) => item.uuid !== uuidParam)
  await fse.outputJson(path.resolve(testDir, 'meta.json'), meta, { spaces: 2 })
  c.get('auditLog').info(`<Testcase:${uuidParam}> for <Problem:${pid}> removed by <User:${uid}>`)

  const result = ProblemTestcaseListQueryResultSchema.parse(meta.testcases)
  return createEnvelopedResponse(c, result)
}

export async function getTestcase (c: AppContext) {
  const problem = await loadProblemOrThrow(c)
  const profile = await loadProfile(c)
  if (!(
    profile.isAdmin
    || (problem.owner && problem.owner.equals(profile._id))
    || await courseService.hasProblemRole(
      profile._id, problem._id, 'viewTestcase',
    )
  )) {
    throw new HTTPException(ERR_PERM_DENIED[0] as 403, { message: ERR_PERM_DENIED[1] as string })
  }

  const { pid } = problem
  const uuidParam = String(c.req.param('uuid') || '').trim()
  if (!validate(uuidParam) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuidParam)) {
    throw new HTTPException(ERR_INVALID_ID[0] as number as any, { message: ERR_INVALID_ID[1] as string })
  }
  const type = String(c.req.param('type') || '').trim()
  if (type !== 'in' && type !== 'out') {
    throw new HTTPException(400, { message: 'Invalid type' })
  }

  const testDir = path.resolve(__dirname, `../../data/${pid}`)
  const filePath = path.resolve(testDir, `${uuidParam}.${type}`)
  if (!fse.existsSync(filePath)) {
    throw new HTTPException(400, { message: 'No such a testcase' })
  }
  const content = await fse.readFile(filePath)
  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}

function registerTestcaseHandlers (app: Hono<HonoEnv>) {
  const testcaseApp = new Hono<HonoEnv>()

  testcaseApp.get('/', loginRequire, findTestcases)
  testcaseApp.post('/', loginRequire, createTestcase)
  testcaseApp.get('/export', loginRequire, dataExportLimit, exportTestcases)
  testcaseApp.get('/:uuid{[0-9a-f-]+}.:type', loginRequire, getTestcase)
  testcaseApp.delete('/:uuid', loginRequire, removeTestcase)

  app.route('/problem/:pid/testcases', testcaseApp)
}

export default registerTestcaseHandlers
