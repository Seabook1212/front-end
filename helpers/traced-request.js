(function() {
  'use strict';

  var request = require('request');
  var opentracing = require('opentracing');

  /**
   * Extract B3 headers and baggage headers from the current request
   * These headers need to be propagated to downstream services
   *
   * B3 Headers (used by Zipkin/Jaeger):
   * - X-B3-TraceId: Trace ID (required)
   * - X-B3-SpanId: Current span ID (required)
   * - X-B3-ParentSpanId: Parent span ID (optional)
   * - X-B3-Sampled: Sampling decision (optional, 0 or 1)
   * - X-B3-Flags: Debug flag (optional)
   *
   * Baggage Headers (custom context propagation):
   * - x-vcap-request-id: VCAP request ID
   * - x-request-id: Generic request ID
   */
  function extractTracingHeaders(req) {
    var headers = {};

    if (!req || !req.headers) {
      return headers;
    }

    // Extract B3 headers from incoming request
    // B3 headers should be propagated with proper casing for Spring Boot compatibility
    var b3HeaderMappings = {
      'x-b3-traceid': 'X-B3-TraceId',
      'x-b3-spanid': 'X-B3-SpanId',
      'x-b3-parentspanid': 'X-B3-ParentSpanId',
      'x-b3-sampled': 'X-B3-Sampled',
      'x-b3-flags': 'X-B3-Flags',
      'b3': 'b3'  // Single B3 header format
    };

    Object.keys(b3HeaderMappings).forEach(function(headerLower) {
      var properCaseName = b3HeaderMappings[headerLower];
      if (req.headers[headerLower]) {
        headers[properCaseName] = req.headers[headerLower];
      }
    });

    // Extract baggage headers (custom request tracking)
    // These should also use proper casing
    var baggageHeaderMappings = {
      'x-vcap-request-id': 'X-Vcap-Request-Id',
      'x-request-id': 'X-Request-Id',
      'x-correlation-id': 'X-Correlation-Id'
    };

    Object.keys(baggageHeaderMappings).forEach(function(headerLower) {
      var properCaseName = baggageHeaderMappings[headerLower];
      if (req.headers[headerLower]) {
        headers[properCaseName] = req.headers[headerLower];
      }
    });

    return headers;
  }

  /**
   * Inject tracing headers into outbound request using OpenTracing
   * This creates a new child span and injects the trace context
   */
  function injectTracingHeaders(req, targetHeaders) {
    if (!req) {
      return targetHeaders;
    }

    try {
      var tracer = opentracing.globalTracer();
      var parentSpan = req.span;

      if (parentSpan && parentSpan.context && typeof parentSpan.context === 'function') {
        // Inject the span context into headers
        var spanContext = parentSpan.context();
        if (spanContext) {
          tracer.inject(spanContext, opentracing.FORMAT_HTTP_HEADERS, targetHeaders);
        }
      }
    } catch (error) {
      // If OpenTracing injection fails, just continue silently
      // The B3 headers have already been copied manually
    }

    return targetHeaders;
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
   * Add tracing headers to request options
   */
  function addTracingToOptions(options, req) {
    try {
      // Ensure headers object exists
      options.headers = options.headers || {};

      // Extract and propagate tracing headers
      if (req && req.headers) {
        var tracingHeaders = extractTracingHeaders(req);

        // For outbound requests, we need to create a new span ID
        // but keep the same trace ID to maintain the trace chain
        if (tracingHeaders['X-B3-TraceId']) {
          // Generate a new span ID for this outbound call
          var newSpanId = generateSpanId();

          // Set the parent span ID to the current span ID
          if (tracingHeaders['X-B3-SpanId']) {
            tracingHeaders['X-B3-ParentSpanId'] = tracingHeaders['X-B3-SpanId'];
          }

          // Set the new span ID
          tracingHeaders['X-B3-SpanId'] = newSpanId;
        }

        Object.assign(options.headers, tracingHeaders);
        injectTracingHeaders(req, options.headers);
      }

      return options;
    } catch (error) {
      // Return options unchanged if there's an error
      return options;
    }
  }

  /**
   * Wrapper for request.get() that automatically propagates tracing headers
   * Handles:
   * - request.get(url, {}, req) - streaming/piping
   * - request.get(url, {}, req, callback) - with callback
   */
  function tracedGet(url, options, req, callback) {
    // Handle different argument patterns
    // Pattern 1: tracedGet(url) - just url
    if (arguments.length === 1) {
      return request.get(url);
    }

    // Pattern 2: tracedGet(url, callback) - url and callback
    if (arguments.length === 2 && typeof options === 'function') {
      return request.get(url, options);
    }

    // Pattern 3: tracedGet(url, options) - url and options object
    if (arguments.length === 2 && typeof options === 'object') {
      if (!options.url) {
        options.url = url;
      }
      return request.get(options);
    }

    // Pattern 4: tracedGet(url, options, req) - url, options, and req for tracing
    if (arguments.length === 3) {
      if (!options || typeof options !== 'object') {
        options = {};
      }
      if (!options.url) {
        options.url = url;
      }

      addTracingToOptions(options, req);
      return request.get(options);
    }

    // Pattern 5: tracedGet(url, options, req, callback) - all parameters
    if (arguments.length === 4) {
      if (!options || typeof options !== 'object') {
        options = {};
      }
      if (!options.url) {
        options.url = url;
      }

      addTracingToOptions(options, req);
      return request.get(options, callback);
    }

    // Fallback
    return request.get.apply(request, arguments);
  }

  /**
   * General wrapper for request() that automatically propagates tracing headers
   * Handles:
   * - request(url, req, callback) - url string with req and callback
   * - request(options, req, callback) - options object with req and callback
   * - request(options, callback) - options object with just callback
   */
  function tracedRequest(urlOrOptions, reqOrCallback, callback) {
    var options;
    var req;
    var cb;

    // Parse arguments based on types
    // Pattern 1: request(options, callback) - 2 args, second is function
    if (arguments.length === 2 && typeof reqOrCallback === 'function') {
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : urlOrOptions;
      req = null;
      cb = reqOrCallback;
    }
    // Pattern 2: request(url_or_options, req, callback) - 3 args
    else if (arguments.length === 3) {
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : urlOrOptions;
      req = reqOrCallback;
      cb = callback;
    }
    // Pattern 3: request(url_or_options, req) - 2 args for streaming (no callback)
    else if (arguments.length === 2 && typeof reqOrCallback === 'object') {
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : urlOrOptions;
      req = reqOrCallback;
      cb = null;
    }
    // Pattern 4: request(options) - single arg
    else if (arguments.length === 1) {
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : urlOrOptions;
      req = null;
      cb = null;
    }
    // Fallback
    else {
      return request.apply(request, arguments);
    }

    // Add tracing headers if we have a req object
    if (req) {
      addTracingToOptions(options, req);
    }

    // Make the request
    if (cb) {
      return request(options, cb);
    } else {
      return request(options);
    }
  }

  // Expose the specialized methods
  tracedRequest.get = tracedGet;

  tracedRequest.post = function(options, req, callback) {
    if (arguments.length === 2 && typeof req === 'function') {
      // request.post(options, callback)
      return request.post(options, req);
    }

    addTracingToOptions(options, req);

    if (callback) {
      return request.post(options, callback);
    } else {
      return request.post(options);
    }
  };

  tracedRequest.put = function(options, req, callback) {
    if (arguments.length === 2 && typeof req === 'function') {
      return request.put(options, req);
    }

    addTracingToOptions(options, req);

    if (callback) {
      return request.put(options, callback);
    } else {
      return request.put(options);
    }
  };

  tracedRequest.patch = function(options, req, callback) {
    if (arguments.length === 2 && typeof req === 'function') {
      return request.patch(options, req);
    }

    addTracingToOptions(options, req);

    if (callback) {
      return request.patch(options, callback);
    } else {
      return request.patch(options);
    }
  };

  tracedRequest.delete = function(options, req, callback) {
    if (arguments.length === 2 && typeof req === 'function') {
      return request.delete(options, req);
    }

    addTracingToOptions(options, req);

    if (callback) {
      return request.delete(options, callback);
    } else {
      return request.delete(options);
    }
  };

  tracedRequest.head = function(options, req, callback) {
    if (arguments.length === 2 && typeof req === 'function') {
      return request.head(options, req);
    }

    addTracingToOptions(options, req);

    if (callback) {
      return request.head(options, callback);
    } else {
      return request.head(options);
    }
  };

  module.exports = tracedRequest;
}());
