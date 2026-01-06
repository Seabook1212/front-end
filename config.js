(function (){
  'use strict';

  var session      = require("express-session"),
      RedisStore   = require('connect-redis').default,
      redis        = require('redis');

  // Create Redis client with connection details
  var redisClient = redis.createClient({
    socket: {
      host: process.env.REDIS_HOST || "session-db",
      port: process.env.REDIS_PORT || 6379,
      reconnectStrategy: function(retries) {
        if (retries > 10) {
          console.error('Redis retry limit exceeded');
          return new Error('Redis retry limit exceeded');
        }
        return Math.min(retries * 100, 3000);
      }
    }
  });

  redisClient.on('error', function(err) {
    console.error('Redis client error:', err);
  });

  redisClient.connect().catch(function(err) {
    console.error('Failed to connect to Redis:', err);
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
