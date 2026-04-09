import type Redis from 'ioredis'
import type { Types } from 'mongoose'
import NodeCache from 'node-cache'
import redis from '../config/redis'

const MEMORY_CACHE_TTL = 3
const REDIS_CACHE_TTL = 5

const MEMORY_CHECK_PERIOD = 60
const REDIS_LOCK_TTL = 60
const REDIS_LOCK_RETRY = 50 // in milliseconds

interface CacheOptions {
  skipMemoryCache?: boolean
}

interface CacheCreationOptions extends CacheOptions {
  redisTtl?: number
}

class CacheService {
  private memoryCache: NodeCache
  private redisClient: Redis

  constructor () {
    this.memoryCache = new NodeCache({
      stdTTL: MEMORY_CACHE_TTL,
      checkperiod: MEMORY_CHECK_PERIOD,
    })
    this.redisClient = redis
  }

  public async get<T>(
    key: string,
    opt?: CacheOptions,
  ): Promise<T | null> {
    const skipMemoryCache = this.shouldSkipMemoryCache(opt)

    if (!skipMemoryCache) {
      const memoryValue = this.memoryCache.get<T>(key)
      if (memoryValue !== undefined) {
        return memoryValue
      }
    }

    const redisValue = await this.redisClient.get(key)
    const value = this.tryDecode<T>(redisValue)
    if (value !== null && !skipMemoryCache) {
      this.memoryCache.set(key, value)
    }

    return value
  }

  public async getOrCreate<T>(
    key: string,
    func: () => Promise<T>,
    opt?: CacheCreationOptions,
  ): Promise<T> {
    const skipMemoryCache = this.shouldSkipMemoryCache(opt)

    if (!skipMemoryCache) {
      const memoryValue = this.memoryCache.get<T>(key)
      if (memoryValue !== undefined) {
        return memoryValue
      }
    }

    const value = await this.getOrCreateFromRedisCache<T>(key, func, opt)
    if (!skipMemoryCache) {
      this.memoryCache.set(key, value)
    }

    return value
  }

  public async remove (key: string): Promise<void> {
    await this.redisClient.del(key)
    this.memoryCache.del(key)
  }

  private async getOrCreateFromRedisCache<T>(
    key: string,
    func: () => Promise<T>,
    opt?: CacheCreationOptions,
  ): Promise<T> {
    let value = await this.redisClient.get(key)
    let result: T | null = null

    // hit the cache
    result = this.tryDecode<T>(value)
    if (result !== null) {
      return result
    }

    // wait if updating
    value = await this.waitLock(key)
    result = this.tryDecode<T>(value)
    if (result !== null) {
      return result
    }

    await this.setLock(key)

    try {
      result = await func()
      value = JSON.stringify(result)

      const ttl = opt?.redisTtl ?? REDIS_CACHE_TTL
      await this.redisClient.set(key, value, 'EX', ttl)
    } finally {
      await this.releaseLock(key)
    }

    return result
  }

  private tryDecode<T>(value: string | null): T | null {
    if (value === null) {
      return null
    }

    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  private async waitLock (key: string): Promise<string | null> {
    const lockKey = CacheKey.updateLock(key)

    let lockValue = await this.redisClient.get(lockKey)
    if (lockValue === null) {
      return null
    }

    while (lockValue !== null) {
      await new Promise(resolve => setTimeout(resolve, REDIS_LOCK_RETRY))
      lockValue = await this.redisClient.get(lockKey)
    }

    return await this.redisClient.get(key)
  }

  private async setLock (lock: string): Promise<void> {
    const lockKey = CacheKey.updateLock(lock)
    await this.redisClient.set(lockKey, '', 'EX', REDIS_LOCK_TTL, 'NX')
  }

  private async releaseLock (lock: string): Promise<void> {
    const lockKey = CacheKey.updateLock(lock)
    await this.redisClient.del(lockKey)
  }

  private shouldSkipMemoryCache (opt?: CacheOptions): boolean {
    return opt?.skipMemoryCache ?? false
  }
}

export const cacheService = new CacheService()

export class CacheKey {
  public static updateLock (key: string) {
    return `cache:update_lock:${key}`
  }

  public static settings (key: string) {
    return `cache:settings:${key}`
  }

  public static contestProblems (contest: Types.ObjectId, isJury: boolean) {
    return `cache:contest:${contest.toString()}:problems:${isJury ? 'jury' : 'public'}`
  }

  public static contestRanklist (contest: Types.ObjectId, isJury: boolean) {
    return `cache:contest:${contest.toString()}:ranklist:${isJury ? 'jury' : 'public'}`
  }

  public static problemStatistics (problem: Types.ObjectId) {
    return `cache:problem:${problem.toString()}:statistics`
  }

  public static userSubmissionHeatmap (user: Types.ObjectId) {
    return `cache:user:${user.toString()}:submission_heatmap`
  }
}
