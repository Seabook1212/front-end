(function () {
  'use strict';

  var async = require("async")
    , express = require("express")
    , request = require("request")
    , helpers = require("../../helpers")
    , endpoints = require("../endpoints")
    , app = express()

  // List items in cart for current logged in user.
  app.get("/cart", function (req, res, next) {
    console.log("Request received: " + req.url + ", " + req.query.custId);
    var custId = helpers.getCustomerId(req, app.get("env"));
    console.log("Customer ID: " + custId);
    request(endpoints.cartsUrl + "/" + custId + "/items", function (error, response, body) {
      if (error) {
        return next(error);
      }
      helpers.respondStatusBody(res, response.statusCode, body)
    });
  });

  // Delete cart
  app.delete("/cart", function (req, res, next) {
    var custId = helpers.getCustomerId(req, app.get("env"));
    console.log('Attempting to delete cart for user: ' + custId);
    var options = {
      uri: endpoints.cartsUrl + "/" + custId,
      method: 'DELETE'
    };
    request(options, function (error, response, body) {
      if (error) {
        return next(error);
      }
      console.log('User cart deleted with status: ' + response.statusCode);
      helpers.respondStatus(res, response.statusCode);
    });
  });

  // Delete item from cart
  app.delete("/cart/:id", async function (req, res, next) {
    if (req.params.id == null) {
      return next(new Error("Must pass id of item to delete"), 400);
    }

    console.log("Delete item from cart: " + req.url);

    var custId = helpers.getCustomerId(req, app.get("env"));

    if ((process.env.FAULTS_ENABLED === "true") &&
      (process.env.FAULT_FE_TYPEERROR_ENABLED === "true") &&
      ((req.get("X-Fault") || "").toUpperCase() === "FE-TE-01" || process.env.FAULTS_FE_TYPEERROR_ALWAYS === "true")) {

      console.log("Delete item from cart: " + req.url);

      // 模拟真实 bug：某些场景下 customerId 取不到（变成 undefined）
      custId = undefined;
      custId.trim();  // 故意触发 TypeError
    }

    if ((process.env.FAULTS_ENABLED === "true") &&
      (process.env.FAULT_FE_ERROR_ENABLED === "true") &&
      ((req.get("X-Fault") || "").toUpperCase() === "FE-ERR-01" || process.env.FAULTS_FE_ERROR_ALWAYS === "true")) {

      // 更像真实线上：这里不写“forced”，写一个业务语义错误
      const err = new Error("Upstream dependency failure while fetching cart items");
      err.code = "UPSTREAM_CARTS_FAILURE";   // 可选：方便你分类
      err.statusCode = 500;                 // 可选：如果你的 errorHandler 识别这个字段

      console.log("Delete item from cart: " + req.url);

      return next(err);
    }

    try {
      await injectSleepIfNeeded(req);
    } catch (e) {
      return next(e);
    }

    var options = {
      uri: endpoints.cartsUrl + "/" + custId + "/items/" + req.params.id.toString(),
      method: 'DELETE'
    };
    request(options, function (error, response, body) {
      if (error) {
        return next(error);
      }
      console.log('Item deleted with status: ' + response.statusCode);
      helpers.respondStatus(res, response.statusCode);
    });
  });

  // Add new item to cart
  app.post("/cart", function (req, res, next) {
    console.log("Attempting to add to cart: " + JSON.stringify(req.body));

    if (req.body.id == null) {
      next(new Error("Must pass id of item to add"), 400);
      return;
    }

    var custId = helpers.getCustomerId(req, app.get("env"));

    async.waterfall([
      function (callback) {
        request(endpoints.catalogueUrl + "/catalogue/" + req.body.id.toString(), function (error, response, body) {
          console.log(body);
          callback(error, JSON.parse(body));
        });
      },
      function (item, callback) {
        var options = {
          uri: endpoints.cartsUrl + "/" + custId + "/items",
          method: 'POST',
          json: true,
          body: { itemId: item.id, unitPrice: item.price }
        };
        console.log("POST to carts: " + options.uri + " body: " + JSON.stringify(options.body));
        request(options, function (error, response, body) {
          if (error) {
            callback(error)
            return;
          }
          callback(null, response.statusCode);
        });
      }
    ], function (err, statusCode) {
      if (err) {
        return next(err);
      }
      if (statusCode != 201) {
        return next(new Error("Unable to add to cart. Status code: " + statusCode))
      }
      helpers.respondStatus(res, statusCode);
    });
  });

  // Update cart item
  app.post("/cart/update", function (req, res, next) {
    console.log("Attempting to update cart item: " + JSON.stringify(req.body));

    if (req.body.id == null) {
      next(new Error("Must pass id of item to update"), 400);
      return;
    }
    if (req.body.quantity == null) {
      next(new Error("Must pass quantity to update"), 400);
      return;
    }
    var custId = helpers.getCustomerId(req, app.get("env"));

    async.waterfall([
      function (callback) {
        request(endpoints.catalogueUrl + "/catalogue/" + req.body.id.toString(), function (error, response, body) {
          console.log(body);
          callback(error, JSON.parse(body));
        });
      },
      function (item, callback) {
        var options = {
          uri: endpoints.cartsUrl + "/" + custId + "/items",
          method: 'PATCH',
          json: true,
          body: { itemId: item.id, quantity: parseInt(req.body.quantity), unitPrice: item.price }
        };
        console.log("PATCH to carts: " + options.uri + " body: " + JSON.stringify(options.body));
        request(options, function (error, response, body) {
          if (error) {
            callback(error)
            return;
          }
          callback(null, response.statusCode);
        });
      }
    ], function (err, statusCode) {
      if (err) {
        return next(err);
      }
      if (statusCode != 202) {
        return next(new Error("Unable to add to cart. Status code: " + statusCode))
      }
      helpers.respondStatus(res, statusCode);
    });
  });

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * FE-SLEEP-01: tail latency injection (10% probability)
   * return true if slept, false otherwise
   */
  async function injectSleepIfNeeded(req) {
    const faultsEnabled = process.env.FAULTS_ENABLED === "true";
    const sleepEnabled = process.env.FAULT_FE_SLEEP_ENABLED === "true";
    if (!faultsEnabled || !sleepEnabled) {
      return false;
    }

    // 可选：是否必须带 header 才触发
    const requireHeader = process.env.FAULT_FE_SLEEP_REQUIRE_HEADER === "true";
    if (requireHeader && (req.get("X-Fault") || "").toUpperCase() !== "FE-SLEEP-01") {
      return false;
    }

    const pct = Number(process.env.FAULT_FE_SLEEP_PCT || 10);      // 默认 10%
    const delay = Number(process.env.FAULT_FE_SLEEP_MS || 2000);   // 默认 2000ms

    if (Math.random() < pct / 100) {
      console.log(
        "FAULT_INJECTED fault_id=FE-SLEEP-01 fault_type=tail_latency delay_ms=%d path=%s",
        delay, req.path
      );
      await sleep(delay);
      return true;
    }

    return false;
  }


  module.exports = app;
}());
