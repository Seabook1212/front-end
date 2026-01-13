// Initialize tracing first before any other imports
require('./tracing');

var request         = require("request")
  , express         = require("express")
  , morgan          = require("morgan")
  , path            = require("path")
  , bodyParser      = require("body-parser")
  , async           = require("async")
  , cookieParser    = require("cookie-parser")
  , session         = require("express-session")
  , config          = require("./config")
  , helpers         = require("./helpers")
  , cart            = require("./api/cart")
  , catalogue       = require("./api/catalogue")
  , orders          = require("./api/orders")
  , user            = require("./api/user")
  , metrics         = require("./api/metrics")
  , instrumentation = require("./instrumentation")
  , logger          = require("./helpers/logger")
  , app             = express()


app.use(helpers.rewriteSlash);
app.use(instrumentation.tracingMiddleware);
app.use(metrics);
app.use(express.static("public"));
if(process.env.SESSION_REDIS) {
    logger.logWithoutContext('Using the redis based session manager');
    app.use(session(config.session_redis));
}
else {
    logger.logWithoutContext('Using local session manager');
    app.use(session(config.session));
}

app.use(bodyParser.json());
app.use(cookieParser());
app.use(helpers.sessionMiddleware);
// Configure Morgan to skip logging for health, metrics, and static assets
// Add custom tokens for timestamp and trace context
morgan.token('timestamp', function() {
  return new Date().toISOString();
});

morgan.token('trace-context', function(req) {
  var serviceName = process.env.SERVICE_NAME || 'front-end';
  var traceId = req.headers['x-b3-traceid'] || '';
  var spanId = req.headers['x-b3-spanid'] || '';
  if (traceId && spanId) {
    return '[' + serviceName + ',traceId:' + traceId + ',spanId:' + spanId + ']';
  }
  return '[' + serviceName + ']';
});

// Custom Morgan format with timestamp and trace context (similar to Java logging)
// Format: "timestamp  INFO [service,traceId:xxx,spanId:yyy] --- [morgan.middleware] : method url status response-time"
app.use(morgan(":timestamp  INFO :trace-context --- [morgan.middleware] : :method :url :status :response-time ms", {
  skip: function (req) {
    return req.path === '/health' ||
           req.path === '/metrics';
  }
}));

var domain = "";
process.argv.forEach(function (val, index, array) {
  var arg = val.split("=");
  if (arg.length > 1) {
    if (arg[0] == "--domain") {
      domain = arg[1];
      logger.logWithoutContext("Setting domain to: " + domain);
    }
  }
});

/* Mount API endpoints */
app.use(cart);
app.use(catalogue);
app.use(orders);
app.use(user);

/* Health check endpoint */
app.get("/health", function(req, res) {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.use(helpers.errorHandler);

var server = app.listen(process.env.PORT || 8079, function () {
  var port = server.address().port;
  logger.logWithoutContext("App now running in " + app.get("env") + " mode on port " + port);
});
