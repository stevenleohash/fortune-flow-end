import createError from 'http-errors'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import cookieParser from 'cookie-parser'
import logger from 'morgan'
import cors from 'cors'
import { connectDatabase, getDatabase } from './config/database.js'

import indexRouter from './routes/index.js'
import usersRouter from './routes/users.js'
import userRouter from './routes/user.js'
import authRouter from './routes/auth.js'
import companiesRouter from './routes/companies.js'
import shopsRouter from './routes/shops.js'
import roleRouter from './routes/role.js'
import permissionRouter from './routes/permission.js'
import tasksRouter from './routes/tasks.js'
import userSettingsRouter from './routes/userSettings.js'
import { taskScheduler } from './services/taskScheduler.js'
import { websocketService } from './services/websocketService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// 连接数据库
let dbReady = false
connectDatabase()
  .then(async () => {
    dbReady = true
    console.log('✅ 数据库连接就绪')

    // 初始化任务集合和索引
    await initTaskCollections()

    // 启动任务调度器
    await taskScheduler.start()
  })
  .catch((error) => {
    console.error('❌ 数据库连接失败:', error)
    console.error('请确保 MongoDB 服务正在运行: mongodb://localhost:27017')
    // 不立即退出，允许服务器启动，但会在请求时返回错误
  })

// 数据库连接检查中间件
app.use('/api', (req, res, next) => {
  if (!dbReady) {
    return res.status(503).json({
      code: 503,
      message: '数据库未连接，请稍后重试',
      data: null,
    })
  }
  next()
})

// CORS 配置
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5222',
  process.env.FRONTEND_URL,
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // 允许没有 origin 的请求（如移动应用或 Postman）
    if (!origin) {
      return callback(null, true)
    }
    // 检查 origin 是否在允许列表中
    if (allowedOrigins.includes(origin) || origin.startsWith('http://localhost:')) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'jade')

app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, 'public')))

// 路由配置 - 所有接口统一使用 /api 前缀
app.use('/', indexRouter)
app.use('/api/auth', authRouter)
app.use('/api/user', userRouter)
app.use('/api/user-settings', userSettingsRouter)
app.use('/api/role', roleRouter)
app.use('/api/permission', permissionRouter)
app.use('/api/companies', companiesRouter)
app.use('/api/shops', shopsRouter)
app.use('/api/tasks', tasksRouter)

// catch 404 and forward to error handler
app.use((req, res, next) => {
  next(createError(404))
})

// error handler
app.use((err, req, res, next) => {
  // set locals, only providing error in development
  res.locals.message = err.message
  res.locals.error = req.app.get('env') === 'development' ? err : {}

  // 返回 JSON 格式的错误响应
  res.status(err.status || 500)
  res.json({
    code: err.status || 500,
    message: err.message || '服务器内部错误',
    data: null,
  })
})

/**
 * 初始化任务集合和索引
 */
async function initTaskCollections() {
  try {
    const db = getDatabase()

    // 初始化 scheduled_tasks 集合
    const tasksCollection = db.collection('scheduled_tasks')

    // 创建唯一索引：确保每个店铺的每个任务类型只能有一个
    await tasksCollection.createIndex(
      { shopId: 1, taskType: 1 },
      { unique: true, name: 'shopId_taskType_unique' }
    )

    // 创建其他索引
    await tasksCollection.createIndex({ enabled: 1 })
    await tasksCollection.createIndex({ status: 1 })
    await tasksCollection.createIndex({ createdAt: -1 })

    console.log('✅ 任务集合索引初始化完成')

    // 初始化 task_executions 集合
    const executionsCollection = db.collection('task_executions')

    // 创建索引
    await executionsCollection.createIndex({ taskId: 1, startedAt: -1 })
    await executionsCollection.createIndex({ shopId: 1, startedAt: -1 })
    await executionsCollection.createIndex({ status: 1 })

    console.log('✅ 任务执行记录集合索引初始化完成')
  }
  catch (error) {
    console.error('❌ 初始化任务集合失败:', error)
  }
}

export default app
