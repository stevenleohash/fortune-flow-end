import cron from 'node-cron'
import { CronExpressionParser } from 'cron-parser'
import { ObjectId } from 'mongodb'
import { getDatabase } from '../config/database.js'
import { executeTask } from './taskExecutor.js'

class TaskScheduler {
  constructor() {
    this.jobs = new Map() // 存储所有定时任务 { taskId: cronJob }
    this.isStarted = false
  }

  // 启动调度器
  async start() {
    if (this.isStarted) {
      console.log('[任务调度器] 已启动，跳过重复启动')
      return
    }

    console.log('[任务调度器] 启动中...')
    await this.loadTasks()
    this.isStarted = true
    console.log('[任务调度器] 已启动')
  }

  // 从数据库加载所有启用的任务
  async loadTasks() {
    try {
      const db = getDatabase()
      const tasksCollection = db.collection('scheduled_tasks')
      const tasks = await tasksCollection.find({ enabled: true }).toArray()

      // 清除所有现有任务
      this.jobs.forEach((job, taskId) => {
        job.destroy()
        this.jobs.delete(taskId)
      })

      // 加载新任务
      for (const task of tasks) {
        this.scheduleTask(task)
      }

      console.log(`[任务调度器] 已加载 ${tasks.length} 个任务`)
    }
    catch (error) {
      console.error('[任务调度器] 加载任务失败:', error)
    }
  }

  // 调度单个任务
  scheduleTask(task) {
    const taskId = task._id.toString()

    // 如果任务已存在，先销毁
    if (this.jobs.has(taskId)) {
      this.jobs.get(taskId).destroy()
      this.jobs.delete(taskId)
    }

    // 验证 cron 表达式
    if (!cron.validate(task.cronExpression)) {
      console.error(`[任务调度器] 无效的 cron 表达式: ${task.cronExpression} (任务ID: ${taskId})`)
      return
    }

    // 创建定时任务
    const job = cron.schedule(
      task.cronExpression,
      async () => {
        console.log(`[任务调度器] 执行任务: ${task.shopName || taskId} (${taskId})`)
        try {
          await executeTask(task)
        }
        catch (error) {
          console.error(`[任务调度器] 任务执行失败 (${taskId}):`, error)
        }
      },
      {
        scheduled: true,
        timezone: 'Asia/Shanghai',
      },
    )

    this.jobs.set(taskId, job)

    // 计算并更新下次执行时间
    this.updateNextRunTime(task)

    console.log(`[任务调度器] 任务已调度: ${taskId} (${task.cronExpression})`)
  }

  // 更新下次执行时间
  async updateNextRunTime(task, fromDate = null) {
    try {
      const db = getDatabase()
      const tasksCollection = db.collection('scheduled_tasks')

      // 使用 cron-parser 计算下次执行时间
      const nextRunAt = this.calculateNextRunTime(task.cronExpression, fromDate)

      await tasksCollection.updateOne(
        { _id: task._id },
        { $set: { nextRunAt, updatedAt: new Date() } },
      )
      
      return nextRunAt
    }
    catch (error) {
      console.error('[任务调度器] 更新下次执行时间失败:', error)
      return null
    }
  }

  // 计算下次执行时间
  calculateNextRunTime(cronExpression, fromDate = null) {
    try {
      // 使用 cron-parser 精确计算下次执行时间
      const interval = CronExpressionParser.parse(cronExpression, {
        tz: 'Asia/Shanghai',
        currentDate: fromDate || new Date(),
      })
      return interval.next().toDate()
    }
    catch (error) {
      console.error('[任务调度器] 计算下次执行时间失败:', error)
      // 如果计算失败，返回当前时间 + 1小时作为后备
      return new Date(Date.now() + 60 * 60 * 1000)
    }
  }

  // 移除任务
  removeTask(taskId) {
    if (this.jobs.has(taskId)) {
      this.jobs.get(taskId).destroy()
      this.jobs.delete(taskId)
      console.log(`[任务调度器] 任务已移除: ${taskId}`)
    }
  }

  // 立即执行任务
  async executeTaskNow(taskId) {
    try {
      const db = getDatabase()
      const tasksCollection = db.collection('scheduled_tasks')

      const task = await tasksCollection.findOne({ _id: new ObjectId(taskId) })
      if (!task) {
        throw new Error('任务不存在')
      }

      console.log(`[任务调度器] 立即执行任务: ${taskId}`)
      await executeTask(task)
    }
    catch (error) {
      console.error(`[任务调度器] 立即执行任务失败 (${taskId}):`, error)
      throw error
    }
  }
}

export const taskScheduler = new TaskScheduler()

