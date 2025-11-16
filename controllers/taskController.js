import { ObjectId } from 'mongodb'
import cron from 'node-cron'
import { getDatabase } from '../config/database.js'
import { successResponse, errorResponse } from '../utils/response.js'
import { taskScheduler } from '../services/taskScheduler.js'

// 获取任务列表
export async function getTasks(req, res) {
  try {
    const db = getDatabase()
    const tasksCollection = db.collection('scheduled_tasks')

    const {
      page = 1,
      pageNo = 1,
      pageSize = 10,
      shopId,
      shopName,
      platform,
      taskType,
      enabled,
    } = req.query

    const pageNum = parseInt(pageNo || page)
    const size = parseInt(pageSize)
    const skip = (pageNum - 1) * size

    // 构建查询条件
    const query = {}
    if (shopId) query.shopId = new ObjectId(shopId)
    if (platform) query.platform = platform
    if (taskType) query.taskType = taskType
    if (enabled !== undefined) query.enabled = enabled === 'true' || enabled === true

    // 如果按店铺名称搜索，需要先查找店铺
    if (shopName) {
      const shopsCollection = db.collection('shops')
      const shops = await shopsCollection
        .find({ shopName: { $regex: shopName, $options: 'i' } })
        .toArray()
      const shopIds = shops.map(shop => shop._id)
      if (shopIds.length > 0) {
        query.shopId = { $in: shopIds }
      }
      else {
        // 如果没有找到店铺，返回空结果
        return res.json(successResponse({
          pageData: [],
          total: 0,
          page: pageNum,
          pageSize: size,
        }))
      }
    }

    // 获取总数
    const total = await tasksCollection.countDocuments(query)

    // 获取任务列表
    const tasks = await tasksCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(size)
      .toArray()

    // 关联店铺信息
    const shopsCollection = db.collection('shops')
    const shopIds = [...new Set(tasks.map(task => task.shopId))]
    const shops = await shopsCollection
      .find({ _id: { $in: shopIds } })
      .toArray()
    const shopMap = new Map(shops.map(shop => [shop._id.toString(), shop]))

    // 格式化返回数据
    const result = tasks.map(task => {
      const shop = shopMap.get(task.shopId.toString())
      return {
        id: task._id.toString(),
        shopId: task.shopId.toString(),
        shopName: shop?.shopName || '未知店铺',
        platform: shop?.platform || task.platform || 'unknown',
        taskType: task.taskType,
        cronExpression: task.cronExpression,
        enabled: task.enabled !== false, // 默认为 true
        status: task.status || 'pending',
        nextRunAt: task.nextRunAt || null,
        lastRunAt: task.lastRunAt || null,
        runCount: task.runCount || 0,
        successCount: task.successCount || 0,
        failureCount: task.failureCount || 0,
        config: task.config || {},
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      }
    })

    res.json(successResponse({
      pageData: result,
      total,
      page: pageNum,
      pageSize: size,
    }))
  }
  catch (error) {
    console.error('获取任务列表错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

// 创建任务
export async function createTask(req, res) {
  try {
    const {
      shopId,
      taskType,
      cronExpression,
      enabled = true,
      config = {},
    } = req.body

    if (!shopId || !taskType || !cronExpression) {
      return res.status(400).json(errorResponse('店铺ID、任务类型和Cron表达式不能为空', 400))
    }

    // 验证 cron 表达式
    if (!cron.validate(cronExpression)) {
      return res.status(400).json(errorResponse('无效的Cron表达式', 400))
    }

    // 验证任务类型
    const validTaskTypes = ['auto_flow', 'login']
    if (!validTaskTypes.includes(taskType)) {
      return res.status(400).json(errorResponse('无效的任务类型，只支持: auto_flow, login', 400))
    }

    const db = getDatabase()
    const shopsCollection = db.collection('shops')
    const tasksCollection = db.collection('scheduled_tasks')

    // 获取店铺信息
    const shop = await shopsCollection.findOne({ _id: new ObjectId(shopId) })
    if (!shop) {
      return res.status(404).json(errorResponse('店铺不存在', 404))
    }

    // 检查该店铺是否已有相同类型的任务
    const existingTask = await tasksCollection.findOne({
      shopId: new ObjectId(shopId),
      taskType,
    })

    if (existingTask) {
      const taskTypeName = taskType === 'auto_flow' ? '自动化任务' : '登录任务'
      return res.status(400).json(errorResponse(`该店铺已存在${taskTypeName}，每个店铺的每种任务类型只能有一个`, 400))
    }

    // 创建任务
    const task = {
      shopId: new ObjectId(shopId),
      taskType,
      cronExpression,
      enabled: enabled === true || enabled === 'true',
      status: 'pending',
      config,
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.user?.userId ? new ObjectId(req.user.userId) : null,
    }

    const result = await tasksCollection.insertOne(task)
    const insertedTask = { ...task, _id: result.insertedId }

    // 如果任务启用，添加到调度器
    if (insertedTask.enabled) {
      await taskScheduler.scheduleTask(insertedTask)
    }

    // 格式化返回数据
    const shopInfo = {
      shopName: shop.shopName,
      platform: shop.platform,
    }

    res.json(successResponse({
      id: insertedTask._id.toString(),
      shopId: insertedTask.shopId.toString(),
      shopName: shopInfo.shopName,
      platform: shopInfo.platform,
      taskType: insertedTask.taskType,
      cronExpression: insertedTask.cronExpression,
      enabled: insertedTask.enabled,
      status: insertedTask.status,
      config: insertedTask.config,
      runCount: insertedTask.runCount,
      successCount: insertedTask.successCount,
      failureCount: insertedTask.failureCount,
      createdAt: insertedTask.createdAt,
      updatedAt: insertedTask.updatedAt,
    }, '任务创建成功'))
  }
  catch (error) {
    console.error('创建任务错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

// 更新任务
export async function updateTask(req, res) {
  try {
    const { id } = req.params
    const updateData = req.body

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的任务ID', 400))
    }

    const db = getDatabase()
    const tasksCollection = db.collection('scheduled_tasks')

    // 获取原任务
    const oldTask = await tasksCollection.findOne({ _id: new ObjectId(id) })
    if (!oldTask) {
      return res.status(404).json(errorResponse('任务不存在', 404))
    }

    // 如果修改了 shopId 或 taskType，需要检查唯一性
    if (updateData.shopId || updateData.taskType) {
      const newShopId = updateData.shopId ? new ObjectId(updateData.shopId) : oldTask.shopId
      const newTaskType = updateData.taskType || oldTask.taskType

      const existingTask = await tasksCollection.findOne({
        _id: { $ne: new ObjectId(id) }, // 排除当前任务
        shopId: newShopId,
        taskType: newTaskType,
      })

      if (existingTask) {
        const taskTypeName = newTaskType === 'auto_flow' ? '自动化任务' : '登录任务'
        return res.status(400).json(errorResponse(`该店铺已存在${taskTypeName}，每个店铺的每种任务类型只能有一个`, 400))
      }
    }

    // 如果修改了 cronExpression，验证格式
    if (updateData.cronExpression && !cron.validate(updateData.cronExpression)) {
      return res.status(400).json(errorResponse('无效的Cron表达式', 400))
    }

    // 构建更新数据
    const updateFields = {}
    if (updateData.shopId !== undefined) updateFields.shopId = new ObjectId(updateData.shopId)
    if (updateData.taskType !== undefined) updateFields.taskType = updateData.taskType
    if (updateData.cronExpression !== undefined) updateFields.cronExpression = updateData.cronExpression
    if (updateData.enabled !== undefined) updateFields.enabled = updateData.enabled === true || updateData.enabled === 'true'
    if (updateData.config !== undefined) updateFields.config = updateData.config
    updateFields.updatedAt = new Date()

    // 更新任务
    await tasksCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields },
    )

    // 重新加载任务到调度器
    await taskScheduler.loadTasks()

    // 获取更新后的任务信息
    const updatedTask = await tasksCollection.findOne({ _id: new ObjectId(id) })

    // 广播任务更新事件（包括状态、nextRunAt等）
    if (updatedTask) {
      const { websocketService } = await import('../services/websocketService.js')
      websocketService.broadcastTaskStatusUpdate({
        taskId: id,
        status: updatedTask.status || 'pending',
        enabled: updatedTask.enabled,
        nextRunAt: updatedTask.nextRunAt,
        cronExpression: updatedTask.cronExpression,
        updatedAt: updatedTask.updatedAt,
      })
    }

    res.json(successResponse(null, '任务更新成功'))
  }
  catch (error) {
    console.error('更新任务错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

// 删除任务
export async function deleteTask(req, res) {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的任务ID', 400))
    }

    const db = getDatabase()
    const tasksCollection = db.collection('scheduled_tasks')
    const executionsCollection = db.collection('task_executions')

    // 检查任务是否存在
    const task = await tasksCollection.findOne({ _id: new ObjectId(id) })
    if (!task) {
      return res.status(404).json(errorResponse('任务不存在', 404))
    }

    // 从调度器中移除任务
    await taskScheduler.removeTask(id)

    // 删除任务相关的所有执行记录
    const deleteExecutionsResult = await executionsCollection.deleteMany({
      taskId: new ObjectId(id),
    })
    console.log(`[删除任务] 已删除 ${deleteExecutionsResult.deletedCount} 条执行记录`)

    // 删除任务
    await tasksCollection.deleteOne({ _id: new ObjectId(id) })

    res.json(successResponse(null, '任务删除成功'))
  }
  catch (error) {
    console.error('删除任务错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

// 启用/禁用任务
export async function toggleTask(req, res) {
  try {
    const { id } = req.params
    const { enabled } = req.body

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的任务ID', 400))
    }

    const db = getDatabase()
    const tasksCollection = db.collection('scheduled_tasks')

    // 更新任务状态
    await tasksCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          enabled: enabled === true || enabled === 'true',
          updatedAt: new Date(),
        },
      },
    )

    // 重新加载任务到调度器
    await taskScheduler.loadTasks()

    res.json(successResponse(null, enabled ? '任务已启用' : '任务已禁用'))
  }
  catch (error) {
    console.error('切换任务状态错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

// 立即执行任务
export async function executeTaskNow(req, res) {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json(errorResponse('无效的任务ID', 400))
    }

    // 通过任务执行器立即执行任务
    await taskScheduler.executeTaskNow(id)

    res.json(successResponse(null, '任务已开始执行'))
  }
  catch (error) {
    console.error('立即执行任务错误:', error)
    res.status(500).json(errorResponse(error.message || '服务器内部错误', 500))
  }
}

// 获取任务执行记录
export async function getTaskExecutions(req, res) {
  try {
    const { taskId } = req.params
    const { page = 1, pageNo = 1, pageSize = 10 } = req.query

    if (!ObjectId.isValid(taskId)) {
      return res.status(400).json(errorResponse('无效的任务ID', 400))
    }

    const db = getDatabase()
    const executionsCollection = db.collection('task_executions')

    const pageNum = parseInt(pageNo || page)
    const size = parseInt(pageSize)
    const skip = (pageNum - 1) * size

    const total = await executionsCollection.countDocuments({ taskId: new ObjectId(taskId) })
    const executions = await executionsCollection
      .find({ taskId: new ObjectId(taskId) })
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(size)
      .toArray()

    const result = executions.map(exec => ({
      id: exec._id.toString(),
      taskId: exec.taskId.toString(),
      shopId: exec.shopId?.toString(),
      shopName: exec.shopName,
      platform: exec.platform,
      status: exec.status,
      startedAt: exec.startedAt,
      completedAt: exec.completedAt,
      duration: exec.duration,
      result: exec.result,
      logs: exec.logs || [],
      error: exec.error,
    }))

    res.json(successResponse({
      pageData: result,
      total,
      page: pageNum,
      pageSize: size,
    }))
  }
  catch (error) {
    console.error('获取任务执行记录错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

