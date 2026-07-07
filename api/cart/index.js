(function () {
  'use strict';

  var async = require("async")
    , express = require("express")
    , request = require("../../helpers/traced-request")
    , helpers = require("../../helpers")
    , endpoints = require("../endpoints")
    , logger = require("../../helpers/logger")
    , app = express()

  function createValidationError(message) {
    var err = new Error(message);
    err.error_type = 'validation';
    return err;
  }

  function createApplicationError(message, fields) {
    return logger.attachErrorContext(new Error(message), fields);
  }

  // List items in cart for current logged in user.
  app.get("/cart", function (req, res, next) {
    logger.log(req, "Request received: " + req.url + ", " + req.query.custId);
    var custId = helpers.getCustomerId(req, app.get("env"));
    logger.log(req, "Customer ID: " + custId);
    request(endpoints.cartsUrl + "/" + custId + "/items", req, function (error, response, body) {
      if (error) {
        return next(error);
      }
      helpers.respondStatusBody(res, response.statusCode, body)
    });
  });

  // Delete cart
  app.delete("/cart", function (req, res, next) {
    var custId = helpers.getCustomerId(req, app.get("env"));
    logger.log(req, 'Attempting to delete cart for user: ' + custId);
    var options = {
      uri: endpoints.cartsUrl + "/" + custId,
      method: 'DELETE'
    };
    request(options, req, function (error, response, body) {
      if (error) {
        return next(error);
      }
      logger.log(req, 'User cart deleted with status: ' + response.statusCode);
      helpers.respondStatus(res, response.statusCode);
    });
  });

  // Delete item from cart
  app.delete("/cart/:id", async function (req, res, next) {
    if (req.params.id == null) {
      return next(createValidationError("Must pass id of item to delete"));
    }

    logger.log(req, "Delete item from cart: " + req.url);

    var custId = helpers.getCustomerId(req, app.get("env"));

    var options = {
      uri: endpoints.cartsUrl + "/" + custId + "/items/" + req.params.id.toString(),
      method: 'DELETE'
    };
    request(options, req, function (error, response, body) {
      if (error) {
        return next(error);
      }
      logger.log(req, 'Item deleted with status: ' + response.statusCode);
      helpers.respondStatus(res, response.statusCode);
    });
  });

  // Add new item to cart
  app.post("/cart", function (req, res, next) {
    logger.log(req, "Attempting to add to cart");

    if (req.body.id == null) {
      next(createValidationError("Must pass id of item to add"));
      return;
    }

    var custId = helpers.getCustomerId(req, app.get("env"));

    async.waterfall([
      function (callback) {
        request(endpoints.catalogueUrl + "/catalogue/" + req.body.id.toString(), req, function (error, response, body) {
          var item;

          if (error) {
            callback(error);
            return;
          }

          try {
            item = (typeof body === "string") ? JSON.parse(body) : body;
          } catch (parseError) {
            callback(logger.attachErrorContext(parseError, {
              operation: 'parse_downstream_response',
              dependency: 'catalogue',
              target: endpoints.catalogueUrl + "/catalogue/" + req.body.id.toString(),
              error_type: 'invalid_response'
            }));
            return;
          }

          callback(null, item);
        });
      },
      function (item, callback) {
        var options = {
          uri: endpoints.cartsUrl + "/" + custId + "/items",
          method: 'POST',
          json: true,
          body: { itemId: item.id, unitPrice: item.price }
        };
        request(options, req, function (error, response, body) {
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
        return next(createApplicationError("Unable to add to cart. Status code: " + statusCode, {
          operation: 'cart.add',
          dependency: 'carts',
          target: endpoints.cartsUrl + "/" + custId + "/items",
          error_type: 'unexpected_status',
          status_code: statusCode
        }));
      }
      helpers.respondStatus(res, statusCode);
    });
  });

  // Update cart item
  app.post("/cart/update", function (req, res, next) {
    logger.log(req, "Attempting to update cart item");

    if (req.body.id == null) {
      next(createValidationError("Must pass id of item to update"));
      return;
    }
    if (req.body.quantity == null) {
      next(createValidationError("Must pass quantity to update"));
      return;
    }
    var custId = helpers.getCustomerId(req, app.get("env"));

    async.waterfall([
      function (callback) {
        request(endpoints.catalogueUrl + "/catalogue/" + req.body.id.toString(), req, function (error, response, body) {
          var item;

          if (error) {
            callback(error);
            return;
          }

          try {
            item = (typeof body === "string") ? JSON.parse(body) : body;
          } catch (parseError) {
            callback(logger.attachErrorContext(parseError, {
              operation: 'parse_downstream_response',
              dependency: 'catalogue',
              target: endpoints.catalogueUrl + "/catalogue/" + req.body.id.toString(),
              error_type: 'invalid_response'
            }));
            return;
          }

          callback(null, item);
        });
      },
      function (item, callback) {
        var options = {
          uri: endpoints.cartsUrl + "/" + custId + "/items",
          method: 'PATCH',
          json: true,
          body: { itemId: item.id, quantity: parseInt(req.body.quantity), unitPrice: item.price }
        };
        request(options, req, function (error, response, body) {
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
        return next(createApplicationError("Unable to add to cart. Status code: " + statusCode, {
          operation: 'cart.update',
          dependency: 'carts',
          target: endpoints.cartsUrl + "/" + custId + "/items",
          error_type: 'unexpected_status',
          status_code: statusCode
        }));
      }
      helpers.respondStatus(res, statusCode);
    });
  });

  module.exports = app;
}());
