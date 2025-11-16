import express from 'express'
import {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  toggleTask,
  executeTaskNow,
  getTaskExecutions,
} from '../controllers/taskController.js'

const router = express.Router()

// 获取任务列表
router.get('/', getTasks)

// 创建任务
router.post('/', createTask)

// 更新任务
router.patch('/:id', updateTask)

// 删除任务
router.delete('/:id', deleteTask)

// 启用/禁用任务
router.patch('/:id/toggle', toggleTask)

// 立即执行任务
router.post('/:id/execute', executeTaskNow)

// 获取任务执行记录
router.get('/:taskId/executions', getTaskExecutions)

export default router

