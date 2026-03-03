(function (){
  'use strict';

  var session      = require("express-session"),
      RedisStore   = require('connect-redis').default,
      redis        = require('redis'),
      logger       = require('./helpers/logger');

  function classifyRedisError(err) {
    if (!err) {
      return 'redis_error';
    }

    if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
      return 'timeout';
    }
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      return 'dns';
    }
    if (err.code === 'ECONNREFUSED') {
      return 'connection_refused';
    }
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ECONNABORTED') {
      return 'connection';
    }

    return 'redis_error';
  }

  function redisLogFields(operation) {
    return {
      operation: operation,
      dependency: 'redis',
      target: (process.env.REDIS_HOST || "session-db") + ':' + (process.env.REDIS_PORT || 6379)
    };
  }

  var lastRedisErrorSignature = null;
  var lastRedisErrorAt = 0;

  function shouldLogRedisError(err) {
    var signature = (err && err.code ? err.code : 'unknown') + ':' + (err && err.message ? err.message : 'unknown');
    var now = Date.now();

    if (signature === lastRedisErrorSignature && (now - lastRedisErrorAt) < 30000) {
      return false;
    }

    lastRedisErrorSignature = signature;
    lastRedisErrorAt = now;
    return true;
  }

  // Create Redis client with connection details
  var redisClient = redis.createClient({
    socket: {
      host: process.env.REDIS_HOST || "session-db",
      port: process.env.REDIS_PORT || 6379,
      reconnectStrategy: function(retries) {
        // Unlimited retries with exponential backoff (capped at 30 seconds)
        return Math.min(retries * 100, 30000);
      }
    }
  });

  redisClient.on('error', function(err) {
    if (!shouldLogRedisError(err)) {
      return;
    }

    logger.errorWithoutContext('Redis client error', Object.assign({
      error_type: classifyRedisError(err)
    }, redisLogFields('redis.session')), err);
  });

  redisClient.on('ready', function() {
    logger.logWithoutContext('Redis client connected and ready', redisLogFields('redis.session'));
  });

  redisClient.on('end', function() {
    logger.warnWithoutContext('Redis client connection closed', Object.assign({
      error_type: 'connection_closed'
    }, redisLogFields('redis.session')));
  });

  redisClient.connect().catch(function(err) {
    logger.errorWithoutContext('Failed to connect to Redis', Object.assign({
      error_type: classifyRedisError(err)
    }, redisLogFields('redis.connect')), err);
  });

  module.exports = {
    session: {
      name: 'md.sid',
      secret: 'sooper secret',
      resave: false,
      saveUninitialized: true
    },

    session_redis: {
      store: new RedisStore({
        client: redisClient,
        prefix: 'sess:'
      }),
      name: 'md.sid',
      secret: 'sooper secret',
      resave: false,
      saveUninitialized: true
    }
  };
}());
