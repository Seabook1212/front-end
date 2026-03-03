(function() {
    'use strict';

    var async = require("async"), express = require("express"), request = require("../../helpers/traced-request"), endpoints = require("../endpoints"), helpers = require("../../helpers"), logger = require("../../helpers/logger"), app = express(), cookie_name = "logged_in"

    function createApplicationError(message, fields) {
        return logger.attachErrorContext(new Error(message), fields);
    }


    app.get("/customers/:id", function(req, res, next) {
        helpers.simpleHttpRequest(endpoints.customersUrl + "/" + req.session.customerId, res, next, req);
    });
    app.get("/cards/:id", function(req, res, next) {
        helpers.simpleHttpRequest(endpoints.cardsUrl + "/" + req.params.id, res, next, req);
    });

    app.get("/customers", function(req, res, next) {
        helpers.simpleHttpRequest(endpoints.customersUrl, res, next, req);
    });
    app.get("/addresses", function(req, res, next) {
        helpers.simpleHttpRequest(endpoints.addressUrl, res, next, req);
    });
    app.get("/cards", function(req, res, next) {
        helpers.simpleHttpRequest(endpoints.cardsUrl, res, next, req);
    });

    // Create Customer - TO BE USED FOR TESTING ONLY (for now)
    app.post("/customers", function(req, res, next) {
        var options = {
            uri: endpoints.customersUrl,
            method: 'POST',
            json: true,
            body: req.body
        };

        logger.log(req, "Posting customer");

        request(options, req, function(error, response, body) {
            if (error) {
                return next(error);
            }
            helpers.respondSuccessBody(res, JSON.stringify(body));
        }.bind({
            res: res
        }));
    });

    app.post("/addresses", function(req, res, next) {
        req.body.userID = helpers.getCustomerId(req, app.get("env"));

        var options = {
            uri: endpoints.addressUrl,
            method: 'POST',
            json: true,
            body: req.body
        };
        logger.log(req, "Posting address");
        request(options, req, function(error, response, body) {
            if (error) {
                return next(error);
            }
            helpers.respondSuccessBody(res, JSON.stringify(body));
        }.bind({
            res: res
        }));
    });

    app.get("/card", function(req, res, next) {
        var custId = helpers.getCustomerId(req, app.get("env"));
        var options = {
            uri: endpoints.customersUrl + '/' + custId + '/cards',
            method: 'GET',
        };
        request(options, req, function(error, response, body) {
            if (error) {
                return next(error);
            }
            var data;

            try {
                data = (typeof body === "string") ? JSON.parse(body) : body;
            } catch (parseError) {
                return next(logger.attachErrorContext(parseError, {
                    operation: 'parse_downstream_response',
                    dependency: 'user',
                    target: options.uri,
                    error_type: 'invalid_response'
                }));
            }
            if (data.status_code !== 500 && data._embedded && data._embedded.card && data._embedded.card.length !== 0 ) {
                var resp = {
                    "number": data._embedded.card[0].longNum.slice(-4)
                };
                return helpers.respondSuccessBody(res, JSON.stringify(resp));
            }
            return helpers.respondSuccessBody(res, JSON.stringify({"status_code": 500}));
        }.bind({
            res: res
        }));
    });

    app.get("/address", function(req, res, next) {
        var custId = helpers.getCustomerId(req, app.get("env"));
        var options = {
            uri: endpoints.customersUrl + '/' + custId + '/addresses',
            method: 'GET',
        };
        request(options, req, function(error, response, body) {
            if (error) {
                return next(error);
            }
            var data;

            try {
                data = (typeof body === "string") ? JSON.parse(body) : body;
            } catch (parseError) {
                return next(logger.attachErrorContext(parseError, {
                    operation: 'parse_downstream_response',
                    dependency: 'user',
                    target: options.uri,
                    error_type: 'invalid_response'
                }));
            }
            if (data.status_code !== 500 && data._embedded && data._embedded.address && data._embedded.address.length !== 0 ) {
                var resp = data._embedded.address[0];
                return helpers.respondSuccessBody(res, JSON.stringify(resp));
            }
            return helpers.respondSuccessBody(res, JSON.stringify({"status_code": 500}));
        }.bind({
            res: res
        }));
    });

    app.post("/cards", function(req, res, next) {
        req.body.userID = helpers.getCustomerId(req, app.get("env"));

        var options = {
            uri: endpoints.cardsUrl,
            method: 'POST',
            json: true,
            body: req.body
        };
        logger.log(req, "Posting card");
        request(options, req, function(error, response, body) {
            if (error) {
                return next(error);
            }
            helpers.respondSuccessBody(res, JSON.stringify(body));
        }.bind({
            res: res
        }));
    });

    // Delete Customer - TO BE USED FOR TESTING ONLY (for now)
    app.delete("/customers/:id", function(req, res, next) {
        logger.log(req, "Deleting Customer " + req.params.id);
        var options = {
            uri: endpoints.customersUrl + "/" + req.params.id,
            method: 'DELETE'
        };
        request(options, req, function(error, response, body) {
            if (error) {
                return next(error);
            }
            helpers.respondSuccessBody(res, JSON.stringify(body));
        }.bind({
            res: res
        }));
    });

    // Delete Address - TO BE USED FOR TESTING ONLY (for now)
    app.delete("/addresses/:id", function(req, res, next) {
        logger.log(req, "Deleting Address " + req.params.id);
        var options = {
            uri: endpoints.addressUrl + "/" + req.params.id,
            method: 'DELETE'
        };
        request(options, req, function(error, response, body) {
            if (error) {
                return next(error);
            }
            helpers.respondSuccessBody(res, JSON.stringify(body));
        }.bind({
            res: res
        }));
    });

    // Delete Card - TO BE USED FOR TESTING ONLY (for now)
    app.delete("/cards/:id", function(req, res, next) {
        logger.log(req, "Deleting Card " + req.params.id);
        var options = {
            uri: endpoints.cardsUrl + "/" + req.params.id,
            method: 'DELETE'
        };
        request(options, req, function(error, response, body) {
            if (error) {
                return next(error);
            }
            helpers.respondSuccessBody(res, JSON.stringify(body));
        }.bind({
            res: res
        }));
    });

    app.post("/register", function(req, res, next) {
        var options = {
            uri: endpoints.registerUrl,
            method: 'POST',
            json: true,
            body: req.body
        };

        logger.log(req, "Register request received");

        async.waterfall([
                function(callback) {
                    request(options, req, function(error, response, body) {
                        if (error !== null ) {
                            callback(error);
                            return;
                        }
                        if (response.statusCode == 200 && body != null && body != "") {
                            if (body.error) {
                                callback(createApplicationError(String(body.error), {
                                    operation: 'user.register',
                                    dependency: 'user',
                                    target: endpoints.registerUrl,
                                    error_type: 'downstream_error'
                                }));
                                return;
                            }
                            var customerId = body.id;
                            req.session.customerId = customerId;
                            callback(null, customerId);
                            return;
                        }
                        logger.log(req, "Response status code: " + response.statusCode);
                        callback(true);
                    });
                },
                function(custId, callback) {
                    var sessionId = req.session.id;
                    logger.log(req, "Merging carts for customer id: " + custId + " and session id: " + sessionId);

                    var options = {
                        uri: endpoints.cartsUrl + "/" + custId + "/merge" + "?sessionId=" + sessionId,
                        method: 'GET'
                    };
                    request(options, req, function(error, response, body) {
                        if (error) {
                            if(callback) callback(error);
                            return;
                        }
                        logger.log(req, 'Carts merged.');
                        if(callback) callback(null, custId);
                    });
                }
            ],
            function(err, custId) {
                if (err) {
                    if (!logger.wasErrorLogged(err)) {
                        logger.error(req, "Register flow failed", Object.assign({
                            operation: 'user.register',
                            target: endpoints.registerUrl,
                            error_type: 'register_failed'
                        }, logger.getErrorContext(err)), err instanceof Error ? err : undefined);
                    }
                    req._errorLogged = true;
                    res.status(500);
                    res.end();
                    return;
                }
                res.status(200);
                res.cookie(cookie_name, req.session.id, {
                    maxAge: 3600000
                }).send({id: custId});
                logger.log(req, "Sent cookies.");
                res.end();
                return;
            }
        );
    });

    app.get("/login", function(req, res, next) {
        logger.log(req, "Received login request");

        async.waterfall([
                function(callback) {
                    var options = {
                        headers: {
                            'Authorization': req.get('Authorization')
                        },
                        uri: endpoints.loginUrl
                    };
                    request(options, req, function(error, response, body) {
                        if (error) {
                            callback(error);
                            return;
                        }
                        if (response.statusCode == 200 && body != null && body != "") {
                            var parsedBody;

                            try {
                                parsedBody = (typeof body === "string") ? JSON.parse(body) : body;
                            } catch (parseError) {
                                callback(logger.attachErrorContext(parseError, {
                                    operation: 'parse_downstream_response',
                                    dependency: 'user',
                                    target: endpoints.loginUrl,
                                    error_type: 'invalid_response'
                                }));
                                return;
                            }

                            if (!parsedBody || !parsedBody.user || !parsedBody.user.id) {
                                callback(createApplicationError("Login response missing user id", {
                                    operation: 'user.login',
                                    dependency: 'user',
                                    target: endpoints.loginUrl,
                                    error_type: 'invalid_response'
                                }));
                                return;
                            }

                            var customerId = parsedBody.user.id;
                            req.session.customerId = customerId;
                            callback(null, customerId);
                            return;
                        }
                        logger.log(req, "Response status code: " + response.statusCode);
                        callback(true);
                    });
                },
                function(custId, callback) {
                    var sessionId = req.session.id;
                    logger.log(req, "Merging carts for customer id: " + custId + " and session id: " + sessionId);

                    var options = {
                        uri: endpoints.cartsUrl + "/" + custId + "/merge" + "?sessionId=" + sessionId,
                        method: 'GET'
                    };
                    request(options, req, function(error, response, body) {
                        if (!error) {
                            logger.log(req, 'Carts merged.');
                        }
                        callback(null, custId);
                    });
                }
            ],
            function(err, custId) {
                if (err) {
                    if (err instanceof Error && !logger.wasErrorLogged(err)) {
                        logger.error(req, "Login flow failed", Object.assign({
                            operation: 'user.login',
                            target: endpoints.loginUrl,
                            error_type: 'login_failed'
                        }, logger.getErrorContext(err)), err);
                    }
                    req._errorLogged = true;
                    res.status(401);
                    res.end();
                    return;
                }
                res.status(200);
                res.cookie(cookie_name, req.session.id, {
                    maxAge: 3600000
                }).send('Cookie is set');
                logger.log(req, "Sent cookies.");
                res.end();
                return;
            });
    });

    module.exports = app;
}());
