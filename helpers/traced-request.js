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
    var b3Headers = [
      'x-b3-traceid',
      'x-b3-spanid',
      'x-b3-parentspanid',
      'x-b3-sampled',
      'x-b3-flags',
      'b3' // Single B3 header format
    ];

    b3Headers.forEach(function(header) {
      var headerLower = header.toLowerCase();
      if (req.headers[headerLower]) {
        headers[header] = req.headers[headerLower];
      }
    });

    // Extract baggage headers (custom request tracking)
    var baggageHeaders = [
      'x-vcap-request-id',
      'x-request-id',
      'x-correlation-id'
    ];

    baggageHeaders.forEach(function(header) {
      var headerLower = header.toLowerCase();
      if (req.headers[headerLower]) {
        headers[header] = req.headers[headerLower];
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
          console.log('[TRACE-DEBUG] Successfully injected OpenTracing span context');
        } else {
          console.log('[TRACE-DEBUG] No span context available, skipping OpenTracing injection');
        }
      } else {
        console.log('[TRACE-DEBUG] No active span on request object, skipping OpenTracing injection');
      }
    } catch (error) {
      // If OpenTracing injection fails, just log and continue
      // The B3 headers have already been copied manually
      console.log('[TRACE-DEBUG] OpenTracing injection failed (non-critical):', error.message);
    }

    return targetHeaders;
  }

  /**
   * Add tracing headers to request options
   */
  function addTracingToOptions(options, req) {
    try {
      console.log('[TRACE-DEBUG] addTracingToOptions called');
      console.log('[TRACE-DEBUG] - options:', JSON.stringify(options));
      console.log('[TRACE-DEBUG] - req:', req ? 'present' : 'null');

      // Ensure headers object exists
      options.headers = options.headers || {};

      // Extract and propagate tracing headers
      if (req && req.headers) {
        console.log('[TRACE-DEBUG] Extracting tracing headers from req.headers');
        var tracingHeaders = extractTracingHeaders(req);
        console.log('[TRACE-DEBUG] Extracted headers:', JSON.stringify(tracingHeaders));
        Object.assign(options.headers, tracingHeaders);
        injectTracingHeaders(req, options.headers);
      } else {
        console.log('[TRACE-DEBUG] No req.headers available, skipping header extraction');
      }

      console.log('[TRACE] Outbound', options.method || 'GET', 'to:', options.uri || options.url);
      console.log('[TRACE] Propagating headers:', JSON.stringify(options.headers));

      return options;
    } catch (error) {
      console.error('[TRACE-ERROR] Error in addTracingToOptions:', error.message);
      console.error('[TRACE-ERROR] Stack:', error.stack);
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
    console.log('[TRACE-DEBUG] tracedGet called with', arguments.length, 'arguments');
    console.log('[TRACE-DEBUG] - url:', typeof url, url);
    console.log('[TRACE-DEBUG] - options:', typeof options, options);
    console.log('[TRACE-DEBUG] - req:', typeof req, req ? 'express-req' : 'null/undefined');
    console.log('[TRACE-DEBUG] - callback:', typeof callback);

    // Handle different argument patterns
    // Pattern 1: tracedGet(url) - just url
    if (arguments.length === 1) {
      console.log('[TRACE-DEBUG] Pattern 1: Single URL argument');
      return request.get(url);
    }

    // Pattern 2: tracedGet(url, callback) - url and callback
    if (arguments.length === 2 && typeof options === 'function') {
      console.log('[TRACE-DEBUG] Pattern 2: URL + callback');
      return request.get(url, options);
    }

    // Pattern 3: tracedGet(url, options) - url and options object
    if (arguments.length === 2 && typeof options === 'object') {
      console.log('[TRACE-DEBUG] Pattern 3: URL + options');
      if (!options.url) {
        options.url = url;
      }
      return request.get(options);
    }

    // Pattern 4: tracedGet(url, options, req) - url, options, and req for tracing
    if (arguments.length === 3) {
      console.log('[TRACE-DEBUG] Pattern 4: URL + options + req (streaming/piping)');
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
      console.log('[TRACE-DEBUG] Pattern 5: URL + options + req + callback');
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
    console.log('[TRACE-DEBUG] Fallback: Using apply with all arguments');
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
    console.log('[TRACE-DEBUG] tracedRequest called with', arguments.length, 'arguments');
    console.log('[TRACE-DEBUG] - urlOrOptions:', typeof urlOrOptions, typeof urlOrOptions === 'string' ? urlOrOptions : JSON.stringify(urlOrOptions));
    console.log('[TRACE-DEBUG] - reqOrCallback:', typeof reqOrCallback);
    console.log('[TRACE-DEBUG] - callback:', typeof callback);

    var options;
    var req;
    var cb;

    // Parse arguments based on types
    // Pattern 1: request(options, callback) - 2 args, second is function
    if (arguments.length === 2 && typeof reqOrCallback === 'function') {
      console.log('[TRACE-DEBUG] Pattern 1: options + callback (no req)');
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : urlOrOptions;
      req = null;
      cb = reqOrCallback;
    }
    // Pattern 2: request(url_or_options, req, callback) - 3 args
    else if (arguments.length === 3) {
      console.log('[TRACE-DEBUG] Pattern 2: url_or_options + req + callback');
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : urlOrOptions;
      req = reqOrCallback;
      cb = callback;
    }
    // Pattern 3: request(url_or_options, req) - 2 args for streaming (no callback)
    else if (arguments.length === 2 && typeof reqOrCallback === 'object') {
      console.log('[TRACE-DEBUG] Pattern 3: url_or_options + req (streaming, no callback)');
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : urlOrOptions;
      req = reqOrCallback;
      cb = null;
    }
    // Pattern 4: request(options) - single arg
    else if (arguments.length === 1) {
      console.log('[TRACE-DEBUG] Pattern 4: Single argument (options or url)');
      options = (typeof urlOrOptions === 'string') ? { url: urlOrOptions } : urlOrOptions;
      req = null;
      cb = null;
    }
    // Fallback
    else {
      console.log('[TRACE-DEBUG] Fallback: Using apply with all arguments');
      return request.apply(request, arguments);
    }

    console.log('[TRACE-DEBUG] Parsed - options:', JSON.stringify(options));
    console.log('[TRACE-DEBUG] Parsed - req:', req ? 'present' : 'null');
    console.log('[TRACE-DEBUG] Parsed - cb:', cb ? 'function' : 'null');

    // Add tracing headers if we have a req object
    if (req) {
      addTracingToOptions(options, req);
    }

    // Make the request
    try {
      if (cb) {
        console.log('[TRACE-DEBUG] Making request WITH callback');
        return request(options, cb);
      } else {
        console.log('[TRACE-DEBUG] Making request WITHOUT callback (streaming)');
        return request(options);
      }
    } catch (error) {
      console.error('[TRACE-ERROR] Error making request:', error.message);
      console.error('[TRACE-ERROR] Stack:', error.stack);
      throw error;
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
