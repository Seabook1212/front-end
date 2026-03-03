(function() {
  'use strict';

  var SERVICE_NAME = process.env.SERVICE_NAME || 'front-end';

  function getTimestamp() {
    return new Date().toISOString();
  }

  function getTraceContext(req) {
    var traceId = null;
    var spanId = null;

    if (req && req.headers) {
      traceId = req.headers['x-b3-traceid'] || null;
      spanId = req.headers['x-b3-spanid'] || null;
    }

    if ((!traceId || !spanId) && req && req.span && req.span.context) {
      try {
        var spanContext = req.span.context();
        if (!traceId && spanContext && typeof spanContext.toTraceId === 'function') {
          traceId = spanContext.toTraceId();
        }
        if (!spanId && spanContext && typeof spanContext.toSpanId === 'function') {
          spanId = spanContext.toSpanId();
        }
      } catch (e) {
        // Best effort only.
      }
    }

    return {
      traceId: traceId,
      spanId: spanId
    };
  }

  function getCallerInfo() {
    try {
      var stack = new Error().stack;
      var stackLines = stack.split('\n');

      for (var i = 0; i < stackLines.length; i++) {
        var line = stackLines[i];
        if (line.indexOf('logger.js') === -1 &&
            line.indexOf('at ') !== -1 &&
            line.indexOf('node_modules') === -1) {
          var match = line.match(/\(([^)]+)\)/);
          if (!match) {
            match = line.match(/at\s+(.+:\d+:\d+)/);
            if (match) {
              match[1] = match[1].trim();
            }
          }

          if (match) {
            var fullPath = match[1];
            var parts = fullPath.split(':');
            var filePath = parts[0];
            var lineNum = parts[1];
            var pathSegments = filePath.split('/');
            var frontEndIdx = -1;

            for (var j = 0; j < pathSegments.length; j++) {
              if (pathSegments[j] === 'front-end') {
                frontEndIdx = j;
                break;
              }
            }

            if (frontEndIdx !== -1 && frontEndIdx < pathSegments.length - 1) {
              var relevantParts = pathSegments.slice(frontEndIdx + 1);
              var lastPart = relevantParts[relevantParts.length - 1];
              if (lastPart && lastPart.endsWith('.js')) {
                relevantParts[relevantParts.length - 1] = lastPart.slice(0, -3);
              }

              var filteredParts = [];
              for (var k = 0; k < relevantParts.length; k++) {
                if (relevantParts[k] && relevantParts[k].length > 0) {
                  filteredParts.push(relevantParts[k]);
                }
              }

              if (filteredParts.length > 0) {
                return filteredParts.join('.') + ':' + lineNum;
              }
            }

            var fileName = pathSegments[pathSegments.length - 1];
            if (fileName && fileName.endsWith('.js')) {
              fileName = fileName.slice(0, -3);
            }

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
      // Best effort only.
    }

    return 'unknown';
  }

  function normalizeError(error) {
    if (!error) {
      return undefined;
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        type: error.type,
        status: error.status,
        statusCode: error.statusCode
      };
    }

    if (typeof error === 'object') {
      return error;
    }

    return {
      message: String(error)
    };
  }

  function mergeFields(entry, fields) {
    var reserved = {
      timestamp: true,
      level: true,
      service: true,
      message: true,
      trace_id: true,
      span_id: true,
      caller: true,
      error: true
    };

    if (!fields || typeof fields !== 'object') {
      return;
    }

    Object.keys(fields).forEach(function(key) {
      if (fields[key] !== undefined && !reserved[key]) {
        entry[key] = fields[key];
      }
    });
  }

  function buildEntry(level, req, message, fields, error, includeCallerInfo) {
    var context = getTraceContext(req);
    var entry = {
      timestamp: getTimestamp(),
      level: level,
      service: SERVICE_NAME,
      message: message
    };

    if (context.traceId) {
      entry.trace_id = context.traceId;
    }
    if (context.spanId) {
      entry.span_id = context.spanId;
    }
    if (includeCallerInfo) {
      entry.caller = getCallerInfo();
    }

    mergeFields(entry, fields);

    if (error) {
      entry.error = normalizeError(error);
    }

    return entry;
  }

  function writeEntry(level, entry) {
    var serialized = JSON.stringify(entry);

    if (level === 'ERROR' || level === 'FATAL') {
      console.error(serialized);
      return;
    }

    if (level === 'WARN') {
      console.warn(serialized);
      return;
    }

    console.log(serialized);
  }

  function parseMeta(meta, error) {
    if (meta instanceof Error && error === undefined) {
      return {
        fields: undefined,
        error: meta
      };
    }

    return {
      fields: meta,
      error: error
    };
  }

  function emit(level, req, message, meta, error, includeCallerInfo) {
    var parsed = parseMeta(meta, error);
    var entry = buildEntry(level, req, message, parsed.fields, parsed.error, includeCallerInfo);
    writeEntry(level, entry);
  }

  function attachErrorContext(error, fields) {
    if (!error || typeof error !== 'object' || !fields || typeof fields !== 'object') {
      return error;
    }

    error._logContext = Object.assign({}, error._logContext || {}, fields);
    return error;
  }

  function getErrorContext(error) {
    if (!error || typeof error !== 'object' || !error._logContext) {
      return {};
    }

    return Object.assign({}, error._logContext);
  }

  function markErrorLogged(error, fields) {
    if (!error || typeof error !== 'object') {
      return error;
    }

    attachErrorContext(error, fields);
    error._logged = true;
    return error;
  }

  function wasErrorLogged(error) {
    return !!(error && error._logged);
  }

  module.exports = {
    log: function(req, message, meta) {
      emit('INFO', req, message, meta, undefined, true);
    },

    info: function(req, message, meta) {
      emit('INFO', req, message, meta, undefined, true);
    },

    warn: function(req, message, meta, error) {
      emit('WARN', req, message, meta, error, true);
    },

    error: function(req, message, meta, error) {
      emit('ERROR', req, message, meta, error, true);
    },

    logWithoutContext: function(message, meta) {
      emit('INFO', null, message, meta, undefined, false);
    },

    warnWithoutContext: function(message, meta, error) {
      emit('WARN', null, message, meta, error, false);
    },

    errorWithoutContext: function(message, meta, error) {
      emit('ERROR', null, message, meta, error, false);
    },

    attachErrorContext: attachErrorContext,
    getErrorContext: getErrorContext,
    markErrorLogged: markErrorLogged,
    wasErrorLogged: wasErrorLogged
  };
}());
