import { MongoClient } from 'mongodb'

const DATABASE_NAME = 'fortune_flow'
const PROD_MONGO_URI = 'mongodb://admin1:123456@106.53.78.192:27017/?authSource=fortune_flow'
const LOCAL_MONGO_URI = 'mongodb://admin1:123456@127.0.0.1:27017/?authSource=fortune_flow'
const MONGODB_URI = PROD_MONGO_URI // 生产
// const MONGODB_URI = LOCAL_MONGO_URI // 本地
const mongoOptions = {
  maxPoolSize: 20,
  connectTimeoutMS: 10000,
  serverSelectionTimeoutMS: 10000,
}

let client = null
let db = null

/**
 * 连接 MongoDB 数据库
 */
export async function connectDatabase() {
  if (db) {
    return db
  }

  try {
    client = new MongoClient(MONGODB_URI, mongoOptions)
    await client.connect()
    db = client.db(DATABASE_NAME)
    console.log(`✅ MongoDB 连接成功，数据库：${DATABASE_NAME}`)

    // 初始化默认用户
    await initDefaultUser()

    return db
  } catch (error) {
    console.error('❌ MongoDB 连接失败:', error)
    throw error
  }
}

/**
 * 获取数据库实例
 */
export function getDatabase() {
  if (!db) {
    throw new Error('数据库未连接，请先调用 connectDatabase()')
  }
  return db
}

/**
 * 关闭数据库连接
 */
export async function closeDatabase() {
  if (client) {
    await client.close()
    client = null
    db = null
    console.log('MongoDB 连接已关闭')
  }
}

/**
 * 初始化默认用户
 */
async function initDefaultUser() {
  try {
    const usersCollection = db.collection('users')
    const existingUser = await usersCollection.findOne({ username: 'admin' })

    if (!existingUser) {
      const bcrypt = await import('bcrypt')
      const hashedPassword = await bcrypt.default.hash('123456', 10)

      await usersCollection.insertOne({
        username: 'admin',
        password: hashedPassword,
        nickname: '管理员',
        status: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      console.log('✅ 默认用户创建成功 (admin/123456)')
    }
  } catch (error) {
    console.error('初始化默认用户失败:', error)
  }
}

