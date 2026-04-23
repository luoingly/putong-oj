import type { AppContext, HonoEnv } from '../types/koa'
import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ErrorCode, FileListQueryResultSchema, FileListQuerySchema, FileUploadResultSchema } from '@putongoj/shared'
import { Hono } from 'hono'
import { loadProfile, loginRequire } from '../middlewares/authn'
import fileService from '../services/file'
import { createEnvelopedResponse, createErrorResponse, createZodErrorResponse } from '../utils'

export async function upload (c: AppContext) {
  const profile = await loadProfile(c)
  const formData = await c.req.parseBody()
  const image = formData.image

  if (!image || !(image instanceof File)) {
    return createErrorResponse(c, ErrorCode.BadRequest, 'No file uploaded')
  }

  const tempPath = path.join(tmpdir(), `upload-${Date.now()}-${image.name}`)
  const buffer = Buffer.from(await image.arrayBuffer())
  await writeFile(tempPath, buffer)

  const uploaded = await fileService.uploadFile(profile, {
    filepath: tempPath,
    originalFilename: image.name,
    size: image.size,
  })
  if (!uploaded.success) {
    return createErrorResponse(
      c,
      ErrorCode.Forbidden,
      `Storage quota exceeded. used=${uploaded.quota.usedBytes}, quota=${uploaded.quota.storageQuota}, incoming=${uploaded.sizeBytes}`,
    )
  }

  const result = FileUploadResultSchema.encode({
    storageKey: uploaded.record.storageKey,
    url: uploaded.url,
    sizeBytes: uploaded.sizeBytes,
  })
  c.get('auditLog').info(`<File:${uploaded.record.storageKey}> uploaded by <User:${profile.uid}>`)
  return createEnvelopedResponse(c, result)
}

export async function findFiles (c: AppContext) {
  const query = FileListQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return createZodErrorResponse(c, query.error)
  }

  const profile = await loadProfile(c)
  const result = await fileService.findFiles(profile, query.data)
  const encoded = FileListQueryResultSchema.encode(result)
  return createEnvelopedResponse(c, encoded)
}

export async function removeFile (c: AppContext) {
  const profile = await loadProfile(c)
  const storageKey = String(c.req.param('storageKey') || '').trim()
  if (!storageKey) {
    return createErrorResponse(c, ErrorCode.BadRequest, 'Invalid storage key')
  }

  const file = await fileService.removeFile(profile, storageKey)
  if (file === false) {
    return createErrorResponse(c, ErrorCode.Forbidden, 'Insufficient privilege to delete this file')
  }
  if (!file) {
    return createErrorResponse(c, ErrorCode.NotFound, 'File not found')
  }

  c.get('auditLog').info(`<File:${file.storageKey}> deleted by <User:${profile.uid}>`)
  return createEnvelopedResponse(c, null)
}

function registerFileHandlers (app: Hono<HonoEnv>) {
  app.post('/upload', loginRequire, upload)

  const fileApp = new Hono<HonoEnv>()

  fileApp.get('/', loginRequire, findFiles)
  fileApp.delete('/:storageKey', loginRequire, removeFile)

  app.route('/files', fileApp)
}

export default registerFileHandlers
