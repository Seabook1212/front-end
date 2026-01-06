(function() {
  'use strict';

  var opentracing = require('opentracing');

  // Express middleware for tracing HTTP requests
  function tracingMiddleware(req, res, next) {
    var tracer = opentracing.globalTracer();

    // Extract parent span context from headers if present
    var wireCtx = tracer.extract(opentracing.FORMAT_HTTP_HEADERS, req.headers);

    // Create a new span for this request
    var span = tracer.startSpan(req.method + ' ' + req.path, {
      childOf: wireCtx
    });

    // Add tags to the span
    span.setTag(opentracing.Tags.HTTP_METHOD, req.method);
    span.setTag(opentracing.Tags.HTTP_URL, req.url);
    span.setTag(opentracing.Tags.SPAN_KIND, opentracing.Tags.SPAN_KIND_RPC_SERVER);
    span.setTag('service.name', 'front-end');

    // Store span in request object for use in route handlers
    req.span = span;

    // Wrap res.end to finish the span when response is sent
    var originalEnd = res.end;
    res.end = function() {
      span.setTag(opentracing.Tags.HTTP_STATUS_CODE, res.statusCode);

      if (res.statusCode >= 400) {
        span.setTag(opentracing.Tags.ERROR, true);
        span.log({
          event: 'error',
          'error.kind': 'http_error',
          message: 'HTTP ' + res.statusCode,
          statusCode: res.statusCode
        });
      }

      span.finish();
      originalEnd.apply(res, arguments);
    };

    next();
  }

  // Utility function to trace Redis operations
  function traceRedisOperation(operationName, key, callback) {
    var tracer = opentracing.globalTracer();
    var span = tracer.startSpan('redis.' + operationName);

    span.setTag(opentracing.Tags.DB_TYPE, 'redis');
    span.setTag(opentracing.Tags.DB_STATEMENT, operationName);
    if (key) {
      span.setTag('redis.key', key);
    }

    return function(err) {
      if (err) {
        span.setTag(opentracing.Tags.ERROR, true);
        span.log({
          event: 'error',
          'error.object': err,
          message: err.message,
          stack: err.stack
        });
      }
      span.finish();

      if (callback) {
        callback.apply(this, arguments);
      }
    };
  }

  // Utility function to trace outbound HTTP requests
  function traceOutboundRequest(req, url, method) {
    var tracer = opentracing.globalTracer();
    var parentSpan = req.span;

    var span = tracer.startSpan('http.' + (method || 'GET'), {
      childOf: parentSpan
    });

    span.setTag(opentracing.Tags.HTTP_URL, url);
    span.setTag(opentracing.Tags.HTTP_METHOD, method || 'GET');
    span.setTag(opentracing.Tags.SPAN_KIND, opentracing.Tags.SPAN_KIND_RPC_CLIENT);

    // Inject trace context into outbound request headers
    var headers = {};
    tracer.inject(span, opentracing.FORMAT_HTTP_HEADERS, headers);

    return {
      span: span,
      headers: headers
    };
  }

  // Function to finish a traced outbound request
  function finishOutboundRequest(span, statusCode, error) {
    if (statusCode) {
      span.setTag(opentracing.Tags.HTTP_STATUS_CODE, statusCode);
    }

    if (error || (statusCode && statusCode >= 400)) {
      span.setTag(opentracing.Tags.ERROR, true);
      span.log({
        event: 'error',
        message: error ? error.message : 'HTTP ' + statusCode,
        statusCode: statusCode
      });
    }

    span.finish();
  }

  module.exports = {
    tracingMiddleware: tracingMiddleware,
    traceRedisOperation: traceRedisOperation,
    traceOutboundRequest: traceOutboundRequest,
    finishOutboundRequest: finishOutboundRequest
  };
}());