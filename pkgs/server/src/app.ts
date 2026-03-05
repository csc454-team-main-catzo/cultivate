import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { describeRoute, resolver } from "hono-openapi"
import * as v from 'valibot'
import { openAPIRouteHandler } from 'hono-openapi'
import { authMiddleware } from './middleware/auth.js'
import imageRoutes from './routes/images.js'
import listingRoutes from './routes/listings.js'
import produceItemRoutes from './routes/produce-items.js'
import userRoutes from './routes/users.js'
import chatRoutes from './routes/chats.js'
import qualityGateRoutes from './routes/qualityGate.js'
import ordersRoutes from './routes/orders.js'

type AppBindings = {
  Variables: any
}

const app = new Hono<AppBindings>()

app.use(cors({
  origin: '*',
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))

const HealthCheckResponse = v.object({
  healthy: v.boolean(),
  time: v.date(),
  authenticated: v.boolean(),
  auth0Id: v.optional(v.string()),
})

app.get(
  '/health',
  describeRoute({
    operationId: 'healthcheck',
    summary: 'Health check route',
    security: [{ bearerAuth: [] }, {}],
    responses: {
      200: {
        description: 'Array of listings',
        content: {
          'application/json': {
            schema: resolver(HealthCheckResponse),
          },
        },
      },
      500: { description: 'Server error' },
    },
  }),
  authMiddleware({ optional: true }),
  (c) => {
    const auth0Id = c.get('auth0Id')
    const authenticated = Boolean(auth0Id)

    return c.json({
      healthy: true,
      time: new Date().toISOString(),
      authenticated,
      ...(authenticated ? { auth0Id } : {}),
    })
  },
)

// Ensure CORS headers are present even on unhandled errors.
// Hono's default error handler creates a brand-new Response that drops any
// headers previously set by the cors() middleware, so we must re-apply them.
app.onError((err, c) => {
  console.error('Unhandled server error:', err)
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  const message = err instanceof Error ? err.message : 'Internal Server Error'
  return c.json({ error: message }, 500)
})

// Mount resource routers
app.route('/listings', listingRoutes)
app.route('/users', userRoutes)
app.route('/api/listings', listingRoutes)
app.route('/api', imageRoutes)
app.route('/api', produceItemRoutes)
app.route('/api/chat', chatRoutes)
app.route('/', qualityGateRoutes)
app.route('/', ordersRoutes)

app.get(
  '/openapi.json',
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: 'Cultivate',
        version: '0.1.0',
        description: 'test',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      servers: [
        {
          url:
            process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : process.env.API_URL || 'http://localhost:3000',
        },
      ],
    },
    includeEmptyPaths: true,
  }),
)

export default app
