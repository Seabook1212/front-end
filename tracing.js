(function() {
  'use strict';

  var CLSContext = require('zipkin-context-cls');
  var zipkin = require('zipkin');
  var HttpLogger = require('zipkin-transport-http').HttpLogger;
  var ZipkinJavascriptOpentracing = require('zipkin-javascript-opentracing');

  // Configure the Zipkin endpoint
  var ZIPKIN_HOST = process.env.ZIPKIN_HOST || process.env.zipkin_host || 'jaeger-collector.observability.svc.cluster.local';
  var ZIPKIN_PORT = process.env.ZIPKIN_PORT || '9411';
  var ZIPKIN_BASE_URL = process.env.ZIPKIN_BASE_URL || 'http://' + ZIPKIN_HOST + ':' + ZIPKIN_PORT;
  var SERVICE_NAME = process.env.SERVICE_NAME || 'front-end.sock-shop';

  // Create a CLS context (required for zipkin)
  var ctxImpl = new CLSContext('zipkin');

  // Create the recorder with HTTP logger
  var recorder = new zipkin.BatchRecorder({
    logger: new HttpLogger({
      endpoint: ZIPKIN_BASE_URL + '/api/v2/spans',
      jsonEncoder: zipkin.jsonEncoder.JSON_V2
    })
  });

  // Create the Zipkin tracer
  var zipkinTracer = new zipkin.Tracer({
    ctxImpl: ctxImpl,
    recorder: recorder,
    localServiceName: SERVICE_NAME,
    sampler: new zipkin.sampler.CountingSampler(1.0) // 100% sampling
  });

  // Wrap with OpenTracing API
  var tracer = new ZipkinJavascriptOpentracing({
    tracer: zipkinTracer,
    recorder: recorder,
    serviceName: SERVICE_NAME,
    kind: 'server'
  });

  // Set as global tracer
  var opentracing = require('opentracing');
  opentracing.initGlobalTracer(tracer);

  console.log('Zipkin tracing initialized for service:', SERVICE_NAME);
  console.log('Zipkin endpoint:', ZIPKIN_BASE_URL + '/api/v2/spans');

  // Gracefully shut down the tracer on process exit
  process.on('SIGTERM', function() {
    console.log('Zipkin tracer closing');
    process.exit(0);
  });

  module.exports = tracer;
}());
