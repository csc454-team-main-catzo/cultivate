import { serve } from '@hono/node-server'
import { connectDB } from './db.js'
import app from './app.js'
import { startDailyPriceScheduler } from './services/dailyPriceUpdater.js'

await connectDB()

startDailyPriceScheduler()

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
