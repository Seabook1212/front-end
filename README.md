# EviRCA Enhanced Sock Shop Front-end

This repository contains the Node.js/Express front-end service used in the enhanced Sock Shop benchmark for **EviRCA: An Evidence-Aware Skill-Based LLM Agent and a Telemetry-Rich Multi-Modal Benchmark for Microservice Root Cause Analysis**.

The service is derived from the Sock Shop `front-end` component, but has been modernized and instrumented for reproducible microservice RCA experiments. It acts as the user-facing entry point for the demo shop and forwards requests to downstream services such as catalogue, cart, orders, and user.

## Role in the Benchmark

In the EviRCA benchmark, the enhanced Sock Shop system provides synchronized metrics, logs, traces, service topology, Chaos Mesh fault-injection artifacts, upgraded service implementations, and fine-grained RCA labels. This repository is the benchmark's front-end service implementation.

Key changes relevant to RCA telemetry:

- Migrated runtime from the legacy Node.js stack to Node.js 20-compatible dependencies.
- Exposes Prometheus metrics at `/metrics`, including HTTP latency, request count, in-flight requests, request size, response size, error count, and Node.js runtime metrics.
- Creates distributed traces for service-entry requests and outbound calls to downstream services.
- Propagates Zipkin B3 and W3C Trace Context headers across service boundaries.
- Emits trace-aware structured logs with trace IDs, span IDs, operation metadata, status codes, dependency targets, and error context.
- Adds health checking at `/health` and improved handling for 5xx responses, uncaught exceptions, dependency failures, and unhandled promise rejections.

## Service Overview

The front-end serves the static Sock Shop UI from `public/` and mounts API routes for:

- `/catalogue*`
- `/cart*`
- `/orders*`
- `/user*`
- `/metrics`
- `/health`

By default, the service listens on port `8079`.

## Requirements

- Node.js `>= 18.0.0` for local development
- npm
- Docker, if building or running the container image
- Docker Compose, if using the bundled test environment

## Configuration

Common environment variables:

| Name | Default | Description |
| --- | --- | --- |
| `PORT` | `8079` | HTTP port used by the service. |
| `SERVICE_NAME` | `front-end` | Service name used in logs and traces. |
| `ZIPKIN_HOST` | `jaeger-collector.observability.svc.cluster.local` | Zipkin-compatible collector host. |
| `ZIPKIN_PORT` | `9411` | Zipkin-compatible collector port. |
| `ZIPKIN_BASE_URL` | `http://${ZIPKIN_HOST}:${ZIPKIN_PORT}` | Full collector base URL. Overrides host/port composition. |
| `SESSION_REDIS` | unset | Enables Redis-backed sessions when set. |
| `REDIS_HOST` | `session-db` | Redis host for session storage. |
| `REDIS_PORT` | `6379` | Redis port for session storage. |

The service also accepts `--domain=<suffix>` to append a DNS suffix to downstream service names, matching the original Sock Shop deployment style.

Example:

```sh
npm start -- --domain=.sock-shop
```

## Run Locally

Install dependencies:

```sh
npm install
```

Start the service:

```sh
npm start
```

Check the service:

```sh
curl http://localhost:8079/health
curl http://localhost:8079/metrics
```

For a complete working application, the downstream Sock Shop services must also be reachable by their expected service names.

## Docker

Build the image:

```sh
docker build -t front-end .
```

Run the container:

```sh
docker run --rm -p 8079:8079 front-end
```

The Docker image uses Node.js 20 Alpine and exposes port `8079`.

## Test and Development Helpers

The repository keeps the original Makefile workflow for local test and integration development:

```sh
make test
make up
make dev
make e2e
make down
```

Notes:

- `make test` builds the test image and runs the unit/functional tests.
- `make up` starts the Docker Compose test environment, installs dependencies, and runs the service container.
- `make dev` rebuilds the image and starts the development container.
- `make e2e` runs the end-to-end test suite against the Docker Compose network.
- The Makefile development server maps the service to `http://localhost:8080`, while the direct Node and production Docker defaults use `8079`.

## Repository Layout

```text
api/                 Express API route handlers for cart, catalogue, orders, user, and metrics
helpers/             Shared request, logging, tracing, session, and error-handling helpers
public/              Static Sock Shop front-end assets
server.js            Express application entry point
tracing.js           Zipkin/OpenTracing tracer setup
instrumentation.js   Request and helper tracing middleware
config.js            Session and Redis configuration
Dockerfile           Production container definition
Makefile             Local Docker/test workflow
```

## Citation Context

This service is part of the enhanced Sock Shop system described in the EviRCA paper. The benchmark is designed for telemetry-rich, reproducible microservice RCA and supports multi-modal analysis over metrics, logs, traces, topology, and fault-injection metadata.
