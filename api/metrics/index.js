(function (){
  'use strict';
  const apiRoutes = ['cart', 'catalogue', 'orders', 'user'];
  var express = require("express")
    , client  = require('prom-client')
    , app     = express()

  // Enable default metrics collection (memory, CPU, event loop, etc.)
  client.collectDefaultMetrics({
    prefix: 'nodejs_',
    gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
    eventLoopMonitoringPrecision: 10
  });

  const metric = {
    http: {
      requests: {
        duration: new client.Histogram({
          name: 'http_request_duration_seconds',
          help: 'request duration in seconds',
          labelNames: ['service', 'method', 'path', 'status_code'],
          buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
        }),
        total: new client.Counter({
          name: 'http_requests_total',
          help: 'total number of HTTP requests',
          labelNames: ['service', 'method', 'path', 'status_code']
        }),
        size: new client.Histogram({
          name: 'http_request_size_bytes',
          help: 'HTTP request size in bytes',
          labelNames: ['service', 'method', 'path'],
          buckets: [100, 1000, 5000, 10000, 50000, 100000, 500000, 1000000]
        }),
        responseSize: new client.Histogram({
          name: 'http_response_size_bytes',
          help: 'HTTP response size in bytes',
          labelNames: ['service', 'method', 'path', 'status_code'],
          buckets: [100, 1000, 5000, 10000, 50000, 100000, 500000, 1000000]
        }),
        inProgress: new client.Gauge({
          name: 'http_requests_in_progress',
          help: 'number of HTTP requests currently being processed',
          labelNames: ['service', 'method', 'path']
        }),
        errors: new client.Counter({
          name: 'http_request_errors_total',
          help: 'total number of HTTP request errors',
          labelNames: ['service', 'method', 'path', 'status_code', 'error_type']
        })
      }
    }
  }

  function s(start) {
    var diff = process.hrtime(start);
    return (diff[0] * 1e9 + diff[1]) / 1000000000;
  }

  function getRequestSize(req) {
    var size = 0;
    if (req.headers['content-length']) {
      size = parseInt(req.headers['content-length'], 10);
    }
    return size;
  }

  function getResponseSize(res) {
    var size = 0;
    if (res._contentLength) {
      size = res._contentLength;
    } else if (res.getHeader && res.getHeader('content-length')) {
      size = parseInt(res.getHeader('content-length'), 10);
    }
    return size || 0;
  }

  function observe(method, path, statusCode, start, requestSize, responseSize) {
    var route = path.toLowerCase();
    if (route !== '/metrics' && route !== '/metrics/') {
        var duration = s(start);
        var methodLower = method.toLowerCase();

        // Record duration
        metric.http.requests.duration.labels('front-end', methodLower, route, statusCode).observe(duration);

        // Record total requests
        metric.http.requests.total.labels('front-end', methodLower, route, statusCode).inc();

        // Record request size
        if (requestSize > 0) {
          metric.http.requests.size.labels('front-end', methodLower, route).observe(requestSize);
        }

        // Record response size
        if (responseSize > 0) {
          metric.http.requests.responseSize.labels('front-end', methodLower, route, statusCode).observe(responseSize);
        }

        // Record errors (4xx and 5xx)
        if (statusCode >= 400) {
          var errorType = statusCode >= 500 ? 'server_error' : 'client_error';
          metric.http.requests.errors.labels('front-end', methodLower, route, statusCode, errorType).inc();
        }
    }
  };

  function middleware(request, response, done) {
    var start = process.hrtime();
    var model = request.path.split('/')[1];

    // Track in-progress requests
    if (apiRoutes.indexOf(model) !== -1) {
      var methodLower = request.method.toLowerCase();
      metric.http.requests.inProgress.labels('front-end', methodLower, model).inc();
    }

    response.on('finish', function() {
      // Only log API routes, and only record the backend service name (no unique identifiers)
      if (apiRoutes.indexOf(model) !== -1) {
        var requestSize = getRequestSize(request);
        var responseSize = getResponseSize(response);
        observe(request.method, model, response.statusCode, start, requestSize, responseSize);

        // Decrement in-progress counter
        metric.http.requests.inProgress.labels('front-end', request.method.toLowerCase(), model).dec();
      }
    });

    return done();
  };


  app.use(middleware);
  app.get("/metrics", async function(req, res) {
      res.header("content-type", "text/plain");
      try {
        const metrics = await client.register.metrics();
        return res.end(metrics);
      } catch (err) {
        res.status(500).end(err);
      }
  });

  module.exports = app;
}());
