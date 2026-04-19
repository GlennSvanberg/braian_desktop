import { httpRouter } from 'convex/server'

import { auth } from './auth'
import { providerProxyHandler, providerProxyPing } from './providerProxy'

const http = httpRouter()

auth.addHttpRoutes(http)

// Proxy for the cloud chat path. Catches any sub-path under `/provider-proxy/`
// (provider id + the upstream path) and forwards. Must be registered for both
// POST (chat completions) and OPTIONS (CORS preflight).
http.route({
  pathPrefix: '/provider-proxy/',
  method: 'POST',
  handler: providerProxyHandler,
})
http.route({
  pathPrefix: '/provider-proxy/',
  method: 'OPTIONS',
  handler: providerProxyHandler,
})

// Tiny no-auth GET endpoint you can hit from a browser tab to confirm the
// HTTP router is wired up and CORS is friendly. Returns "ok".
http.route({
  path: '/provider-proxy-ping',
  method: 'GET',
  handler: providerProxyPing,
})

export default http
