import PQueue from 'p-queue'
import { ObjectId } from 'mongodb'
import { getDatabase } from '../config/database.js'
import { websocketService } from './websocketService.js'
import { taskScheduler } from './taskScheduler.js'

// 创建任务队列，控制并发数
const queue = new PQueue({
  concurrency: 3, // 最多同时执行3个任务
  interval: 1000, // 每秒最多执行的任务数
  intervalCap: 5, // 每个间隔最多执行5个任务
})

// 任务结果等待 Map: taskId -> { resolve, reject, timeout }
const taskResultWaiters = new Map()

// 设置任务结果回调
websocketService.setTaskResultCallback(async (data) => {
  const { taskId, result } = data
  const waiter = taskResultWaiters.get(taskId)
  
  if (waiter) {
    clearTimeout(waiter.timeout)
    taskResultWaiters.delete(taskId)
    
    // 更新执行记录
    const db = getDatabase()
    const executionsCollection = db.collection('task_executions')
    const tasksCollection = db.collection('scheduled_tasks')
    
    try {
      // 获取执行记录
      const execution = await executionsCollection.findOne({ _id: waiter.executionId })
      if (execution) {
        const startedAt = execution.startedAt.getTime ? execution.startedAt.getTime() : new Date(execution.startedAt).getTime()
        
        // 更新执行记录
        await executionsCollection.updateOne(
          { _id: waiter.executionId },
          {
            $set: {
              status: result.code === 200 ? 'completed' : 'failed',
              completedAt: new Date(),
              duration: Date.now() - startedAt,
              result,
              error: result.code !== 200 ? (result.message || '任务执行失败') : null,
              shopName: result.data?.shopName || null,
              platform: result.data?.platform || null,
            },
          },
        )
      }
      
      // 更新任务统计和 nextRunAt
      const task = await tasksCollection.findOne({ _id: new ObjectId(taskId) })
      if (task) {
        const newStatus = result.code === 200 ? 'completed' : 'failed'
        
        // 计算下次执行时间（基于当前时间）
        const nextRunAt = taskScheduler.calculateNextRunTime(task.cronExpression, new Date())
        
        await tasksCollection.updateOne(
          { _id: task._id },
          {
            $set: {
              status: newStatus,
              updatedAt: new Date(),
              nextRunAt, // 更新下次执行时间
            },
            $inc: result.code === 200 ? { successCount: 1 } : { failureCount: 1 },
          },
        )

        // 广播任务状态更新到所有客户端
        websocketService.broadcastTaskStatusUpdate({
          taskId: taskId,
          status: newStatus,
          lastRunAt: task.lastRunAt,
          nextRunAt, // 包含 nextRunAt
          successCount: result.code === 200 ? (task.successCount || 0) + 1 : (task.successCount || 0),
          failureCount: result.code !== 200 ? (task.failureCount || 0) + 1 : (task.failureCount || 0),
        })
      }
    }
    catch (error) {
      console.error('[任务执行器] 更新任务结果失败:', error)
    }
    
    if (result.code === 200) {
      waiter.resolve(result)
    } else {
      waiter.reject(new Error(result.message || '任务执行失败'))
    }
  }
})

/**
 * 检查是否有相同店铺、同类型任务正在执行
 * @param {ObjectId} shopId - 店铺ID
 * @param {string} taskType - 任务类型: 'auto_flow' | 'login'
 * @param {ObjectId} excludeTaskId - 排除的任务ID（当前任务）
 * @returns {Promise<boolean>} 如果有正在执行的任务，返回 true
 */
async function checkRunningTask(shopId, taskType, excludeTaskId = null) {
  try {
    const db = getDatabase()
    const tasksCollection = db.collection('scheduled_tasks')

    // 构建查询条件：相同店铺、相同任务类型、状态为 running
    const query = {
      shopId: shopId,
      taskType: taskType,
      status: 'running',
    }

    // 如果提供了排除的任务ID，则排除它
    if (excludeTaskId) {
      query._id = { $ne: excludeTaskId }
    }

    // 查询是否有正在执行的任务
    const runningTask = await tasksCollection.findOne(query)

    if (runningTask) {
      console.log(`[任务执行器] 检测到相同店铺(${shopId})、同类型任务(${taskType})正在执行，任务ID: ${runningTask._id}`)
      return true
    }

    return false
  }
  catch (error) {
    console.error('[任务执行器] 检查正在执行的任务失败:', error)
    // 如果检查失败，为了安全起见，返回 true（阻止执行）
    return true
  }
}

/**
 * 执行任务
 * @param {object} task - 任务对象
 */
export async function executeTask(task) {
  // 检查是否有相同店铺、同类型任务正在执行
  const hasRunningTask = await checkRunningTask(task.shopId, task.taskType, task._id)
  if (hasRunningTask) {
    const errorMessage = `该店铺已有相同类型的任务正在执行中，请等待任务完成后再试`
    console.log(`[任务执行器] 任务执行被阻止: ${errorMessage} (任务ID: ${task._id})`)
    throw new Error(errorMessage)
  }

  const executionId = new ObjectId()
  const db = getDatabase()
  const executionsCollection = db.collection('task_executions')
  const tasksCollection = db.collection('scheduled_tasks')

  // 创建执行记录
  const execution = {
    _id: executionId,
    taskId: task._id,
    shopId: task.shopId,
    status: 'running',
    startedAt: new Date(),
    logs: [],
  }

  await executionsCollection.insertOne(execution)

  // 更新任务状态
  const lastRunAt = new Date()
  await tasksCollection.updateOne(
    { _id: task._id },
    {
      $set: {
        status: 'running',
        lastRunAt,
        updatedAt: new Date(),
      },
      $inc: { runCount: 1 },
    },
  )

  // 广播任务状态更新到所有客户端（任务开始执行）
  websocketService.broadcastTaskStatusUpdate({
    taskId: task._id.toString(),
    status: 'running',
    lastRunAt,
    executionId: executionId.toString(),
  })

  // 将任务加入队列执行
  return queue.add(async () => {
    try {
      // 在队列执行前再次检查是否有相同店铺、同类型任务正在执行
      // 因为任务可能在队列中等待了一段时间，期间可能有其他任务开始执行
      const hasRunningTask = await checkRunningTask(task.shopId, task.taskType, task._id)
      if (hasRunningTask) {
        const errorMessage = `该店铺已有相同类型的任务正在执行中，请等待任务完成后再试`
        console.log(`[任务执行器] 任务执行被阻止（队列执行前检查）: ${errorMessage} (任务ID: ${task._id})`)
        
        // 更新执行记录为失败
        const startedAt = execution.startedAt.getTime ? execution.startedAt.getTime() : new Date(execution.startedAt).getTime()
        await executionsCollection.updateOne(
          { _id: executionId },
          {
            $set: {
              status: 'failed',
              completedAt: new Date(),
              duration: Date.now() - startedAt,
              error: errorMessage,
            },
          },
        )

        // 更新任务状态为失败
        const nextRunAt = taskScheduler.calculateNextRunTime(task.cronExpression, new Date())
        await tasksCollection.updateOne(
          { _id: task._id },
          {
            $set: {
              status: 'failed',
              updatedAt: new Date(),
              nextRunAt,
            },
            $inc: { failureCount: 1 },
          },
        )

        // 广播任务状态更新到所有客户端
        websocketService.broadcastTaskStatusUpdate({
          taskId: task._id.toString(),
          status: 'failed',
          lastRunAt: task.lastRunAt,
          nextRunAt,
          failureCount: (task.failureCount || 0) + 1,
        })

        throw new Error(errorMessage)
      }

      // 获取店铺信息
      const shopsCollection = db.collection('shops')
      const shop = await shopsCollection.findOne({ _id: task.shopId })

      if (!shop) {
        throw new Error('店铺不存在')
      }

      // 构建店铺数据（直接使用数据库中的字段，不做二次封装）
      const shopData = {
        id: shop._id.toString(),
        shopId: shop.shopId || shop._id.toString(),
        name: shop.shopName,
        platform: shop.platform,
        homeUrl: shop.homeUrl || null,
        loginUrl: shop.loginUrl || null,
        cookies: shop.cookies || [],
        browserConfig: shop.browserConfig || {},
        autoConfig: task.config?.autoConfig || shop.autoConfig || null,
      }

      // 添加日志
      await addExecutionLog(executionId, 'info', '任务开始执行', { shopData: { id: shopData.id, name: shopData.name } })

      // 通过 WebSocket 推送任务到前端执行，并等待结果
      // 注意：执行记录的更新会在 WebSocket 回调中完成
      const result = await executeTaskInClient(task._id.toString(), shopData, task.taskType, executionId)

      // 添加日志
      await addExecutionLog(executionId, 'info', '任务已推送到客户端，等待执行结果', { result })

      return result
    }
    catch (error) {
      console.error(`[任务执行器] 任务执行失败 (${task._id}):`, error)

      // 如果任务推送失败，需要更新执行记录
      // 如果任务已推送但执行失败，执行记录的更新会在 WebSocket 回调中完成
      // 这里只处理推送失败的情况
      const startedAt = execution.startedAt.getTime ? execution.startedAt.getTime() : new Date(execution.startedAt).getTime()
      
      // 检查是否已推送任务（通过检查 waiter 是否存在）
      const waiter = taskResultWaiters.get(task._id.toString())
      if (!waiter) {
        // 任务未推送，直接更新执行记录和任务统计
        await executionsCollection.updateOne(
          { _id: executionId },
          {
            $set: {
              status: 'failed',
              completedAt: new Date(),
              duration: Date.now() - startedAt,
              error: error.message || '未知错误',
            },
          },
        )

        // 计算下次执行时间
        const nextRunAt = taskScheduler.calculateNextRunTime(task.cronExpression, new Date())

        await tasksCollection.updateOne(
          { _id: task._id },
          {
            $set: {
              status: 'failed',
              updatedAt: new Date(),
              nextRunAt, // 更新下次执行时间
            },
            $inc: { failureCount: 1 },
          },
        )

        // 广播任务状态更新到所有客户端
        websocketService.broadcastTaskStatusUpdate({
          taskId: task._id.toString(),
          status: 'failed',
          lastRunAt: task.lastRunAt,
          nextRunAt, // 包含 nextRunAt
          failureCount: (task.failureCount || 0) + 1,
        })
      } else {
        // 任务已推送，清理 waiter（执行记录的更新会在 WebSocket 回调中完成）
        clearTimeout(waiter.timeout)
        taskResultWaiters.delete(task._id.toString())
      }

      // 添加错误日志
      await addExecutionLog(executionId, 'error', '任务执行失败', { error: error.message })

      throw error
    }
  })
}

/**
 * 在客户端执行任务（通过 WebSocket 推送任务到前端）
 * @param {string} taskId - 任务ID
 * @param {object} shopData - 店铺数据
 * @param {string} taskType - 任务类型: 'auto_flow' | 'login'
 * @param {ObjectId} executionId - 执行记录ID
 */
async function executeTaskInClient(taskId, shopData, taskType, executionId) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`[任务执行器] 通过 WebSocket 推送任务:`, {
        taskId,
        shopData: { id: shopData.id, name: shopData.name },
        taskType,
      })

      // 检查是否有客户端连接
      const clientCount = websocketService.getClientCount()
      if (clientCount === 0) {
        reject(new Error('没有可用的客户端连接，请确保自动化任务窗口已启动'))
        return
      }

      // 创建任务结果等待器（超时时间：30分钟）
      const timeout = setTimeout(async () => {
        const waiter = taskResultWaiters.get(taskId)
        if (waiter) {
          taskResultWaiters.delete(taskId)
          // 更新执行记录为超时
          await updateTaskTimeout(taskId, waiter.executionId)
          reject(new Error('任务执行超时（30分钟）'))
        }
      }, 30 * 60 * 1000)

      taskResultWaiters.set(taskId, {
        resolve,
        reject,
        timeout,
        executionId,
      })

      // 通过 WebSocket 推送任务
      const sentCount = websocketService.sendTaskExecute(taskId, shopData, taskType)

      if (sentCount === 0) {
        clearTimeout(timeout)
        taskResultWaiters.delete(taskId)
        reject(new Error('任务推送失败，没有可用的客户端连接'))
        return
      }

      console.log(`[任务执行器] 任务已推送到 ${sentCount} 个客户端，等待执行结果...`)
    }
    catch (error) {
      console.error(`[任务执行器] 推送任务失败:`, error.message)
      reject(new Error(`推送任务失败: ${error.message}`))
    }
  })
}

/**
 * 更新任务超时状态
 */
async function updateTaskTimeout(taskId, executionId) {
  try {
    const db = getDatabase()
    const executionsCollection = db.collection('task_executions')
    const tasksCollection = db.collection('scheduled_tasks')

    // 获取执行记录
    const execution = await executionsCollection.findOne({ _id: executionId })
    if (execution) {
      const startedAt = execution.startedAt.getTime ? execution.startedAt.getTime() : new Date(execution.startedAt).getTime()
      
      // 更新执行记录
      await executionsCollection.updateOne(
        { _id: executionId },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            duration: Date.now() - startedAt,
            error: '任务执行超时（30分钟）',
          },
        },
      )
    }

    // 更新任务统计
    const task = await tasksCollection.findOne({ _id: new ObjectId(taskId) })
    if (task) {
      // 计算下次执行时间
      const nextRunAt = taskScheduler.calculateNextRunTime(task.cronExpression, new Date())
      
      await tasksCollection.updateOne(
        { _id: task._id },
        {
          $set: {
            status: 'failed',
            updatedAt: new Date(),
            nextRunAt, // 更新下次执行时间
          },
          $inc: { failureCount: 1 },
        },
      )

      // 广播任务状态更新到所有客户端
      websocketService.broadcastTaskStatusUpdate({
        taskId: taskId,
        status: 'failed',
        lastRunAt: task.lastRunAt,
        nextRunAt, // 包含 nextRunAt
        failureCount: (task.failureCount || 0) + 1,
      })
    }
  }
  catch (error) {
    console.error('[任务执行器] 更新任务超时状态失败:', error)
  }
}

/**
 * 添加执行日志
 */
async function addExecutionLog(executionId, level, message, details = {}) {
  try {
    const db = getDatabase()
    const executionsCollection = db.collection('task_executions')

    await executionsCollection.updateOne(
      { _id: executionId },
      {
        $push: {
          logs: {
            timestamp: new Date(),
            level,
            message,
            details,
          },
        },
      },
    )
  }
  catch (error) {
    console.error('[任务执行器] 添加日志失败:', error)
  }
}

