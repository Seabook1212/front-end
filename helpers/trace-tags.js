(function() {
  'use strict';

  var fs = require('fs');
  var os = require('os');

  var KUBERNETES_ENV_MAPPINGS = {
    pod: ['POD_NAME', 'MY_POD_NAME', 'K8S_POD_NAME', 'KUBERNETES_POD_NAME', 'HOSTNAME'],
    container: ['CONTAINER_NAME', 'MY_CONTAINER_NAME', 'K8S_CONTAINER_NAME', 'KUBERNETES_CONTAINER_NAME', 'container_name'],
    node: ['NODE_NAME', 'MY_NODE_NAME', 'K8S_NODE_NAME', 'KUBERNETES_NODE_NAME'],
    namespace: ['POD_NAMESPACE', 'MY_POD_NAMESPACE', 'K8S_NAMESPACE', 'KUBERNETES_NAMESPACE', 'NAMESPACE']
  };

  function resolveFirstEnvValue(envNames) {
    for (var i = 0; i < envNames.length; i++) {
      var value = process.env[envNames[i]];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return null;
  }

  function readTrimmedFile(path) {
    try {
      var value = fs.readFileSync(path, 'utf8');
      if (typeof value === 'string') {
        var trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    } catch (e) {
      // Best effort only
    }
    return null;
  }

  function resolveContainerIdFromCgroup() {
    var cgroup = readTrimmedFile('/proc/self/cgroup');
    if (!cgroup) {
      return null;
    }

    var lines = cgroup.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var parts = line.split('/');
      for (var j = parts.length - 1; j >= 0; j--) {
        var segment = parts[j];
        if (!segment) {
          continue;
        }
        if (/^[a-f0-9]{64}$/.test(segment) || /^[a-f0-9]{32}$/.test(segment)) {
          return segment;
        }
      }
    }
    return null;
  }

  function resolveKubernetesMetadata() {
    var podName = resolveFirstEnvValue(KUBERNETES_ENV_MAPPINGS.pod) || os.hostname() || 'unknown';
    var containerName = resolveFirstEnvValue(KUBERNETES_ENV_MAPPINGS.container) || resolveContainerIdFromCgroup() || process.env.SERVICE_NAME || 'unknown';
    var nodeName = resolveFirstEnvValue(KUBERNETES_ENV_MAPPINGS.node) || 'unknown';
    var namespaceName = resolveFirstEnvValue(KUBERNETES_ENV_MAPPINGS.namespace) ||
      readTrimmedFile('/var/run/secrets/kubernetes.io/serviceaccount/namespace') ||
      'unknown';

    return {
      podName: podName,
      containerName: containerName,
      nodeName: nodeName,
      namespaceName: namespaceName
    };
  }

  var kubernetesMetadata = resolveKubernetesMetadata();

  function setKubernetesTags(span) {
    if (!span || typeof span.setTag !== 'function') {
      return;
    }

    // Set both semantic-convention tags and short aliases for easier discovery in UIs.
    span.setTag('k8s.pod.name', kubernetesMetadata.podName);
    span.setTag('k8s.container.name', kubernetesMetadata.containerName);
    span.setTag('k8s.node.name', kubernetesMetadata.nodeName);
    span.setTag('k8s.namespace.name', kubernetesMetadata.namespaceName);

    span.setTag('pod', kubernetesMetadata.podName);
    span.setTag('container', kubernetesMetadata.containerName);
    span.setTag('node', kubernetesMetadata.nodeName);
    span.setTag('namespace', kubernetesMetadata.namespaceName);
  }

  function isErrorObject(error) {
    if (!error || typeof error !== 'object') {
      return false;
    }
    if (error instanceof Error) {
      return true;
    }
    return Object.prototype.toString.call(error) === '[object Error]';
  }

  function setExceptionTags(span, error) {
    if (!span || typeof span.setTag !== 'function' || !isErrorObject(error)) {
      return;
    }

    if (error.name) {
      span.setTag('exception.type', error.name);
    }

    if (typeof error.message === 'string' && error.message.length > 0) {
      span.setTag('exception.message', error.message);
    }
  }

  module.exports = {
    setKubernetesTags: setKubernetesTags,
    setExceptionTags: setExceptionTags
  };
}());
