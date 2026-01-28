(function (){
  'use strict';

  var session      = require("express-session"),
      RedisStore   = require('connect-redis').default,
      redis        = require('redis'),
      logger       = require('./helpers/logger');

  // Create Redis client with connection details
  var redisClient = redis.createClient({
    socket: {
      host: process.env.REDIS_HOST || "session-db",
      port: process.env.REDIS_PORT || 6379,
      reconnectStrategy: function(retries) {
        // Unlimited retries with exponential backoff (capped at 30 seconds)
        var delay = Math.min(retries * 100, 30000);
        logger.logWithoutContext('Redis reconnection attempt #' + retries + ', waiting ' + delay + 'ms');
        return delay;
      }
    }
  });

  redisClient.on('error', function(err) {
    logger.logWithoutContext('Redis client error: ' + err.message);
  });

  redisClient.on('reconnecting', function() {
    logger.logWithoutContext('Redis client reconnecting...');
  });

  redisClient.on('ready', function() {
    logger.logWithoutContext('Redis client connected and ready');
  });

  redisClient.on('end', function() {
    logger.logWithoutContext('Redis client connection closed');
  });

  redisClient.connect().catch(function(err) {
    logger.logWithoutContext('Failed to connect to Redis: ' + err.message);
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
