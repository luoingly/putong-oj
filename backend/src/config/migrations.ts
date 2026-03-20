import User from '../models/User'
import { settingsService } from '../services/settings'
import logger from '../utils/logger'

interface MigrationTask {
  key: string
  description: string
  run: () => Promise<void>
}

async function migrateUserStorageQuota () {
  const result = await User.updateMany(
    { storageQuota: { $exists: false } },
    { $set: { storageQuota: 0 } },
  )
  logger.info(`Migration user.storageQuota completed, modified=${result.modifiedCount}`)
}

const migrationTasks: MigrationTask[] = [
  {
    key: '20260320-user-storage-quota-default',
    description: 'Backfill missing user.storageQuota with 0',
    run: migrateUserStorageQuota,
  },
]

export async function runMigrations () {
  const applied = await settingsService.getMigrationsApplied()
  const pending = migrationTasks.filter(task => !applied.has(task.key))

  if (pending.length === 0) {
    logger.info('No pending DB migrations')
    return
  }

  logger.info(`Running ${pending.length} DB migration(s)`)
  for (const task of pending) {
    logger.info(`Running migration <${task.key}>: ${task.description}`)
    await task.run()
    applied.add(task.key)
    await settingsService.setMigrationsApplied(applied)
    logger.info(`Migration <${task.key}> completed`)
  }

  logger.info('DB migrations completed')
}
