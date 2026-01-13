(function() {
  'use strict';

  var SERVICE_NAME = process.env.SERVICE_NAME || 'front-end';

  /**
   * Get current timestamp in ISO format
   */
  function getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Extract trace ID and span ID from request headers
   */
  function getTraceContext(req) {
    if (!req || !req.headers) {
      return { traceId: null, spanId: null };
    }

    var traceId = req.headers['x-b3-traceid'] || null;
    var spanId = req.headers['x-b3-spanid'] || null;

    return { traceId: traceId, spanId: spanId };
  }

  /**
   * Get the caller's file path in Java-style package format
   */
  function getCallerInfo() {
    try {
      var stack = new Error().stack;
      var stackLines = stack.split('\n');

      // Find the first line that's not from logger.js
      for (var i = 0; i < stackLines.length; i++) {
        var line = stackLines[i];
        if (line.indexOf('logger.js') === -1 &&
            line.indexOf('at ') !== -1 &&
            line.indexOf('node_modules') === -1) {

          // Extract file path and line number
          // Format: "at functionName (/path/to/file.js:line:col)"
          var match = line.match(/\(([^)]+)\)/);
          if (!match) {
            // Sometimes it's "at /path/to/file.js:line:col" without parentheses
            match = line.match(/at\s+(.+:\d+:\d+)/);
            if (match) {
              match[1] = match[1].trim();
            }
          }

          if (match) {
            var fullPath = match[1];

            // Extract path components
            var parts = fullPath.split(':');
            var filePath = parts[0]; // /Users/user/project/front-end/api/cart/index.js
            var lineNum = parts[1];   // 123

            // Convert file path to Java-style package notation
            // Find 'front-end' in path and take everything after it
            var pathSegments = filePath.split('/');
            var frontEndIdx = -1;

            // Find the 'front-end' directory index
            for (var j = 0; j < pathSegments.length; j++) {
              if (pathSegments[j] === 'front-end') {
                frontEndIdx = j;
                break;
              }
            }

            if (frontEndIdx !== -1 && frontEndIdx < pathSegments.length - 1) {
              // Get segments after 'front-end'
              var relevantParts = pathSegments.slice(frontEndIdx + 1);

              // Remove .js extension from last part
              var lastPart = relevantParts[relevantParts.length - 1];
              if (lastPart && lastPart.endsWith('.js')) {
                relevantParts[relevantParts.length - 1] = lastPart.slice(0, -3);
              }

              // Filter out empty segments and convert to Java-style: api.cart.index
              var filteredParts = [];
              for (var k = 0; k < relevantParts.length; k++) {
                if (relevantParts[k] && relevantParts[k].length > 0) {
                  filteredParts.push(relevantParts[k]);
                }
              }

              if (filteredParts.length > 0) {
                var javaStyle = filteredParts.join('.');
                return javaStyle + ':' + lineNum;
              }
            }

            // Fallback: try to extract at least some path info
            // Look for common directories like api, helpers, etc.
            var fileName = pathSegments[pathSegments.length - 1];
            if (fileName && fileName.endsWith('.js')) {
              fileName = fileName.slice(0, -3);
            }

            // Try to get parent directory for better context
            if (pathSegments.length >= 2) {
              var parentDir = pathSegments[pathSegments.length - 2];
              if (parentDir && parentDir !== 'front-end') {
                return parentDir + '.' + fileName + ':' + lineNum;
              }
            }

            return fileName + ':' + lineNum;
          }
        }
      }
    } catch (e) {
      // Silently fail - caller info is nice to have but not critical
    }
    return 'unknown';
  }

  /**
   * Format log message with timestamp, trace context, and caller info
   * Format: "2026-01-13T08:57:30.719Z  INFO [front-end,traceId:xxx,spanId:yyy] --- [file.js:123] message"
   */
  function formatLogMessage(level, req, message, includeCallerInfo) {
    var timestamp = getTimestamp();
    var context = getTraceContext(req);
    var callerInfo = includeCallerInfo ? getCallerInfo() : '';

    var traceInfo;
    if (context.traceId && context.spanId) {
      traceInfo = '[' + SERVICE_NAME + ',traceId:' + context.traceId + ',spanId:' + context.spanId + ']';
    } else if (context.traceId) {
      traceInfo = '[' + SERVICE_NAME + ',traceId:' + context.traceId + ']';
    } else {
      traceInfo = '[' + SERVICE_NAME + ']';
    }

    var callerPart = callerInfo ? ' --- [' + callerInfo + ']' : '';

    return timestamp + '  ' + level + ' ' + traceInfo + callerPart + ' : ' + message;
  }

  /**
   * Format log message without trace context (for startup logs)
   */
  function formatLogMessageWithoutContext(level, message) {
    var timestamp = getTimestamp();
    return timestamp + '  ' + level + ' [' + SERVICE_NAME + '] : ' + message;
  }

  /**
   * Logger wrapper that includes trace context, timestamp, and caller info
   */
  var logger = {
    log: function(req, message) {
      console.log(formatLogMessage('INFO', req, message, true));
    },

    info: function(req, message) {
      console.log(formatLogMessage('INFO', req, message, true));
    },

    error: function(req, message, error) {
      var formattedMsg = formatLogMessage('ERROR', req, message, true);
      if (error) {
        console.error(formattedMsg);
        console.error('Error details:', error);
      } else {
        console.error(formattedMsg);
      }
    },

    warn: function(req, message) {
      console.warn(formatLogMessage('WARN', req, message, true));
    },

    // For logs where req is not available (startup, etc)
    logWithoutContext: function(message) {
      console.log(formatLogMessageWithoutContext('INFO', message));
    }
  };

  module.exports = logger;
}());
