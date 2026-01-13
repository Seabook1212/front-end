(function (){
  'use strict';

  var async     = require("async")
    , express   = require("express")
    , request   = require("../../helpers/traced-request")
    , endpoints = require("../endpoints")
    , helpers   = require("../../helpers")
    , logger    = require("../../helpers/logger")
    , app       = express()

  app.get("/orders", function (req, res, next) {
    logger.log(req, "Request received with body: " + JSON.stringify(req.body));
    var logged_in = req.cookies.logged_in;
    if (!logged_in) {
      // throw new Error("User not logged in.");
      // return
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
              // body 不是合法 JSON：降级为空
              logger.error(req, "Invalid JSON from orders: " + e.message);
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
    request.get(url, {}, req).pipe(res);
  });

  app.post("/orders", function(req, res, next) {
    // console.log("[POST /orders] Request received with body:", JSON.stringify(req.body));
    // console.log("[POST /orders] Session ID:", req.session ? req.session.id : 'no session');
    // console.log("[POST /orders] Cookies:", JSON.stringify(req.cookies));

    var logged_in = req.cookies.logged_in;
    if (!logged_in) {
      logger.error(req, "[POST /orders] ERROR: User not logged in");
      return helpers.respondStatusBody(res, 401, JSON.stringify({ error: "User not logged in." }));
    }

    var custId = req.session.customerId;
    logger.log(req, "[POST /orders] Customer ID: " + custId);

    async.waterfall([
        function (callback) {
          var customerUrl = endpoints.customersUrl + "/" + custId;
          logger.log(req, "[POST /orders] Step 1: Fetching customer data from: " + customerUrl);

          request(customerUrl, req, function (error, response, body) {
            if (error) {
              logger.error(req, "[POST /orders] ERROR in Step 1: Request error: " + error.message);
              return callback(error);
            }

            // console.log("[POST /orders] Step 1: Response status code:", response ? response.statusCode : 'no response');
            // console.log("[POST /orders] Step 1: Response body:", JSON.stringify(body));

            if (body && body.status_code === 500) {
              logger.error(req, "[POST /orders] ERROR in Step 1: Body status_code is 500");
              return callback(new Error("Customer service returned 500"));
            }

            // 非 2xx：直接报错或降级
            if (!response || response.statusCode < 200 || response.statusCode >= 300) {
              logger.error(req, "[POST /orders] ERROR in Step 1: Non-2xx status code: " + (response && response.statusCode));
              return callback(new Error("customers service status " + (response && response.statusCode)));
            }

            // Parse JSON body
            let jsonBody;
            try {
              jsonBody = (typeof body === "string") ? JSON.parse(body) : body;
              // console.log("[POST /orders] Step 1: Parsed customer data:", JSON.stringify(jsonBody));
            } catch (e) {
              logger.error(req, "[POST /orders] ERROR in Step 1: Invalid JSON: " + e.message);
              return callback(new Error("customers invalid json: " + e.message));
            }

            // Validate _links structure
            if (!jsonBody._links) {
              logger.error(req, "[POST /orders] ERROR in Step 1: Missing _links in customer response");
              return callback(new Error("Customer response missing _links"));
            }

            if (!jsonBody._links.customer || !jsonBody._links.customer.href) {
              logger.error(req, "[POST /orders] ERROR in Step 1: Missing customer link");
              return callback(new Error("Customer response missing customer link"));
            }

            if (!jsonBody._links.addresses || !jsonBody._links.addresses.href) {
              logger.error(req, "[POST /orders] ERROR in Step 1: Missing addresses link");
              return callback(new Error("Customer response missing addresses link"));
            }

            if (!jsonBody._links.cards || !jsonBody._links.cards.href) {
              logger.error(req, "[POST /orders] ERROR in Step 1: Missing cards link");
              return callback(new Error("Customer response missing cards link"));
            }

            var customerlink = jsonBody._links.customer.href;
            var addressLink = jsonBody._links.addresses.href;
            var cardLink = jsonBody._links.cards.href;

            // console.log("[POST /orders] Step 1: Extracted links:");
            // console.log("  - Customer link:", customerlink);
            // console.log("  - Address link:", addressLink);
            // console.log("  - Card link:", cardLink);

            var order = {
              "customer": customerlink,
              "address": null,
              "card": null,
              "items": endpoints.cartsUrl + "/" + custId + "/items"
            };

            // console.log("[POST /orders] Step 1: Created order object:", JSON.stringify(order));
            callback(null, order, addressLink, cardLink);
          });
        },
        function (order, addressLink, cardLink, callback) {
          logger.log(req, "[POST /orders] Step 2: Fetching address and card in parallel");

          async.parallel([
              function (callback) {
                // console.log("[POST /orders] Step 2a: Fetching address from:", addressLink);

                if (!addressLink) {
                  logger.error(req, "[POST /orders] ERROR in Step 2a: addressLink is undefined/null");
                  return callback(new Error("Address link is undefined"));
                }

                request.get(addressLink, {}, req, function (error, response, body) {
                  if (error) {
                    logger.error(req, "[POST /orders] ERROR in Step 2a: Request error: " + error.message);
                    return callback(error);
                  }

                  // console.log("[POST /orders] Step 2a: Response status:", response ? response.statusCode : 'no response');
                  // console.log("[POST /orders] Step 2a: Response body:", JSON.stringify(body));

                  if (!body) {
                    logger.warn(req, "[POST /orders] WARNING in Step 2a: Empty response body");
                    return callback();
                  }

                  try {
                    var jsonBody = (typeof body === "string") ? JSON.parse(body) : body;
                    // console.log("[POST /orders] Step 2a: Parsed address data:", JSON.stringify(jsonBody));

                    if (jsonBody.status_code !== 500 && jsonBody._embedded && jsonBody._embedded.address && jsonBody._embedded.address[0] != null) {
                      order.address = jsonBody._embedded.address[0]._links.self.href;
                      // console.log("[POST /orders] Step 2a: Set order.address to:", order.address);
                    } else {
                      logger.warn(req, "[POST /orders] WARNING in Step 2a: No valid address found in response");
                    }
                  } catch (e) {
                    logger.error(req, "[POST /orders] ERROR in Step 2a: JSON parse error: " + e.message);
                    return callback(e);
                  }

                  callback();
                });
              },
              function (callback) {
                // console.log("[POST /orders] Step 2b: Fetching card from:", cardLink);

                if (!cardLink) {
                  logger.error(req, "[POST /orders] ERROR in Step 2b: cardLink is undefined/null");
                  return callback(new Error("Card link is undefined"));
                }

                request.get(cardLink, {}, req, function (error, response, body) {
                  if (error) {
                    logger.error(req, "[POST /orders] ERROR in Step 2b: Request error: " + error.message);
                    return callback(error);
                  }

                  // console.log("[POST /orders] Step 2b: Response status:", response ? response.statusCode : 'no response');
                  // console.log("[POST /orders] Step 2b: Response body:", JSON.stringify(body));

                  if (!body) {
                    logger.warn(req, "[POST /orders] WARNING in Step 2b: Empty response body");
                    return callback();
                  }

                  try {
                    var jsonBody = (typeof body === "string") ? JSON.parse(body) : body;
                    // console.log("[POST /orders] Step 2b: Parsed card data:", JSON.stringify(jsonBody));

                    if (jsonBody.status_code !== 500 && jsonBody._embedded && jsonBody._embedded.card && jsonBody._embedded.card[0] != null) {
                      order.card = jsonBody._embedded.card[0]._links.self.href;
                      // console.log("[POST /orders] Step 2b: Set order.card to:", order.card);
                    } else {
                      logger.warn(req, "[POST /orders] WARNING in Step 2b: No valid card found in response");
                    }
                  } catch (e) {
                    logger.error(req, "[POST /orders] ERROR in Step 2b: JSON parse error: " + e.message);
                    return callback(e);
                  }

                  callback();
                });
              }
          ], function (err, result) {
            if (err) {
              logger.error(req, "[POST /orders] ERROR in Step 2: Parallel requests failed: " + err.message);
              return callback(err);
            }
            // console.log("[POST /orders] Step 2: Parallel requests completed successfully");
            // console.log("[POST /orders] Step 2: Final order object:", JSON.stringify(order));
            callback(null, order);
          });
        },
        function (order, callback) {
          logger.log(req, "[POST /orders] Step 3: Posting order to orders service");

          var options = {
            uri: endpoints.ordersUrl + '/orders',
            method: 'POST',
            json: true,
            body: order
          };

          // console.log("[POST /orders] Step 3: Order service URL:", options.uri);
          // console.log("[POST /orders] Step 3: Posting order:", JSON.stringify(order));

          request(options, req, function (error, response, body) {
            if (error) {
              logger.error(req, "[POST /orders] ERROR in Step 3: Request error: " + error.message);
              return callback(error);
            }

            // console.log("[POST /orders] Step 3: Response status code:", response ? response.statusCode : 'no response');
            // console.log("[POST /orders] Step 3: Response headers:", response ? JSON.stringify(response.headers) : 'no headers');
            // console.log("[POST /orders] Step 3: Response body:", JSON.stringify(body));

            if (!response) {
              logger.error(req, "[POST /orders] ERROR in Step 3: No response received");
              return callback(new Error("No response from orders service"));
            }

            if (response.statusCode >= 400) {
              logger.error(req, "[POST /orders] ERROR in Step 3: Order service returned error status: " + response.statusCode);
            } else {
              // console.log("[POST /orders] Step 3: Order created successfully");
            }

            callback(null, response.statusCode, body);
          });
        }
    ],
    function (err, status, result) {
      if (err) {
        logger.error(req, "[POST /orders] FINAL ERROR: Waterfall failed: " + err.message);
        logger.error(req, "[POST /orders] Error stack: " + err.stack);
        return next(err);
      }

      // console.log("[POST /orders] SUCCESS: Order process completed");
      // console.log("[POST /orders] Final status:", status);
      // console.log("[POST /orders] Final result:", JSON.stringify(result));

      // Handle empty response body from orders service
      var responseBody = result !== undefined ? JSON.stringify(result) : JSON.stringify({ message: "Order created successfully" });
      helpers.respondStatusBody(res, status, responseBody);
    });
  });

  module.exports = app;
}());
