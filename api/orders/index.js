(function (){
  'use strict';

  var async     = require("async")
    , express   = require("express")
    , request   = require("../../helpers/traced-request")
    , endpoints = require("../endpoints")
    , helpers   = require("../../helpers")
    , logger    = require("../../helpers/logger")
    , app       = express()

  function createApplicationError(message, fields) {
    return logger.attachErrorContext(new Error(message), fields);
  }

  app.get("/orders", function (req, res, next) {
    var logged_in = req.cookies.logged_in;
    if (!logged_in) {
      return helpers.respondStatusBody(res, 401, JSON.stringify({ error: "User not logged in." }));
    }

    var custId = req.session.customerId;
    async.waterfall([
        function (callback) {
          var ordersUrl = endpoints.ordersUrl + "/orders/search/customerId?sort=date&custId=" + custId;
          request(ordersUrl, req, function (error, response, body) {
            if (error) {
              return callback(error);
            }
            // console.log("Received response: " + JSON.stringify(body));
            if (response.statusCode == 404) {
              logger.log(req, "No orders found for user: " + custId);
              return callback(null, []);
            }
            // 非 2xx：不要 JSON.parse，更不要崩；降级为空（或者 callback(new Error(...))）
            if (!response || response.statusCode < 200 || response.statusCode >= 300) {
              logger.log(req, "Orders service returned status: " + (response && response.statusCode));
              return callback(null, []); // 降级：返回空列表，前端页面还能活
            }

                      // body 可能是对象，也可能是字符串
            let jsonBody = body;
            try {
              if (typeof body === "string") jsonBody = JSON.parse(body);
            } catch (e) {
              logger.error(req, 'Invalid JSON from orders service', {
                operation: 'orders.list',
                dependency: 'orders',
                target: ordersUrl,
                error_type: 'invalid_response'
              }, e);
              return callback(null, []);
            }
            const orders =
            (jsonBody &&
              jsonBody._embedded &&
              Array.isArray(jsonBody._embedded.customerOrders) &&
              jsonBody._embedded.customerOrders) ||
            [];

            // callback(null, JSON.parse(body)._embedded.customerOrders);
            return callback(null, orders);
          });
        }
    ],
    function (err, result) {
      if (err) {
        return next(err);
      }
      helpers.respondStatusBody(res, 201, JSON.stringify(result));
    });
  });

  app.get("/orders/*", function (req, res, next) {
    var url = endpoints.ordersUrl + req.url.toString();
    request.get(url, {}, req)
      .on('error', function(error) { next(error); })
      .pipe(res);
  });

  app.post("/orders", function(req, res, next) {
    var logged_in = req.cookies.logged_in;
    if (!logged_in) {
      return helpers.respondStatusBody(res, 401, JSON.stringify({ error: "User not logged in." }));
    }

    var custId = req.session.customerId;

    async.waterfall([
        function (callback) {
          var customerUrl = endpoints.customersUrl + "/" + custId;

          request(customerUrl, req, function (error, response, body) {
            if (error) {
              return callback(error);
            }

            // console.log("[POST /orders] Step 1: Response status code:", response ? response.statusCode : 'no response');
            // console.log("[POST /orders] Step 1: Response body:", JSON.stringify(body));

            if (body && body.status_code === 500) {
              return callback(createApplicationError("Customer service returned 500", {
                operation: 'orders.create',
                dependency: 'user',
                target: customerUrl,
                error_type: 'downstream_5xx'
              }));
            }

            if (!response || response.statusCode < 200 || response.statusCode >= 300) {
              return callback(createApplicationError("customers service status " + (response && response.statusCode), {
                operation: 'orders.create',
                dependency: 'user',
                target: customerUrl,
                error_type: 'unexpected_status',
                status_code: response && response.statusCode
              }));
            }

            let jsonBody;
            try {
              jsonBody = (typeof body === "string") ? JSON.parse(body) : body;
            } catch (e) {
              return callback(logger.attachErrorContext(new Error("customers invalid json: " + e.message), {
                operation: 'parse_downstream_response',
                dependency: 'user',
                target: customerUrl,
                error_type: 'invalid_response'
              }));
            }

            if (!jsonBody._links) {
              return callback(createApplicationError("Customer response missing _links", {
                operation: 'orders.create',
                dependency: 'user',
                target: customerUrl,
                error_type: 'invalid_response'
              }));
            }

            if (!jsonBody._links.customer || !jsonBody._links.customer.href) {
              return callback(createApplicationError("Customer response missing customer link", {
                operation: 'orders.create',
                dependency: 'user',
                target: customerUrl,
                error_type: 'invalid_response'
              }));
            }

            if (!jsonBody._links.addresses || !jsonBody._links.addresses.href) {
              return callback(createApplicationError("Customer response missing addresses link", {
                operation: 'orders.create',
                dependency: 'user',
                target: customerUrl,
                error_type: 'invalid_response'
              }));
            }

            if (!jsonBody._links.cards || !jsonBody._links.cards.href) {
              return callback(createApplicationError("Customer response missing cards link", {
                operation: 'orders.create',
                dependency: 'user',
                target: customerUrl,
                error_type: 'invalid_response'
              }));
            }

            var customerlink = jsonBody._links.customer.href;
            var addressLink = jsonBody._links.addresses.href;
            var cardLink = jsonBody._links.cards.href;

            var order = {
              "customer": customerlink,
              "address": null,
              "card": null,
              "items": endpoints.cartsUrl + "/" + custId + "/items"
            };

            callback(null, order, addressLink, cardLink);
          });
        },
        function (order, addressLink, cardLink, callback) {
          async.parallel([
              function (callback) {
                if (!addressLink) {
                  return callback(createApplicationError("Address link is undefined", {
                    operation: 'orders.create',
                    dependency: 'user',
                    target: endpoints.customersUrl + "/" + custId,
                    error_type: 'invalid_response'
                  }));
                }

                request.get(addressLink, {}, req, function (error, response, body) {
                  if (error) {
                    return callback(error);
                  }

                  // console.log("[POST /orders] Step 2a: Response status:", response ? response.statusCode : 'no response');
                  // console.log("[POST /orders] Step 2a: Response body:", JSON.stringify(body));

                  if (!body) {
                    return callback();
                  }

                  try {
                    var jsonBody = (typeof body === "string") ? JSON.parse(body) : body;

                    if (jsonBody.status_code !== 500 && jsonBody._embedded && jsonBody._embedded.address && jsonBody._embedded.address[0] != null) {
                      order.address = jsonBody._embedded.address[0]._links.self.href;
                    }
                  } catch (e) {
                    return callback(logger.attachErrorContext(e, {
                      operation: 'parse_downstream_response',
                      dependency: 'user',
                      target: addressLink,
                      error_type: 'invalid_response'
                    }));
                  }

                  callback();
                });
              },
              function (callback) {
                if (!cardLink) {
                  return callback(createApplicationError("Card link is undefined", {
                    operation: 'orders.create',
                    dependency: 'user',
                    target: endpoints.customersUrl + "/" + custId,
                    error_type: 'invalid_response'
                  }));
                }

                request.get(cardLink, {}, req, function (error, response, body) {
                  if (error) {
                    return callback(error);
                  }

                  // console.log("[POST /orders] Step 2b: Response status:", response ? response.statusCode : 'no response');
                  // console.log("[POST /orders] Step 2b: Response body:", JSON.stringify(body));

                  if (!body) {
                    return callback();
                  }

                  try {
                    var jsonBody = (typeof body === "string") ? JSON.parse(body) : body;

                    if (jsonBody.status_code !== 500 && jsonBody._embedded && jsonBody._embedded.card && jsonBody._embedded.card[0] != null) {
                      order.card = jsonBody._embedded.card[0]._links.self.href;
                    }
                  } catch (e) {
                    return callback(logger.attachErrorContext(e, {
                      operation: 'parse_downstream_response',
                      dependency: 'user',
                      target: cardLink,
                      error_type: 'invalid_response'
                    }));
                  }

                  callback();
                });
              }
          ], function (err, result) {
            if (err) {
              return callback(err);
            }
            callback(null, order);
          });
        },
        function (order, callback) {
          var options = {
            uri: endpoints.ordersUrl + '/orders',
            method: 'POST',
            json: true,
            body: order
          };

          request(options, req, function (error, response, body) {
            if (error) {
              return callback(error);
            }

            // console.log("[POST /orders] Step 3: Response status code:", response ? response.statusCode : 'no response');
            // console.log("[POST /orders] Step 3: Response headers:", response ? JSON.stringify(response.headers) : 'no headers');
            // console.log("[POST /orders] Step 3: Response body:", JSON.stringify(body));

            if (!response) {
              return callback(createApplicationError("No response from orders service", {
                operation: 'orders.create',
                dependency: 'orders',
                target: options.uri,
                error_type: 'no_response'
              }));
            }

            callback(null, response.statusCode, body);
          });
        }
    ],
    function (err, status, result) {
      if (err) {
        return next(err);
      }

      // Handle empty response body from orders service
      var responseBody = result !== undefined ? JSON.stringify(result) : JSON.stringify({ message: "Order created successfully" });
      helpers.respondStatusBody(res, status, responseBody);
    });
  });

  module.exports = app;
}());
