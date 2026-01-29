(function() {
  'use strict';

  var request = require('request');
  var opentracing = require('opentracing');
  var url = require('url');
  var logger = require('./logger');
  var tracers = require('../tracing');

  /**
   * Extract service name from URL
   * e.g., http://catalogue/items -> "catalogue"
   *       http://user.sock-shop/login -> "user"
   */
  function extractServiceName(targetUrl) {
    try {
      var parsed = url.parse(targetUrl);
      var hostname = parsed.hostname || '';
      // Remove domain suffix (e.g., .sock-shop, .svc.cluster.local)
      var serviceName = hostname.split('.')[0];
      return serviceName || 'unknown-service';
    } catch (e) {
      return 'unknown-service';
    }
  }

  /**
   * Extract path from URL for span naming
   * e.g., http://catalogue/items?size=10 -> "/items"
   */
  function extractPath(targetUrl) {
    try {
      var parsed = url.parse(targetUrl);
      return parsed.pathname || '/';
    } catch (e) {
      return '/';
    }
  }

  /**
   * Generate W3C traceparent header value
   * Format: version-traceId-spanId-flags
   * e.g., 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
   */
  function generateTraceparent(traceId, spanId, sampled) {
    // Ensure traceId is 32 hex chars (pad if needed for 64-bit trace IDs)
    var normalizedTraceId = traceId;
    if (traceId && traceId.length === 16) {
      normalizedTraceId = '0000000000000000' + traceId;
    }

    var flags = sampled ? '01' : '00';
    return '00-' + (normalizedTraceId || '00000000000000000000000000000000') + '-' + (spanId || '0000000000000000') + '-' + flags;
  }

  /**
   * Generate a random 64-bit hex string for span ID
   */
  function generateSpanId() {
    var bytes = [];
    for (var i = 0; i < 8; i++) {
      bytes.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
    }
    return bytes.join('');
  }

  /**
   * Create a client span for an outbound HTTP request
   * Returns { span, headers } where headers contains trace context
   */
  function createClientSpan(req, method, targetUrl) {
    // Use the client tracer (not the global server tracer) for outbound calls
    var clientTracer = tracers.clientTracer;
    var parentSpan = req ? req.span : null;

    var serviceName = extractServiceName(targetUrl);
    var path = extractPath(targetUrl);

    // Create span name: "HTTP GET user-service /login" or "front-end -> user-service"
    var spanName = 'HTTP ' + method + ' ' + serviceName + ' ' + path;

    // Create child span using client tracer
    var span = clientTracer.startSpan(spanName, {
      childOf: parentSpan
    });

    // Set standard OpenTracing tags
    span.setTag(opentracing.Tags.HTTP_METHOD, method);
    span.setTag(opentracing.Tags.HTTP_URL, targetUrl);
    span.setTag('peer.service', serviceName);
    span.setTag('component', 'http-client');

    // Get trace context from span for header injection
    var headers = {};
    var traceId = null;
    var spanId = null;
    var parentSpanId = null;
    var sampled = true;

    // First, get parentSpanId from the parent span (server span)
    if (parentSpan && parentSpan.context) {
      try {
        var parentContext = parentSpan.context();
        if (parentContext && typeof parentContext.toSpanId === 'function') {
          parentSpanId = parentContext.toSpanId();
        }
        if (parentContext && typeof parentContext.toTraceId === 'function') {
          traceId = parentContext.toTraceId();
        }
      } catch (e) {
        // Continue silently
      }
    }

    // Fallback for parentSpanId: use incoming request header
    if (!parentSpanId && req && req.headers && req.headers['x-b3-spanid']) {
      parentSpanId = req.headers['x-b3-spanid'];
    }

    // Extract span ID directly from the span object
    // The inject() method is broken in zipkin-javascript-opentracing, so we access span.id directly
    try {
      // Method 1: span.id (the zipkin TraceId object)
      if (span.id) {
        if (span.id._spanId) {
          spanId = span.id._spanId;
        } else if (span.id.spanId) {
          spanId = span.id.spanId;
        }
        if (span.id._traceId) {
          traceId = span.id._traceId;
        } else if (span.id.traceId) {
          traceId = span.id.traceId;
        }
      }

      // Method 2: span._span (internal span wrapper)
      if (!spanId && span._span && span._span.id) {
        if (span._span.id._spanId) {
          spanId = span._span.id._spanId;
        }
      }

      // Method 3: Try span.context() methods
      if (!spanId) {
        var spanContext = span.context();
        if (spanContext) {
          if (spanContext._spanId) {
            spanId = spanContext._spanId;
          } else if (typeof spanContext.toSpanId === 'function') {
            try {
              spanId = spanContext.toSpanId();
            } catch (e) {
              // Continue silently
            }
          }
          if (!traceId && typeof spanContext.toTraceId === 'function') {
            try {
              traceId = spanContext.toTraceId();
            } catch (e) {
              // Continue silently
            }
          }
        }
      }
    } catch (e) {
      // Continue silently
    }

    // Generate span ID if we couldn't extract it
    if (!spanId) {
      spanId = generateSpanId();
    }

    // Fallback: try to get trace ID from incoming request headers
    if (!traceId && req && req.headers) {
      traceId = req.headers['x-b3-traceid'];
      if (req.headers['x-b3-sampled']) {
        sampled = req.headers['x-b3-sampled'] === '1';
      }
    }

    // Inject B3 headers (multi-header format for Spring Boot compatibility)
    if (traceId) {
      headers['X-B3-TraceId'] = traceId;
      headers['X-B3-SpanId'] = spanId;
      if (parentSpanId) {
        headers['X-B3-ParentSpanId'] = parentSpanId;
      }
      headers['X-B3-Sampled'] = sampled ? '1' : '0';

      // Also add single B3 header format
      var b3Value = traceId + '-' + spanId;
      if (sampled) {
        b3Value += '-1';
      }
      if (parentSpanId) {
        b3Value += '-' + parentSpanId;
      }
      headers['b3'] = b3Value;

      // Add W3C traceparent header
      headers['traceparent'] = generateTraceparent(traceId, spanId, sampled);

      // Add W3C tracestate (optional, for vendor-specific data)
      headers['tracestate'] = 'sock-shop=' + spanId;

      // Log outbound trace headers
      logger.log(req, 'Outbound call to ' + serviceName + ' ' + path + ' | X-B3-TraceId: ' + traceId + ', X-B3-SpanId: ' + spanId + ', X-B3-ParentSpanId: ' + (parentSpanId || 'none'));
    }

    return {
      span: span,
      headers: headers,
      serviceName: serviceName
    };
  }

  /**
   * Finish a client span with response info
   */
  function finishClientSpan(span, error, response) {
    if (!span) return;

    try {
      if (response) {
        span.setTag(opentracing.Tags.HTTP_STATUS_CODE, response.statusCode);

        // Mark as error if status >= 400
        if (response.statusCode >= 400) {
          span.setTag(opentracing.Tags.ERROR, true);
          span.log({
            event: 'error',
            'error.kind': 'http_error',
            'http.status_code': response.statusCode,
            message: 'HTTP ' + response.statusCode
          });
        }
      }

      if (error) {
        span.setTag(opentracing.Tags.ERROR, true);
        span.log({
          event: 'error',
          'error.kind': error.name || 'Error',
          'error.object': error,
          message: error.message,
          stack: error.stack
        });
      }

      span.finish();
    } catch (e) {
      // Silently ignore span finishing errors
      try {
        span.finish();
      } catch (e2) {
        // Ignore
      }
    }
  }

  /**
   * Add tracing headers to request options (without creating a span)
   * Used for streaming requests where we can't easily track response
   */
  function addTracingToOptions(options, req) {
    try {
      options.headers = options.headers || {};

      var traceId = null;
      var parentSpanId = null;
      var sampled = '1';

      // First, try to get trace context from the server span (req.span)
      if (req && req.span && req.span.context) {
        try {
          var spanContext = req.span.context();
          if (spanContext) {
            if (typeof spanContext.toTraceId === 'function') {
              traceId = spanContext.toTraceId();
            }
            if (typeof spanContext.toSpanId === 'function') {
              parentSpanId = spanContext.toSpanId();
            }
          }
        } catch (e) {
          // Continue to fallback
        }
      }

      // Fallback: extract from incoming request headers
      if (req && req.headers) {
        if (!traceId) {
          traceId = req.headers['x-b3-traceid'];
        }
        if (!parentSpanId) {
          parentSpanId = req.headers['x-b3-spanid'];
        }
        if (req.headers['x-b3-sampled']) {
          sampled = req.headers['x-b3-sampled'];
        }
      }

      if (traceId) {
        // Generate new span ID for this outbound call
        var newSpanId = generateSpanId();

        // B3 multi-header format
        options.headers['X-B3-TraceId'] = traceId;
        options.headers['X-B3-SpanId'] = newSpanId;
        if (parentSpanId) {
          options.headers['X-B3-ParentSpanId'] = parentSpanId;
        }
        options.headers['X-B3-Sampled'] = sampled;

        // B3 single header format
        var b3Value = traceId + '-' + newSpanId;
        if (sampled === '1') {
          b3Value += '-1';
        }
        if (parentSpanId) {
          b3Value += '-' + parentSpanId;
        }
        options.headers['b3'] = b3Value;

        // W3C traceparent
        options.headers['traceparent'] = generateTraceparent(traceId, newSpanId, sampled === '1');
        options.headers['tracestate'] = 'sock-shop=' + newSpanId;

        // Log outbound trace headers for debugging (streaming request)
        var targetUrl = options.url || options.uri || 'unknown';
        var serviceName = extractServiceName(targetUrl);
        var path = extractPath(targetUrl);
        logger.log(req, 'Outbound streaming call to ' + serviceName + ' ' + path + ' | X-B3-TraceId: ' + traceId + ', X-B3-SpanId: ' + newSpanId + ', X-B3-ParentSpanId: ' + (parentSpanId || 'none'));
      }

      return options;
    } catch (error) {
      return options;
    }
  }

  /**
   * Wrapper for request.get() with client span creation
   */
  function tracedGet(url, options, req, callback) {
    var targetUrl = url;

    // Handle different argument patterns
    if (arguments.length === 1) {
      return request.get(url);
    }

    if (arguments.length === 2 && typeof options === 'function') {
      return request.get(url, options);
    }

    if (arguments.length === 2 && typeof options === 'object') {
      if (!options.url) {
        options.url = url;
      }
      return request.get(options);
    }

    // Pattern with req for tracing (3 or 4 args)
    if (arguments.length >= 3) {
      if (!options || typeof options !== 'object') {
        options = {};
      }
      if (!options.url) {
        options.url = url;
      }
      targetUrl = options.url || url;

      // Create client span
      var tracing = createClientSpan(req, 'GET', targetUrl);
      options.headers = Object.assign({}, options.headers, tracing.headers);

      // If no callback (streaming), just add headers and return stream
      if (arguments.length === 3 || typeof callback !== 'function') {
        // For streaming, we can't easily track the response
        // Just propagate headers without detailed span (span created but finished immediately)
        tracing.span.log({ event: 'streaming_request' });
        tracing.span.finish();
        return request.get(options);
      }

      // With callback, wrap it to finish span
      return request.get(options, function(error, response, body) {
        finishClientSpan(tracing.span, error, response);
        callback(error, response, body);
      });
    }

    return request.get.apply(request, arguments);
  }

  /**
   * General traced request wrapper
   */
  function tracedRequest(urlOrOptions, reqOrCallback, callback) {
    var options;
    var req;
    var cb;
    var method = 'GET';

    // Parse arguments
    if (arguments.length === 2 && typeof reqOrCallback === 'function') {
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : Object.assign({}, urlOrOptions);
      req = null;
      cb = reqOrCallback;
    } else if (arguments.length === 3) {
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : Object.assign({}, urlOrOptions);
      req = reqOrCallback;
      cb = callback;
    } else if (arguments.length === 2 && typeof reqOrCallback === 'object') {
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : Object.assign({}, urlOrOptions);
      req = reqOrCallback;
      cb = null;
    } else if (arguments.length === 1) {
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : Object.assign({}, urlOrOptions);
      req = null;
      cb = null;
    } else {
      return request.apply(request, arguments);
    }

    method = (options.method || 'GET').toUpperCase();
    var targetUrl = options.url || options.uri || '';

    // If we have a req, create client span
    if (req) {
      var tracing = createClientSpan(req, method, targetUrl);
      options.headers = Object.assign({}, options.headers, tracing.headers);

      if (cb) {
        return request(options, function(error, response, body) {
          finishClientSpan(tracing.span, error, response);
          cb(error, response, body);
        });
      } else {
        // Streaming - finish span immediately
        tracing.span.log({ event: 'streaming_request' });
        tracing.span.finish();
        return request(options);
      }
    }

    // No req, just make normal request
    if (cb) {
      return request(options, cb);
    } else {
      return request(options);
    }
  }

  /**
   * Create traced method wrapper for POST, PUT, PATCH, DELETE, HEAD
   */
  function createTracedMethod(method) {
    return function(urlOrOptions, req, callback) {
      var options;
      var targetUrl;

      // Handle (options, callback) pattern - no tracing
      if (arguments.length === 2 && typeof req === 'function') {
        return request[method.toLowerCase()](urlOrOptions, req);
      }

      // Parse options
      if (typeof urlOrOptions === 'string') {
        options = { url: urlOrOptions };
      } else {
        options = Object.assign({}, urlOrOptions);
      }

      targetUrl = options.url || options.uri || '';

      // Create client span
      var tracing = createClientSpan(req, method.toUpperCase(), targetUrl);
      options.headers = Object.assign({}, options.headers, tracing.headers);

      if (callback) {
        return request[method.toLowerCase()](options, function(error, response, body) {
          finishClientSpan(tracing.span, error, response);
          callback(error, response, body);
        });
      } else {
        // Streaming - finish span immediately
        tracing.span.log({ event: 'streaming_request' });
        tracing.span.finish();
        return request[method.toLowerCase()](options);
      }
    };
  }

  // Expose the traced request wrapper
  tracedRequest.get = tracedGet;
  tracedRequest.post = createTracedMethod('POST');
  tracedRequest.put = createTracedMethod('PUT');
  tracedRequest.patch = createTracedMethod('PATCH');
  tracedRequest.delete = createTracedMethod('DELETE');
  tracedRequest.head = createTracedMethod('HEAD');

  // Expose utility functions for external use
  tracedRequest.createClientSpan = createClientSpan;
  tracedRequest.finishClientSpan = finishClientSpan;
  tracedRequest.addTracingToOptions = addTracingToOptions;

  module.exports = tracedRequest;
}());
