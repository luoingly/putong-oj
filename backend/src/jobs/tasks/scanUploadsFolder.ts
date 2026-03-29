import path from 'node:path'
import fse from 'fs-extra'
import Files from '../../models/Files'
import User from '../../models/User'
import logger from '../../utils/logger'

const uploadDir = path.join(__dirname, '../../../public/uploads')

async function scanUploadsFolder () {
  const stats = {
    scanned: 0,
    added: 0,
    skipped: 0,
    failed: 0,
  }

  try {
    const admin = await User.findOne({ uid: 'admin' })
    if (!admin) {
      throw new Error('admin user not found')
    }

    const exists = await fse.pathExists(uploadDir)
    if (!exists) {
      logger.info('scanUploadsFolder: upload directory does not exist, nothing to scan')
      return
    }

    const entries = await fse.readdir(uploadDir)
    for (const name of entries) {
      stats.scanned++
      const absolutePath = path.join(uploadDir, name)

      try {
        const stat = await fse.stat(absolutePath)
        if (!stat.isFile()) {
          stats.skipped++
          continue
        }

        const existing = await Files.findOne({ storageKey: name })
        if (existing) {
          stats.skipped++
          continue
        }

        await new Files({
          owner: admin._id,
          storageKey: name,
          originalName: name,
          sizeBytes: stat.size,
        }).save()

        stats.added++
      } catch (err) {
        stats.failed++
        logger.error(`Failed scanning upload ${name}`, err)
      }
    }

    logger.info(
      `scanUploadsFolder finished: scanned=${stats.scanned}, added=${stats.added}, skipped=${stats.skipped}, failed=${stats.failed}`,
    )
  } catch (err: any) {
    logger.error(`scanUploadsFolder failed: ${err?.message || 'Unexpected scan error'}`, err)
    throw err
  }
}

export default scanUploadsFolder
