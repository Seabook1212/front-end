(function (){
  'use strict';
  const apiRoutes = ['cart', 'catalogue', 'orders', 'user'];
  var express = require("express")
    , client  = require('prom-client')
    , app     = express()

  const metric = {
    http: {
      requests: {
        duration: new client.Histogram({
          name: 'http_request_duration_seconds',
          help: 'request duration in seconds',
          labelNames: ['service', 'method', 'path', 'status_code']
        }),
      }
    }
  }

  function s(start) {
    var diff = process.hrtime(start);
    return (diff[0] * 1e9 + diff[1]) / 1000000000;
  }

  function observe(method, path, statusCode, start) {
    var route = path.toLowerCase();
    if (route !== '/metrics' && route !== '/metrics/') {
        var duration = s(start);
        var method = method.toLowerCase();
        metric.http.requests.duration.labels('front-end', method, route, statusCode).observe(duration);
    }
  };

  function middleware(request, response, done) {
    var start = process.hrtime();

    response.on('finish', function() {
      // Only log API routes, and only record the backend service name (no unique identifiers)
      var model = request.path.split('/')[1];
      if (apiRoutes.indexOf(model) !== -1) {
        observe(request.method, model, response.statusCode, start);
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
