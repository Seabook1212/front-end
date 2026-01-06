(function (){
  'use strict';

  var async     = require("async")
    , express   = require("express")
    , request   = require("request")
    , endpoints = require("../endpoints")
    , helpers   = require("../../helpers")
    , app       = express()

  app.get("/orders", function (req, res, next) {
    console.log("Request received with body: " + JSON.stringify(req.body));
    var logged_in = req.cookies.logged_in;
    if (!logged_in) {
      // throw new Error("User not logged in.");
      // return
      return helpers.respondStatusBody(res, 401, JSON.stringify({ error: "User not logged in." }));
    }

    var custId = req.session.customerId;
    async.waterfall([
        function (callback) {
          request(endpoints.ordersUrl + "/orders/search/customerId?sort=date&custId=" + custId, function (error, response, body) {
            if (error) {
              return callback(error);
            }
            console.log("Received response: " + JSON.stringify(body));
            if (response.statusCode == 404) {
              console.log("No orders found for user: " + custId);
              return callback(null, []);
            }
            // 非 2xx：不要 JSON.parse，更不要崩；降级为空（或者 callback(new Error(...))）
            if (!response || response.statusCode < 200 || response.statusCode >= 300) {
              console.log("Orders service returned status:", response && response.statusCode);
              return callback(null, []); // 降级：返回空列表，前端页面还能活
            }

                      // body 可能是对象，也可能是字符串
            let jsonBody = body;
            try {
              if (typeof body === "string") jsonBody = JSON.parse(body);
            } catch (e) {
              // body 不是合法 JSON：降级为空
              console.log("Invalid JSON from orders:", e.message);
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
    request.get(url).pipe(res);
  });

  app.post("/orders", function(req, res, next) {
    console.log("Request received with body: " + JSON.stringify(req.body));
    var logged_in = req.cookies.logged_in;
    if (!logged_in) {
      // throw new Error("User not logged in.");
      // return
      return helpers.respondStatusBody(res, 401, JSON.stringify({ error: "User not logged in." }));
    }

    var custId = req.session.customerId;

    async.waterfall([
        function (callback) {
          request(endpoints.customersUrl + "/" + custId, function (error, response, body) {
            if (error || body.status_code === 500) {
              callback(error);
              return;
            }
            // 非 2xx：直接报错或降级
            if (!response || response.statusCode < 200 || response.statusCode >= 300) {
              return callback(new Error("customers service status " + (response && response.statusCode)));
            }

            console.log("Received response: " + JSON.stringify(body));
            // var jsonBody = JSON.parse(body);
            let jsonBody;
            try {
              jsonBody = (typeof body === "string") ? JSON.parse(body) : body;
            } catch (e) {
              return callback(new Error("customers invalid json"));
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
                console.log("GET Request to: " + addressLink);
                request.get(addressLink, function (error, response, body) {
                  if (error) {
                    callback(error);
                    return;
                  }
                  console.log("Received response: " + JSON.stringify(body));
                  var jsonBody = JSON.parse(body);
                  if (jsonBody.status_code !== 500 && jsonBody._embedded.address[0] != null) {
                    order.address = jsonBody._embedded.address[0]._links.self.href;
                  }
                  callback();
                });
              },
              function (callback) {
                console.log("GET Request to: " + cardLink);
                request.get(cardLink, function (error, response, body) {
                  if (error) {
                    callback(error);
                    return;
                  }
                  console.log("Received response: " + JSON.stringify(body));
                  var jsonBody = JSON.parse(body);
                  if (jsonBody.status_code !== 500 && jsonBody._embedded.card[0] != null) {
                    order.card = jsonBody._embedded.card[0]._links.self.href;
                  }
                  callback();
                });
              }
          ], function (err, result) {
            if (err) {
              callback(err);
              return;
            }
            console.log(result);
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
          console.log("Posting Order: " + JSON.stringify(order));
          request(options, function (error, response, body) {
            if (error) {
              return callback(error);
            }
            console.log("Order response: " + JSON.stringify(response));
            console.log("Order response: " + JSON.stringify(body));
            callback(null, response.statusCode, body);
          });
        }
    ],
    function (err, status, result) {
      if (err) {
        return next(err);
      }
      helpers.respondStatusBody(res, status, JSON.stringify(result));
    });
  });

  module.exports = app;
}());
