import express from 'express'

const router = express.Router()

/* GET users listing. */
router.get('/', (req, res) => {
  res.json({
    code: 200,
    message: 'Users API',
    data: null,
  })
})

export default router
