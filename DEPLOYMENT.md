# Kubernetes Deployment Guide

## Environment Variables for front-end Service

Configure these environment variables in your Kubernetes deployment to enable Jaeger tracing with Redis session storage.

### Required Environment Variables

```yaml
env:
  # Service identification
  - name: SERVICE_NAME
    value: "front-end"

  # Redis session storage
  - name: SESSION_REDIS
    value: "true"
  - name: REDIS_HOST
    value: "session-db"
  - name: REDIS_PORT
    value: "6379"

  # Jaeger tracing (Zipkin-compatible endpoint)
  - name: ZIPKIN_HOST
    value: "jaeger-collector.observability.svc.cluster.local"
  - name: ZIPKIN_PORT
    value: "9411"
```

### Alternative: Spring Boot Style Configuration

You can also use the Spring Boot style variable name:

```yaml
env:
  - name: SERVICE_NAME
    value: "front-end"
  - name: SESSION_REDIS
    value: "true"
  - name: zipkin_host
    value: "jaeger-collector.observability.svc.cluster.local"
```

This matches the Spring Boot configuration pattern:
```properties
spring.zipkin.baseUrl=http://${zipkin_host:jaeger-collector.observability.svc.cluster.local}:9411
```

## Complete Deployment Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: front-end
  namespace: sock-shop
spec:
  replicas: 1
  selector:
    matchLabels:
      name: front-end
  template:
    metadata:
      labels:
        name: front-end
    spec:
      containers:
      - name: front-end
        image: seabook1111/front-end:inject-1-1
        resources:
          limits:
            cpu: 300m
            memory: 1000Mi
          requests:
            cpu: 100m
            memory: 300Mi
        ports:
        - containerPort: 8079
        env:
        - name: SERVICE_NAME
          value: "front-end"
        - name: SESSION_REDIS
          value: "true"
        - name: REDIS_HOST
          value: "session-db"
        - name: REDIS_PORT
          value: "6379"
        - name: ZIPKIN_HOST
          value: "jaeger-collector.observability.svc.cluster.local"
        - name: ZIPKIN_PORT
          value: "9411"
        securityContext:
          runAsNonRoot: true
          runAsUser: 10001
          capabilities:
            drop:
              - all
          readOnlyRootFilesystem: true
```

## Verification

After deploying, verify the configuration:

1. **Check pod logs for tracing initialization:**
   ```bash
   kubectl logs -n sock-shop -l name=front-end
   ```

   You should see:
   ```
   Jaeger tracing initialized for service: front-end
   Zipkin-compatible endpoint: http://jaeger-collector.observability.svc.cluster.local:9411/api/v1/spans
   Using the redis based session manager
   App now running in production mode on port 8079
   ```

2. **Verify environment variables in the pod:**
   ```bash
   kubectl exec -n sock-shop deployment/front-end -- env | grep -E 'ZIPKIN|SERVICE_NAME|REDIS'
   ```

3. **Test the application:**
   ```bash
   kubectl port-forward -n sock-shop deployment/front-end 8079:8079
   curl http://localhost:8079
   ```

4. **Check traces in Jaeger UI:**
   - Access Jaeger UI (e.g., http://jaeger-ui-url)
   - Select service: `front-end`
   - You should see traces for HTTP requests

## Rollout Commands

To deploy or update the front-end service:

```bash
# Apply the deployment
kubectl apply -f front-end-deployment.yaml

# Or restart existing deployment to pull new image
kubectl rollout restart deployment/front-end -n sock-shop

# Monitor rollout status
kubectl rollout status deployment/front-end -n sock-shop

# View pod status
kubectl get pods -n sock-shop -l name=front-end

# Force delete pods to ensure new image is pulled
kubectl delete pod -n sock-shop -l name=front-end
```

## Troubleshooting

### Pods not starting

```bash
# Check pod events
kubectl describe pod -n sock-shop -l name=front-end

# Check logs from previous pod (if crashed)
kubectl logs -n sock-shop -l name=front-end --previous
```

### Traces not appearing in Jaeger

```bash
# Test connectivity to Jaeger collector from pod
kubectl exec -n sock-shop deployment/front-end -- wget -O- http://jaeger-collector.observability.svc.cluster.local:9411

# Check Jaeger collector logs
kubectl logs -n observability -l app=jaeger-collector
```

### Redis connection issues

```bash
# Test connectivity to Redis
kubectl exec -n sock-shop deployment/front-end -- nc -zv session-db 6379

# Check Redis logs
kubectl logs -n sock-shop deployment/session-db
```
